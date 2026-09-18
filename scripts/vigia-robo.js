// Vigia do robô do Gmail. Fica rodando no PC do escritório e atende a fila
// que a tela de Cobrança de Documentos grava em `solicitacoesEmail`:
//
//   tipo 'verificar'  roda o robô (download-attachments.js) agora
//   tipo 'um'         envia a cobrança de um cliente pelo Gmail
//   tipo 'lote'       envia uma cobrança só, com vários clientes em Cco
//
// A cobrança só é registrada no cliente (documentosMensal.cobrancas) depois
// que o Gmail confirma o envio. A cada minuto grava config/robo.vigia, e é
// por esse sinal que a tela sabe se o PC está ligado.
//
// Segurança: só envia para e-mail que está no cadastro do cliente (email ou
// emails[]). Em lote, os endereços saem do cadastro, nunca do pedido. Com isso
// a fila não serve pra mandar e-mail pra qualquer pessoa.
//
// Uso: node vigia-robo.js [--a-cada MINUTOS]
//   --a-cada 120   além dos pedidos, lê o Gmail sozinho a cada 120 minutos
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { FieldValue } = require('firebase-admin/firestore');
const { getGmail } = require('./gmail-client');
const { getDb } = require('./firestore-client');

const CAIXA = 'nilmacontabilidade@gmail.com';
const ROBO = path.join(__dirname, 'download-attachments.js');
const MAX_ENVIOS_POR_HORA = 60;        // freio contra laço ou clique repetido
const MAX_CCO = 90;                    // o Gmail recusa mensagem com destinatários demais

const args = process.argv.slice(2);
const iA = args.indexOf('--a-cada');
const A_CADA_MIN = iA !== -1 ? parseInt(args[iA + 1], 10) : 0;

// ---------- um vigia só ----------
// Dois vigias atendendo a mesma fila podem mandar a mesma cobrança duas vezes.
// A trava é um arquivo com o número do processo; se esse processo ainda existe,
// este sai com código 3 (o iniciar-vigia.cmd entende e não fica reiniciando).
const fs = require('fs');
const TRAVA = path.join(__dirname, 'vigia.lock');
function processoVivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
try {
  const pidAntigo = parseInt(fs.readFileSync(TRAVA, 'utf8'), 10);
  if (pidAntigo && pidAntigo !== process.pid && processoVivo(pidAntigo)) {
    console.log(new Date().toLocaleString('pt-BR'), 'já existe um vigia rodando (processo ' + pidAntigo + '); este não vai ligar.');
    process.exit(3);
  }
} catch (e) { /* sem trava: ninguém rodando */ }
fs.writeFileSync(TRAVA, String(process.pid));
process.on('exit', () => {
  try { if (parseInt(fs.readFileSync(TRAVA, 'utf8'), 10) === process.pid) fs.unlinkSync(TRAVA); } catch (e) {}
});

const db = getDb('entregas-2e5e2');
const roboRef = db.collection('config').doc('robo');
const fila = db.collection('solicitacoesEmail');

const agora = () => new Date().toISOString();
const log = (...m) => console.log(new Date().toLocaleString('pt-BR'), ...m);

// ---------- sinal de vida ----------
function baterPonto() {
  roboRef.set({ vigia: { em: agora(), pc: os.hostname(), aCadaMin: A_CADA_MIN || null, desligadoEm: null } }, { merge: true })
    .catch(err => log('não consegui bater o ponto:', err.message));
}

// ---------- e-mail ----------
// Assunto e corpo em UTF-8, codificados pro cabeçalho e o corpo aguentarem acento.
function codificarCabecalho(texto) {
  return /^[\x20-\x7e]*$/.test(texto) ? texto : '=?UTF-8?B?' + Buffer.from(texto, 'utf8').toString('base64') + '?=';
}
function montarMensagem({ para, cco, assunto, corpo }) {
  const linhas = [
    'From: ' + CAIXA,
    'To: ' + (para || CAIXA),
  ];
  if (cco && cco.length) linhas.push('Bcc: ' + cco.join(', '));
  linhas.push(
    'Subject: ' + codificarCabecalho(assunto),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(corpo || '', 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
  );
  return Buffer.from(linhas.join('\r\n'), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function enviar(dados) {
  const r = await getGmail().users.messages.send({ userId: 'me', requestBody: { raw: montarMensagem(dados) } });
  return r.data.id;
}

function traduzirErro(err) {
  const m = err.message || String(err);
  if (/insufficient.*scope|insufficientPermissions|Request had insufficient authentication scopes/i.test(m)) {
    return 'o Gmail ainda não autorizou envio: rode "node gmail-auth.js" no PC do robô';
  }
  if (/invalid_grant/i.test(m)) return 'a autorização do Gmail expirou: rode "node gmail-auth.js" no PC do robô';
  return m;
}

function enderecosDoCliente(c) {
  return [c.email].concat(Array.isArray(c.emails) ? c.emails : [])
    .filter(Boolean).map(e => String(e).trim().toLowerCase());
}

const enviosRecentes = [];
function dentroDoLimite(n) {
  const umaHoraAtras = Date.now() - 36e5;
  while (enviosRecentes.length && enviosRecentes[0] < umaHoraAtras) enviosRecentes.shift();
  return enviosRecentes.length + n <= MAX_ENVIOS_POR_HORA;
}

async function registrarCobranca(cliente, competencia, registro) {
  await db.collection('documentosMensal').doc(cliente.id + '_' + competencia).set({
    clienteId: cliente.id, clienteNome: cliente.nome, competencia,
    cobrancas: FieldValue.arrayUnion(registro),
  }, { merge: true });
}
function auditoria(acao, detalhe, pedido) {
  return db.collection('auditoria').add({
    acao, detalhe, origem: 'vigia-robo',
    feitoPor: pedido.criadoPorEmail || '', feitoPorNome: (pedido.criadoPor || '') + ' (pelo robô)',
    quando: agora(),
  }).catch(() => {});
}

async function atenderUm(p) {
  const snap = await db.collection('clientes').doc(p.clienteId || '-').get();
  if (!snap.exists) throw new Error('cliente não encontrado');
  const cliente = Object.assign({ id: snap.id }, snap.data());
  const para = String(p.para || '').trim().toLowerCase();
  if (!enderecosDoCliente(cliente).includes(para)) throw new Error(para + ' não está no cadastro deste cliente');
  if (!dentroDoLimite(1)) throw new Error('limite de ' + MAX_ENVIOS_POR_HORA + ' envios por hora atingido; tente mais tarde');

  const gmailId = await enviar({ para, assunto: p.assunto, corpo: p.corpo });
  enviosRecentes.push(Date.now());
  const em = agora();
  await registrarCobranca(cliente, p.competencia, {
    em, por: p.criadoPor || '', para, tipos: Array.isArray(p.tipos) ? p.tipos : [],
    canal: 'gmail', enviadoPeloRobo: true, gmailId,
  });
  auditoria('cobranca_gmail', (cliente.codigoOrigem ? cliente.codigoOrigem + ' - ' : '') + cliente.nome + ' · ' + p.competencia + ' · ' + para, p);
  log('enviado para', cliente.nome, '<' + para + '>');
  return { status: 'enviado', enviadoEm: em, gmailId };
}

async function atenderLote(p) {
  const ids = Array.isArray(p.clienteIds) ? p.clienteIds.slice(0, 500) : [];
  const clientes = [];
  for (const id of ids) {
    const s = await db.collection('clientes').doc(id).get();
    if (s.exists) {
      const c = Object.assign({ id: s.id }, s.data());
      if (c.email) clientes.push(c);
    }
  }
  if (!clientes.length) throw new Error('nenhum cliente do lote tem e-mail cadastrado');
  const lotes = [];
  for (let i = 0; i < clientes.length; i += MAX_CCO) lotes.push(clientes.slice(i, i + MAX_CCO));
  if (!dentroDoLimite(lotes.length)) throw new Error('limite de ' + MAX_ENVIOS_POR_HORA + ' envios por hora atingido; tente mais tarde');

  const gmailIds = [];
  for (const grupo of lotes) {
    const cco = [...new Set(grupo.map(c => String(c.email).trim().toLowerCase()))];
    gmailIds.push(await enviar({ para: CAIXA, cco, assunto: p.assunto, corpo: p.corpo }));
    enviosRecentes.push(Date.now());
    const em = agora();
    for (const c of grupo) {
      // Mesmo cálculo da tela: o que falta neste cliente no mês, pro histórico.
      const doc = (await db.collection('documentosMensal').doc(c.id + '_' + p.competencia).get()).data() || {};
      const naoAplica = Array.isArray(c.documentosNaoAplicaveis) ? c.documentosNaoAplicaveis : [];
      const tipos = ['extrato', 'comprovante', 'aplicacao'].filter(t => !naoAplica.includes(t) && !doc[t]);
      await registrarCobranca(c, p.competencia, {
        em, por: p.criadoPor || '', para: c.email, tipos, canal: 'lote', enviadoPeloRobo: true,
      });
    }
  }
  auditoria('cobranca_lote', clientes.length + ' clientes · ' + p.competencia, p);
  log('lote enviado:', clientes.length, 'clientes em', lotes.length, 'e-mail(s)');
  return { status: 'enviado', enviadoEm: agora(), enviadosPara: clientes.length, gmailIds };
}

// ---------- leitura do Gmail (roda o robô) ----------
let lendo = false;
function rodarRobo(dias, motivo) {
  return new Promise(resolve => {
    lendo = true;
    roboRef.set({ status: 'lendo', statusEm: agora(), statusMotivo: motivo }, { merge: true }).catch(() => {});
    log('lendo o Gmail (' + motivo + ')');
    const saida = [];
    const filho = spawn(process.execPath, [ROBO, String(dias || 3)], { cwd: __dirname });
    const guardar = b => { String(b).split(/\r?\n/).filter(Boolean).forEach(l => { saida.push(l); if (saida.length > 40) saida.shift(); }); };
    filho.stdout.on('data', guardar);
    filho.stderr.on('data', guardar);
    filho.on('close', async code => {
      lendo = false;
      const ultima = saida.filter(l => !/limite de uso/.test(l)).slice(-1)[0] || '';
      const robo = (await roboRef.get()).data() || {};
      const ok = code === 0;
      await roboRef.set({
        status: ok ? 'ok' : 'erro', statusEm: agora(),
        statusMsg: ok ? (robo.ultimaExecucaoResumo || '') : traduzirErro({ message: ultima.replace(/^ERRO:\s*/, '') }),
      }, { merge: true }).catch(() => {});
      log(ok ? 'leitura terminou: ' + (robo.ultimaExecucaoResumo || '') : 'leitura falhou: ' + ultima);
      resolve({ ok, resumo: robo.ultimaExecucaoResumo || '', erro: ok ? null : ultima });
    });
  });
}

// Salvar no Drive os anexos de UM e-mail de cliente (botão "Salvar no Drive").
// Roda o próprio robô no modo --mensagem, que já sabe achar o cliente, o mês do
// documento e a pasta; a última linha dele diz o que foi salvo.
function salvarMensagem(p) {
  return new Promise((resolve, reject) => {
    const argsRobo = [ROBO, '--mensagem', String(p.mensagemId)];
    if (p.clienteId) argsRobo.push('--cliente', String(p.clienteId));
    const saida = [];
    const filho = spawn(process.execPath, argsRobo, { cwd: __dirname });
    const guardar = b => String(b).split(/\r?\n/).filter(Boolean).forEach(l => saida.push(l));
    filho.stdout.on('data', guardar);
    filho.stderr.on('data', guardar);
    filho.on('close', () => {
      const linha = saida.filter(l => l.startsWith('RESULTADO:')).pop();
      let r = null;
      try { r = linha ? JSON.parse(linha.slice('RESULTADO:'.length)) : null; } catch (e) { r = null; }
      if (!r) return reject(new Error(saida.slice(-1)[0] || 'o robô não respondeu'));
      if (r.erro) return reject(new Error(r.erro));
      log('salvo no Drive:', r.arquivos, 'arquivo(s) em', r.pasta);
      resolve({ status: 'concluido', concluidoEm: agora(), pasta: r.pasta, arquivos: r.arquivos, cliente: r.cliente });
    });
  });
}

// ---------- fila ----------
let ocupado = false;
async function atenderFila() {
  if (ocupado) return;
  ocupado = true;
  try {
    for (;;) {
      const snap = await fila.where('status', '==', 'pendente').get();
      const pendentes = snap.docs.sort((a, b) => String(a.data().criadoEm).localeCompare(String(b.data().criadoEm)));
      if (!pendentes.length) break;
      const doc = pendentes[0];
      const p = doc.data();
      // Marca antes de começar: se o vigia cair no meio, o pedido não é
      // reenviado sozinho ao voltar (e-mail duplicado é pior que um aviso).
      await doc.ref.update({ status: 'processando', processandoEm: agora(), pc: os.hostname() });
      try {
        let resultado;
        if (p.tipo === 'um') resultado = await atenderUm(p);
        else if (p.tipo === 'lote') resultado = await atenderLote(p);
        else if (p.tipo === 'verificar') {
          while (lendo) await new Promise(r => setTimeout(r, 2000));
          const r = await rodarRobo(p.dias || 3, 'pedido por ' + (p.criadoPor || 'alguém'));
          if (!r.ok) throw new Error(r.erro || 'o robô terminou com erro');
          resultado = { status: 'concluido', concluidoEm: agora(), resumo: r.resumo };
        } else if (p.tipo === 'salvar') {
          // Não roda junto com uma leitura automática: as duas mexem no
          // mesmo controle de e-mails já lidos.
          while (lendo) await new Promise(r => setTimeout(r, 2000));
          lendo = true;
          try { resultado = await salvarMensagem(p); } finally { lendo = false; }
        } else throw new Error('tipo de pedido desconhecido: ' + p.tipo);
        await doc.ref.update(resultado);
      } catch (err) {
        const erro = traduzirErro(err);
        log('pedido', doc.id, 'falhou:', erro);
        await doc.ref.update({ status: 'erro', erro, erroEm: agora() }).catch(() => {});
      }
    }
  } catch (err) {
    log('erro lendo a fila:', err.message);
  } finally {
    ocupado = false;
  }
}

// ---------- início ----------
async function iniciar() {
  // Pedido que ficou "processando" quando o vigia caiu: não reenvia às cegas.
  const presos = await fila.where('status', '==', 'processando').get();
  for (const d of presos.docs) {
    await d.ref.update({ status: 'erro', erro: 'o PC do robô desligou no meio do envio; confira no Gmail (Enviados) antes de mandar de novo', erroEm: agora() });
  }
  if (presos.size) log(presos.size, 'pedido(s) interrompido(s) marcados como erro');

  baterPonto();
  setInterval(baterPonto, 60 * 1000);

  fila.where('status', '==', 'pendente').onSnapshot(
    snap => { if (!snap.empty) atenderFila(); },
    err => { log('perdi a conexão com a fila:', err.message); process.exit(1); }
  );

  if (A_CADA_MIN > 0) {
    setInterval(() => { if (!lendo && !ocupado) rodarRobo(3, 'automático a cada ' + A_CADA_MIN + ' min'); }, A_CADA_MIN * 60 * 1000);
  }

  log('vigia ligado em', os.hostname() + (A_CADA_MIN ? ', lendo sozinho a cada ' + A_CADA_MIN + ' min' : '') + '. Ctrl+C para parar.');
}

// Ao fechar, avisa a tela na hora em vez de esperar os 3 minutos sem ponto.
function desligar() {
  roboRef.set({ vigia: { em: new Date(0).toISOString(), pc: os.hostname(), desligadoEm: agora() } }, { merge: true })
    .finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', desligar);
process.on('SIGTERM', desligar);

iniciar().catch(err => { log('ERRO ao iniciar:', err.message); process.exit(1); });
