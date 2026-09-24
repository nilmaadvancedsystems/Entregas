// Vigia do robô do Gmail. Fica rodando no PC do escritório e atende a fila
// que a tela de Cobrança de Documentos grava em `solicitacoesEmail`:
//
//   tipo 'verificar'  roda o robô (download-attachments.js) agora
//   tipo 'um'         envia a cobrança de um cliente pelo Gmail
//   tipo 'lote'       envia uma cobrança só, com vários clientes em Cco
//
// A cobrança só é registrada no cliente (documentosMensal.cobrancas) depois
// que o Gmail confirma o envio. A cada minuto grava robo/estado.vigia, e é
// por esse sinal que a tela sabe se o PC está ligado.
//
// Também manda, para a caixa do escritório (ou robo/estado.alertaPara), um
// resumo do dia a partir das 18h e um alerta quando uma leitura ou um pedido
// dá erro; e apaga da fila os pedidos terminados há mais de 30 dias.
//
// Segurança: só envia para e-mail que está no cadastro do cliente (email ou
// emails[]). Em lote, os endereços saem do cadastro, nunca do pedido. Com isso
// a fila não serve pra mandar e-mail pra qualquer pessoa.
//
// Uso: node vigia-robo.js [--a-cada MINUTOS] [--ver-resumo]
//   --a-cada 120   além dos pedidos, lê o Gmail sozinho a cada 120 minutos
//   --ver-resumo   só mostra o resumo de hoje na tela (não envia, não liga o vigia)
require('./fuso.js');   // define o fuso do escritório antes de qualquer data
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { FieldValue } = require('firebase-admin/firestore');
const { getGmail } = require('./gmail-client');
const { getDb } = require('./firestore-client');
const { iniciarAtendenteIA } = require('./ia-atendente');
const lideranca = require('./lideranca');

const CAIXA = 'nilmacontabilidade@gmail.com';
const ROBO = path.join(__dirname, 'download-attachments.js');
const MAX_ENVIOS_POR_HORA = 60;        // freio contra laço ou clique repetido
const MAX_CCO = 90;                    // o Gmail recusa mensagem com destinatários demais

const args = process.argv.slice(2);
const iA = args.indexOf('--a-cada');
const A_CADA_MIN = iA !== -1 ? parseInt(args[iA + 1], 10) : 0;
const SO_VER_RESUMO = args.includes('--ver-resumo');   // imprime o resumo de hoje e sai, sem enviar

// ---------- um vigia só ----------
// Dois vigias atendendo a mesma fila podem mandar a mesma cobrança duas vezes.
// A trava é um arquivo com o número do processo; se esse processo ainda existe,
// este sai com código 3 (o iniciar-vigia.cmd entende e não fica reiniciando).
const fs = require('fs');
const TRAVA = path.join(__dirname, 'vigia.lock');
function processoVivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
if (!SO_VER_RESUMO) try {
  const pidAntigo = parseInt(fs.readFileSync(TRAVA, 'utf8'), 10);
  if (pidAntigo && pidAntigo !== process.pid && processoVivo(pidAntigo)) {
    console.log(new Date().toLocaleString('pt-BR'), 'já existe um vigia rodando (processo ' + pidAntigo + '); este não vai ligar.');
    process.exit(3);
  }
} catch (e) { /* sem trava: ninguém rodando */ }
if (!SO_VER_RESUMO) fs.writeFileSync(TRAVA, String(process.pid));
process.on('exit', () => {
  try { if (parseInt(fs.readFileSync(TRAVA, 'utf8'), 10) === process.pid) fs.unlinkSync(TRAVA); } catch (e) {}
});

const db = getDb('entregas-2e5e2');
// robo/estado: só admin e contábil leem (config/* qualquer logado lê, e aqui
// tem remetente, assunto e nome de arquivo de cliente).
const roboRef = db.collection('robo').doc('estado');
const fila = db.collection('solicitacoesEmail');

const HORA_DO_RESUMO = 18;              // o resumo do dia sai a partir das 18h
const DIAS_NA_FILA = 30;                // pedido terminado some da fila depois disso
const ALERTA_A_CADA_H = 6;              // no máximo um alerta de erro a cada 6h

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
const em76 = buf => buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
// Com html: texto puro + HTML (multipart/alternative) e, se houver, as
// imagens embutidas por cid (multipart/related) — os logos dos bancos.
function montarMensagem({ para, cco, assunto, corpo, html, imagens }) {
  const linhas = [
    'From: ' + CAIXA,
    'To: ' + (para || CAIXA),
  ];
  if (cco && cco.length) linhas.push('Bcc: ' + cco.join(', '));
  linhas.push('Subject: ' + codificarCabecalho(assunto), 'MIME-Version: 1.0');
  const texto = em76(Buffer.from(corpo || '', 'utf8'));
  if (!html) {
    linhas.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', texto);
  } else {
    const alt = 'alt-' + Date.now().toString(36);
    const rel = 'rel-' + Date.now().toString(36);
    const partes = [
      '--' + alt, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', texto,
      '--' + alt, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', em76(Buffer.from(html, 'utf8')),
      '--' + alt + '--',
    ];
    const figuras = (imagens || []).filter(i => { try { return fs.statSync(i.arquivo).size < 200 * 1024; } catch (e) { return false; } });
    if (!figuras.length) {
      linhas.push('Content-Type: multipart/alternative; boundary="' + alt + '"', '', ...partes);
    } else {
      linhas.push('Content-Type: multipart/related; boundary="' + rel + '"', '',
        '--' + rel, 'Content-Type: multipart/alternative; boundary="' + alt + '"', '', ...partes);
      figuras.forEach(i => linhas.push('--' + rel, 'Content-Type: ' + (i.mime || 'image/png'), 'Content-Transfer-Encoding: base64',
        'Content-ID: <' + i.cid + '>', 'Content-Disposition: inline; filename="' + i.cid + '.png"', '', em76(fs.readFileSync(i.arquivo))));
      linhas.push('--' + rel + '--');
    }
  }
  return Buffer.from(linhas.join('\r\n'), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const { htmlDaCobranca } = require('./email-html');
// assinatura e dia limite, do config/cobranca; lido no máximo a cada 10 min
let configCache = { em: 0, valor: {} };
async function configDaCobranca() {
  if (Date.now() - configCache.em > 10 * 60 * 1000) {
    configCache = { em: Date.now(), valor: (await db.collection('config').doc('cobranca').get()).data() || {} };
  }
  return configCache.valor;
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

  // versão em HTML, com os bancos do cliente e o que já chegou no mês
  let visual = {};
  try {
    const doMes = p.competencia ? ((await db.collection('documentosMensal').doc(cliente.id + '_' + p.competencia).get()).data() || {}) : {};
    const cfg = await configDaCobranca();
    visual = htmlDaCobranca({ corpo: p.corpo, cliente, competencia: p.competencia, faltando: p.tipos, bancosRecebidos: doMes.bancosRecebidos,
      diaLimite: cfg.diaLimite, assinatura: cfg.assinatura || 'Nilma Contabilidade', caixa: CAIXA });
  } catch (err) { log('cobrança sai só em texto:', err.message); }
  const gmailId = await enviar({ para, assunto: p.assunto, corpo: p.corpo, html: visual.html, imagens: visual.imagens });
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
// Janela da leitura automática: cobre desde a última leitura que terminou,
// com folga. PC desligado de sexta a terça (ou uma semana de feriado) não
// deixa e-mail pra trás; o robô pula sozinho o que já leu.
async function diasDesdeUltimaLeitura() {
  try {
    const ultima = ((await roboRef.get()).data() || {}).ultimaExecucao;
    if (!ultima) return 10;
    const dias = Math.ceil((Date.now() - new Date(ultima).getTime()) / 864e5) + 2;
    return Math.min(45, Math.max(3, dias));
  } catch (e) { return 3; }
}

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
    filho.on('error', err => { lendo = false; log('não consegui iniciar a leitura:', err.message); resolve({ ok: false, resumo: '', erro: err.message }); });
    filho.on('close', async code => {
      lendo = false;
      const ultima = saida.filter(l => !/limite de uso/.test(l)).slice(-1)[0] || '';
      let robo = {};
      try { robo = (await roboRef.get()).data() || {}; } catch (err) { log('não consegui ler o estado depois da leitura:', err.message); }
      const ok = code === 0;
      await roboRef.set({
        status: ok ? 'ok' : 'erro', statusEm: agora(),
        statusMsg: ok ? (robo.ultimaExecucaoResumo || '') : traduzirErro({ message: ultima.replace(/^ERRO:\s*/, '') }),
      }, { merge: true }).catch(() => {});
      log(ok ? 'leitura terminou: ' + (robo.ultimaExecucaoResumo || '') : 'leitura falhou: ' + ultima);
      // Leitura pedida pela tela já avisa por lá (e pelo alerta do pedido).
      if (!ok && /^automático/.test(motivo)) await alertar('a leitura automática do Gmail falhou', traduzirErro({ message: ultima.replace(/^ERRO:\s*/, '') }));
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

// ---------- avisos por e-mail ----------
const diaLocal = d => new Date(d).toLocaleDateString('sv-SE');   // AAAA-MM-DD no fuso do PC
const hojeLocal = () => diaLocal(Date.now());

async function destinoDosAvisos() {
  const r = (await roboRef.get()).data() || {};
  return { estado: r, para: String(r.alertaPara || CAIXA).trim() };
}

// Erro de leitura ou de pedido. Se o erro é a própria autorização do Gmail,
// não dá pra mandar e-mail: fica só a linha vermelha na tela do robô.
async function alertar(titulo, detalhe) {
  try {
    if (/gmail-auth\.js/.test(detalhe)) return;
    const { estado, para } = await destinoDosAvisos();
    const ultimo = estado.ultimoAlertaEm ? Date.parse(estado.ultimoAlertaEm) : 0;
    if (Date.now() - ultimo < ALERTA_A_CADA_H * 36e5) { log('alerta segurado (já foi um há menos de ' + ALERTA_A_CADA_H + 'h):', titulo); return; }
    await enviar({
      para, assunto: 'Robô do Gmail: ' + titulo,
      corpo: titulo + '\n\n' + detalhe + '\n\nAbra a Cobrança de Documentos, página "Robô do Gmail", para ver os detalhes.\n' +
        'Outros erros nas próximas ' + ALERTA_A_CADA_H + ' horas não geram novo e-mail; aparecem no resumo do dia.\n\n(Enviado pelo vigia do PC ' + os.hostname() + ')',
    });
    await roboRef.set({ ultimoAlertaEm: agora() }, { merge: true });
    log('alerta enviado para', para + ':', titulo);
  } catch (err) { log('não consegui mandar o alerta:', traduzirErro(err)); }
}

const TIPOS_DOC = ['extrato', 'comprovante', 'aplicacao'];
const NOME_DOC = { extrato: 'extrato', comprovante: 'comprovante', aplicacao: 'aplicação' };
const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

// Quantos clientes ativos estão com os documentos do mês completos (mesma
// regra da tela: "não se aplica" não conta e mês sem movimento está completo).
async function progressoDoMes(competencia) {
  const [clientes, docs] = await Promise.all([
    db.collection('clientes').where('ativo', '==', true).get(),
    db.collection('documentosMensal').where('competencia', '==', competencia).get(),
  ]);
  const status = new Map();
  docs.forEach(d => status.set(d.data().clienteId, d.data()));
  let completos = 0, comAlgum = 0;
  clientes.forEach(d => {
    const c = d.data(), s = status.get(d.id) || {};
    const naoAplica = Array.isArray(c.documentosNaoAplicaveis) ? c.documentosNaoAplicaveis : [];
    if (s.semMovimento || TIPOS_DOC.every(t => naoAplica.includes(t) || s[t])) completos++;
    else if (TIPOS_DOC.some(t => s[t])) comAlgum++;
  });
  return { completos, comAlgum, total: clientes.size };
}

async function montarResumo(hoje) {
  const { estado } = await destinoDosAvisos();
  const deHoje = x => x && diaLocal(x) === hoje;

  const leituras = (estado.execucoes || []).filter(e => deHoje(e.em));
  const soma = k => leituras.reduce((s, e) => s + (e[k] || 0), 0);
  const chegaram = (estado.caixa || []).filter(c => c.clienteId && deHoje(c.em));
  // Quem a Nilma marcou "É spam" na tela depois da última leitura ainda está em
  // naoReconhecidos; não faz sentido o resumo pedir pra vincular.
  let ignorados = new Set();
  try { ignorados = new Set((((await db.collection('config').doc('roboIgnorados').get()).data() || {}).remetentes || []).map(e => String(e).toLowerCase())); }
  catch (e) { /* sem a lista, o resumo sai igual ao de antes */ }
  const desconhecidos = (estado.naoReconhecidos || []).filter(r => deHoje(r.data) && !ignorados.has(String(r.remetente || '').toLowerCase()));
  // E-mail de cliente que o Gmail jogou no spam: o robô não lê sozinho.
  const noSpam = (estado.spam || []).filter(s => s && s.clienteId && deHoje(s.em));

  // O que o robô marcou hoje, direto da grade (somar as leituras contaria de
  // novo o mesmo e-mail relido).
  const inicioDoDia = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const marcados = [];
  (await db.collection('documentosMensal').where('atualizadoEm', '>=', inicioDoDia).get()).forEach(d => {
    const x = d.data(), det = x.detalhes || {};
    const tipos = TIPOS_DOC.filter(t => x[t] && det[t] && det[t].origem === 'gmail' && deHoje(det[t].em));
    if (tipos.length) marcados.push(x.clienteNome + ' (' + NOME_MES[parseInt(x.competencia.slice(5), 10) - 1] + '): ' + tipos.map(t => NOME_DOC[t]).join(', '));
  });
  marcados.sort();

  const pedidos = (await fila.where('criadoEm', '>=', new Date(Date.now() - 2 * 864e5).toISOString()).get()).docs.map(d => d.data());
  const enviados = pedidos.filter(p => p.status === 'enviado' && deHoje(p.enviadoEm));
  const comErro = pedidos.filter(p => p.status === 'erro' && deHoje(p.erroEm) && !/^substitu/.test(p.erro || ''));

  const d = new Date();
  const compAtual = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const a = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const compAnt = a.getFullYear() + '-' + String(a.getMonth() + 1).padStart(2, '0');
  const [pAtual, pAnt] = await Promise.all([progressoDoMes(compAtual), progressoDoMes(compAnt)]);
  const linhaMes = (comp, p) => NOME_MES[parseInt(comp.slice(5), 10) - 1] + ': ' + p.completos + ' de ' + p.total + ' com tudo, ' + p.comAlgum + ' com parte, ' + (p.total - p.completos - p.comAlgum) + ' sem nada (' + p.total + ' clientes)';

  const L = [];
  L.push('Resumo do robô do Gmail, ' + new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) + '.', '');
  L.push('Leituras do Gmail: ' + (leituras.length
    ? plural(leituras.length, 'leitura', 'leituras') + (soma('erros') ? ', ' + plural(soma('erros'), 'e-mail com erro', 'e-mails com erro') : ', sem erro')
    : 'nenhuma hoje' + (estado.ultimaExecucao ? ' (a última foi em ' + new Date(estado.ultimaExecucao).toLocaleString('pt-BR') + ')' : '')));
  L.push('', 'Documentos que o robô marcou hoje: ' + (marcados.length || 'nenhum'));
  marcados.forEach(m => L.push('  ' + m));
  L.push('');
  L.push('E-mails de clientes com anexo que chegaram hoje: ' + (chegaram.length || 'nenhum'));
  chegaram.slice(0, 30).forEach(c => L.push('  ' + c.clienteNome + ': ' + (c.arquivos || []).join(', ')));
  if (chegaram.length > 30) L.push('  e mais ' + (chegaram.length - 30));
  if (noSpam.length) {
    L.push('', 'E-mails de clientes no spam: ' + noSpam.length);
    noSpam.slice(0, 15).forEach(s => L.push('  ' + (s.clienteNome || s.remetente) + ': ' + (s.assunto || '(sem assunto)')));
    L.push('  Para salvar, abra a página "Robô do Gmail".');
  }
  L.push('');
  L.push('Cobranças enviadas pelo robô hoje: ' + (enviados.length || 'nenhuma'));
  enviados.forEach(p => L.push('  ' + (p.tipo === 'lote' ? 'em lote, ' + plural(p.enviadosPara || 0, 'cliente', 'clientes') : (p.clienteNome || p.para)) + ' (' + (p.criadoPor || '') + ')'));
  if (comErro.length) {
    L.push('', 'Pedidos que deram erro hoje: ' + comErro.length);
    comErro.forEach(p => L.push('  ' + (p.clienteNome || p.para || p.tipo) + ': ' + p.erro));
  }
  if (desconhecidos.length) {
    L.push('', 'Remetentes novos com anexo que não são de nenhum cliente: ' + desconhecidos.length);
    desconhecidos.slice(0, 15).forEach(r => L.push('  ' + (r.nome ? r.nome + ' <' + r.remetente + '>' : r.remetente) + ': ' + (r.assunto || '(sem assunto)')));
    L.push('  Para vincular, abra a página "Robô do Gmail".');
  }
  L.push('', 'Andamento do mês', '  ' + linhaMes(compAtual, pAtual), '  ' + linhaMes(compAnt, pAnt));
  L.push('', '(Enviado pelo vigia do PC ' + os.hostname() + '. Para não receber, avise quem cuida do robô.)');

  const houveAlgo = leituras.length || marcados.length || chegaram.length || enviados.length || comErro.length || desconhecidos.length || noSpam.length;
  return { texto: L.join('\n'), houveAlgo, assunto: 'Robô do Gmail: resumo de ' + new Date().toLocaleDateString('pt-BR') +
    (comErro.length ? ' (' + plural(comErro.length, 'erro', 'erros') + ')' : '') };
}

let resumindo = false;
let resumoFeitoNoDia = '';   // na memória: sem isto eram até 360 leituras por noite só pra ouvir "já foi"
async function talvezMandarResumo() {
  if (resumindo || new Date().getHours() < HORA_DO_RESUMO || resumoFeitoNoDia === hojeLocal()) return;
  resumindo = true;
  try {
    const hoje = hojeLocal();
    const { estado, para } = await destinoDosAvisos();
    if (estado.resumoDia === hoje) { resumoFeitoNoDia = hoje; return; }
    const r = await montarResumo(hoje);
    const fimDeSemana = [0, 6].includes(new Date().getDay());
    if (fimDeSemana && !r.houveAlgo) { await roboRef.set({ resumoDia: hoje }, { merge: true }); return; }
    const gmailId = await enviar({ para, assunto: r.assunto, corpo: r.texto });
    await roboRef.set({ resumoDia: hoje, resumoEnviadoEm: agora(), resumoGmailId: gmailId }, { merge: true });
    log('resumo do dia enviado para', para);
  } catch (err) {
    log('não consegui mandar o resumo do dia:', traduzirErro(err));
  } finally { resumindo = false; }
}

// ---------- limpeza da fila ----------
// Pedido terminado (enviado, concluído, erro) com mais de 30 dias só pesa na
// tela; o que foi enviado continua no histórico do cliente e na auditoria.
async function limparFila() {
  try {
    const limite = new Date(Date.now() - DIAS_NA_FILA * 864e5).toISOString();
    const velhos = await fila.where('criadoEm', '<', limite).get();
    const apagar = velhos.docs.filter(d => ['enviado', 'concluido', 'erro'].includes(d.data().status));
    for (const d of apagar) await d.ref.delete();
    if (apagar.length) log('fila: apaguei', apagar.length, 'pedido(s) terminados há mais de', DIAS_NA_FILA, 'dias');
  } catch (err) { log('não consegui limpar a fila:', err.message); }
}

// ---------- fila ----------
let ocupado = false;
// Falha de rede no meio da fila não gera novo aviso do Firestore: sem isto o
// pedido ficava "na fila" até alguém fazer outro.
let filaFalhou = false;
async function atenderFila() {
  if (ocupado) return;
  ocupado = true;
  filaFalhou = false;
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
        const oque = { um: 'a cobrança de ' + (p.clienteNome || p.para), lote: 'a cobrança em lote', verificar: 'a verificação do Gmail', salvar: 'salvar anexo no Drive' }[p.tipo] || 'um pedido';
        await alertar(oque + ' deu erro', 'Pedido de ' + (p.criadoPor || 'alguém') + ' em ' + new Date(p.criadoEm).toLocaleString('pt-BR') + ':\n' + erro);
      }
    }
  } catch (err) {
    log('erro lendo a fila:', err.message);
    filaFalhou = true;
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
  setInterval(() => { baterPonto(); talvezMandarResumo(); if (filaFalhou) atenderFila(); }, 60 * 1000);

  // Avisos no celular (parada nova, entrega não realizada). Se isto falhar,
  // o resto do vigia segue: aviso é conforto, não pode derrubar o robô.
  let avisos = null;
  try { avisos = require('./avisos-push').iniciarAvisos(db, log); }
  catch (err) { log('avisos no celular desligados:', err.message); }

  // Vigia de CNPJ: uma conferência por semana nos dados abertos da Receita.
  // Mudança grave (inapta, baixada, saiu do Simples) vira aviso pro admin.
  try {
    require('./vigia-cnpj').iniciarVigiaCnpj(db, log, graves => {
      if (!avisos) return;
      const titulo = graves.length === 1 ? 'Mudou na Receita' : graves.length + ' clientes mudaram na Receita';
      avisos.enviar('admin', '', titulo, graves.slice(0, 2).join(' · '), 'receita').catch(err => log('aviso da Receita não saiu:', err.message));
    });
  } catch (err) { log('vigia de CNPJ desligado:', err.message); }

  // Lembrete de vencimento no celular do cliente e backup de todo dia. Cada um
  // no seu try: nenhum deles pode derrubar o robô do Gmail.
  try { require('./avisos-vencimento').iniciarAvisosDeVencimento(db, log); }
  catch (err) { log('lembrete de vencimento desligado:', err.message); }
  try { require('./backup-diario').iniciarBackupDiario(db, log); }
  catch (err) { log('backup diário desligado:', err.message); }
  try { require('./clientes-cache').manterArquivo(db, log); }
  catch (err) { log('arquivo local de clientes desligado:', err.message); }
  try { require('./entrega-pelo-link').iniciarEntregaPeloLink(db, log); }
  catch (err) { log('entrega pelo link desligada:', err.message); }
  try { require('./resumo-semanal').iniciarResumoSemanal({ db, log, enviar, destino: destinoDosAvisos }); }
  catch (err) { log('resumo da semana desligado:', err.message); }
  try { require('./papeis-vencendo').iniciarPapeisVencendo({ db, log, avisos }); }
  catch (err) { log('aviso de documento vencendo desligado:', err.message); }
  try { require('./lembretes').iniciarLembretes({ db, log, avisos }); }
  catch (err) { log('lembretes do escritório desligados:', err.message); }
  try { require('./pedidos-do-portal').iniciarPedidosDoPortal(db, log, avisos); }
  catch (err) { log('recados da página do cliente desligados:', err.message); }
  try { require('./envios-do-portal').iniciarEnviosDoPortal(db, log); }
  catch (err) { log('documentos pelo link desligados:', err.message); }
  // Os dois abaixo mandam e-mail pra CLIENTE e vêm desligados: quem liga é o
  // admin em Pendências › Configurações › Automático. Passam pelo mesmo freio
  // por hora da fila de cobrança.
  const correio = { enviar, podeEnviar: dentroDoLimite, contar: () => enviosRecentes.push(Date.now()), registrarCobranca };
  try { require('./comprovante-email').iniciarComprovantePorEmail({ db, log, correio }); }
  catch (err) { log('comprovante por e-mail desligado:', err.message); }
  try { require('./regua-cobranca').iniciarReguaDeCobranca({ db, log, correio }); }
  catch (err) { log('régua de cobrança desligada:', err.message); }
  limparFila();
  setInterval(limparFila, 24 * 36e5);

  fila.where('status', '==', 'pendente').onSnapshot(
    snap => { if (!snap.empty) atenderFila(); },
    err => { log('perdi a conexão com a fila:', err.message); process.exit(1); }
  );

  if (A_CADA_MIN > 0) {
    setInterval(async () => {
      if (lendo || ocupado) return;
      const dias = await diasDesdeUltimaLeitura();
      if (!lendo && !ocupado) rodarRobo(dias, 'automático a cada ' + A_CADA_MIN + ' min');
    }, A_CADA_MIN * 60 * 1000);
  }

  // O reforço de IA pega carona no mesmo processo: já tem a trava de
  // instância única, já tem a credencial do Firestore e já bate o ponto que
  // diz pra tela que o PC está ligado. Sem chave do Gemini configurada, ele
  // mesmo se desliga e loga um aviso — o robô do Gmail segue igual.
  iniciarAtendenteIA(db);

  log('vigia ligado em', os.hostname() + (A_CADA_MIN ? ', lendo sozinho a cada ' + A_CADA_MIN + ' min' : '') + '. Ctrl+C para parar.');
}

// Só quem está com a vez fala pela tela. Um vigia de reserva que é fechado
// não pode anunciar "robô desligado" enquanto o titular segue trabalhando.
let comAVez = false;

// Ao fechar, avisa a tela na hora em vez de esperar os 3 minutos sem ponto, e
// devolve a vez pra o reserva (se houver) assumir já, sem esperar o prazo.
function desligar() {
  setTimeout(() => process.exit(0), 3000);
  if (!comAVez) { process.exit(0); return; }
  Promise.all([
    roboRef.set({ vigia: { em: new Date(0).toISOString(), pc: os.hostname(), desligadoEm: agora() } }, { merge: true }),
    lideranca.devolverAVez(db),
  ]).catch(() => {}).finally(() => process.exit(0));
}
process.on('SIGINT', desligar);
process.on('SIGTERM', desligar);

// ---------- freio de reinício ----------
// O vigia-tray.js religa o vigia 30s depois de qualquer queda. Cada partida lê
// os clientes, os links e a rota (umas 450 leituras). Num dia de banco fora do
// ar — cota do plano gratuito estourada, por exemplo — o vigia cai, religa, lê
// tudo, cai de novo: 120 vezes por hora, o que sozinho acaba com a cota do dia
// seguinte também. Aqui, partida que acontece logo depois de outra espera cada
// vez mais ANTES de tocar no banco: 1, 2, 4... até 30 minutos.
const ARQ_PARTIDAS = path.join(__dirname, 'vigia-partidas.json');
function esperaAntesDeLigar(agoraMs) {
  let p = { ultima: 0, seguidas: 0 };
  try { p = Object.assign(p, JSON.parse(fs.readFileSync(ARQ_PARTIDAS, 'utf8'))); } catch (e) {}
  const seguidas = agoraMs - p.ultima < 10 * 60000 ? p.seguidas + 1 : 0;
  try { fs.writeFileSync(ARQ_PARTIDAS, JSON.stringify({ ultima: agoraMs, seguidas })); } catch (e) {}
  return seguidas < 2 ? 0 : Math.min(30, Math.pow(2, seguidas - 2)) * 60000;
}
// Promessa rejeitada sem tratamento derruba o processo no Node novo. Aqui vira
// linha no log: um aviso que não saiu não pode levar o robô do Gmail junto.
process.on('unhandledRejection', err => { log('erro não tratado (segui rodando):', err && err.message ? err.message : String(err)); });

if (SO_VER_RESUMO) {
  montarResumo(hojeLocal()).then(r => { console.log('Assunto: ' + r.assunto + '\n\n' + r.texto); process.exit(0); })
    .catch(err => { console.error('ERRO:', err.message); process.exit(1); });
} else {
  const espera = esperaAntesDeLigar(Date.now());
  if (espera) log('muitas partidas seguidas: espero', Math.round(espera / 60000), 'min antes de ligar (pra não gastar o banco à toa)');
  setTimeout(async () => {
    try {
      // Um vigia só, entre máquinas: espera de reserva até ser a vez dele.
      // Ver lideranca.js.
      await lideranca.esperarAVez(db, log);
      comAVez = true;
      log('a vez é deste vigia (' + lideranca.EU.maquina + ')');
      // Perdeu a vez com o processo rodando: sai sem mexer em nada. O código 3
      // é o que o ícone da bandeja entende como "tem outro rodando" — ele
      // religa em 1 minuto, e este volta a esperar de reserva.
      lideranca.manterAVez(db, log, () => { comAVez = false; process.exit(3); });
      await iniciar();
    } catch (err) { log('ERRO ao iniciar:', err.message); process.exit(1); }
  }, espera);
}
