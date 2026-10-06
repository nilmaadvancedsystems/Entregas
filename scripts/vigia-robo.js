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
const { getGmail, temCaixa, podeLer, CAIXAS } = require('./gmail-client');
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
// este sai com código 3.
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
// A mensagem (texto, HTML, logos por cid e anexos) é montada em mensagem-gmail.js.
const { montarMensagem: montarMime, prepararHtmlPronto } = require('./mensagem-gmail');
const { htmlParaTexto } = require('./leituras-gmail');
const montarMensagem = dados => montarMime(Object.assign({ de: CAIXA }, dados));

// ---------- as caixas do Gmail (01/10/2026) ----------
// A cobrança sai da caixa do departamento: a do contábil (enquanto não for autorizada, a do robô, como
// sempre foi) ou a do fiscal (sem ela, a cobrança do fiscal não sai). O resto (alertas, resumo, disparos,
// respostas) continua na caixa do robô. Ver gmail-client.js.
const enderecos = { robo: CAIXA };
async function enderecoDaCaixa(caixa) {
  if (enderecos[caixa]) return enderecos[caixa];
  let email = '';
  try {
    email = (await getGmail(caixa).users.getProfile({ userId: 'me' })).data.emailAddress;
  } catch (err) {
    // caixa que só envia (o fiscal): o Gmail não diz o endereço; quem diz é o userinfo (openid + userinfo.email)
    if (!/insufficient/i.test(err.message || '')) throw err;
    const { google } = require('googleapis');
    email = (await google.oauth2({ version: 'v2', auth: require('./gmail-client').getAuth(caixa) }).userinfo.get()).data.email;
  }
  if (!email) throw new Error('não consegui saber o endereço da caixa ' + caixa);
  enderecos[caixa] = String(email).toLowerCase();
  return enderecos[caixa];
}
// De qual setor é o pedido (01/10/2026): o que o pedido disser; senão o setor de QUEM pediu — o departamento do
// Cadastro do nads (usuarios.departamento) ou, sem ele, o papel (fiscal sem o contábil = fiscal). Assim o "Pedir
// extratos" do nads e a cobrança das Pendências saem pelo Gmail do setor de quem pediu. Na dúvida, o contábil.
const setorDe = new Map();   // uid ou e-mail -> { setor, em }
async function departamentoDoPedido(p) {
  if (p && (p.departamento === 'fiscal' || p.departamento === 'contabil')) return p.departamento;
  const chave = (p && (p.criadoPorUid || p.criadoPorEmail)) || '';
  if (!chave) return 'contabil';
  const guardado = setorDe.get(chave);
  if (guardado && Date.now() - guardado.em < 10 * 60 * 1000) return guardado.setor;
  let u = null;
  try {
    if (p.criadoPorUid) u = (await db.collection('usuarios').doc(String(p.criadoPorUid)).get()).data() || null;
    else {
      const q = await db.collection('usuarios').where('email', '==', String(p.criadoPorEmail).trim().toLowerCase()).limit(1).get();
      u = q.empty ? null : q.docs[0].data();
    }
  } catch (err) { log('não consegui ver o setor de quem pediu:', err.message); }
  const papeis = (u && Array.isArray(u.roles)) ? u.roles : [];
  const setor = u && (u.departamento === 'fiscal' || u.departamento === 'contabil') ? u.departamento
    : papeis.includes('fiscal') && !papeis.includes('contabil') ? 'fiscal' : 'contabil';
  setorDe.set(chave, { setor, em: Date.now() });
  return setor;
}
function caixaDoDepartamento(dep) {
  if (dep === 'fiscal') {
    if (!temCaixa('fiscal')) throw new Error('o Gmail do fiscal ainda não foi autorizado (node gmail-auth.js --caixa fiscal)');
    return 'fiscal';
  }
  return temCaixa('contabil') ? 'contabil' : 'robo';
}
// Contas novas ainda sem confiança no Gmail (01/10/2026): o Google aceitava o envio da setorcontabilnilma e não
// entregava. Enquanto config/caixasGmail.enviarPeloRobo não for false, a cobrança do setor sai pela caixa do robô
// (nilmacontabilidade, que sempre chegou) com "responder para" a caixa do setor — as respostas caem lá e o robô lê.
const cfgEnvio = { em: 0, valor: {} };
async function enviarPeloRobo() {
  if (Date.now() - cfgEnvio.em > 5 * 60 * 1000) {
    try { cfgEnvio.valor = (await db.collection('config').doc('caixasGmail').get()).data() || {}; } catch (e) { /* fica o que tinha */ }
    cfgEnvio.em = Date.now();
  }
  return cfgEnvio.valor.enviarPeloRobo !== false;
}
/** De onde sai a cobrança de um setor: { caixa de envio, endereço do remetente, para onde vão as respostas ('' = o próprio) } */
async function envioDoSetor(dep) {
  const caixaDoSetor = caixaDoDepartamento(dep);
  const doSetor = await enderecoDaCaixa(caixaDoSetor);
  if (caixaDoSetor !== 'robo' && await enviarPeloRobo()) return { caixa: 'robo', de: CAIXA, respostas: doSetor };
  return { caixa: caixaDoSetor, de: doSetor, respostas: '' };
}

// robo/estado.caixas: quais caixas estão autorizadas e de qual endereço saem (a tela mostra)
async function conferirCaixas() {
  const caixas = {};
  for (const caixa of Object.keys(CAIXAS)) {
    const c = { autorizada: temCaixa(caixa), email: '', erro: '', em: agora() };
    if (c.autorizada) {
      try { c.email = await enderecoDaCaixa(caixa); } catch (err) { c.erro = traduzirErro(err); }
    }
    caixas[caixa] = c;
  }
  await roboRef.set({ caixas, envioPeloRobo: await enviarPeloRobo() }, { merge: true }).catch(err => log('não gravei as caixas:', err.message));
  return caixas;
}
const { htmlDaCobranca, htmlDoDisparo } = require('./email-html');
// assinatura e dia limite, do config/cobranca (contábil) ou config/cobrancaFiscal; lido no máximo a cada 10 min
const configCache = {};
async function configDaCobranca(dep = 'contabil') {
  const id = dep === 'fiscal' ? 'cobrancaFiscal' : 'cobranca';
  const c = configCache[id];
  if (!c || Date.now() - c.em > 10 * 60 * 1000) {
    configCache[id] = { em: Date.now(), valor: (await db.collection('config').doc(id).get()).data() || {} };
  }
  return configCache[id].valor;
}

// PROVISÓRIO (01/10/2026): enquanto o robô ainda não lê a caixa do contábil, a cobrança que sai dela pede a
// resposta na caixa do robô (Reply-To), que é a que ele lê: os anexos dos clientes continuam sendo registrados
// sozinhos. Desde que o robô lê a caixa do contábil (gmail.readonly na autorização), as respostas ficam nela.
const respostaDoContabilNoRobo = () => !podeLer('contabil');

async function enviar(dados, caixa = 'robo') {
  const de = await enderecoDaCaixa(caixa);
  const cabecalhos = (dados.cabecalhos || []).slice();
  if (dados.respostasPara) cabecalhos.push('Reply-To: ' + dados.respostasPara);
  if (caixa === 'contabil' && respostaDoContabilNoRobo()) cabecalhos.push('Reply-To: ' + CAIXA);
  const r = await getGmail(caixa).users.messages.send({ userId: 'me', requestBody: { raw: montarMensagem(Object.assign({ de }, dados, { cabecalhos })) } });
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

// o freio por hora é de cada caixa
const enviosPorCaixa = {};
const enviosDa = caixa => (enviosPorCaixa[caixa] = enviosPorCaixa[caixa] || []);
const enviosRecentes = enviosDa('robo');
function dentroDoLimite(n, caixa = 'robo') {
  const umaHoraAtras = Date.now() - 36e5;
  const lista = enviosDa(caixa);
  while (lista.length && lista[0] < umaHoraAtras) lista.shift();
  return lista.length + n <= MAX_ENVIOS_POR_HORA;
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
  const dep = await departamentoDoPedido(p);
  const envio = await envioDoSetor(dep);
  const caixa = envio.caixa;
  const de = envio.de;
  const respostas = envio.respostas ? { respostasPara: envio.respostas } : {};
  if (!dentroDoLimite(1, caixa)) throw new Error('limite de ' + MAX_ENVIOS_POR_HORA + ' envios por hora atingido; tente mais tarde');

  // versão em HTML: no contábil, com os bancos do cliente e o que já chegou no mês; no fiscal, o texto com a assinatura
  let visual = {};
  try {
    const cfg = await configDaCobranca(dep);
    // o e-mail já montado na tela (Pedir documentos do nads, 01/10/2026): sai exatamente como a prévia mostrou
    if (typeof p.html === 'string' && p.html.trim() && p.html.length <= 500000) {
      visual = { html: p.html };
    } else if (dep === 'fiscal') {
      visual = htmlDoDisparo({ assunto: p.assunto, corpo: p.corpo, assinatura: cfg.assinatura || 'Nilma Contabilidade', caixa: de });
    } else {
      const doMes = p.competencia ? ((await db.collection('documentosMensal').doc(cliente.id + '_' + p.competencia).get()).data() || {}) : {};
      visual = htmlDaCobranca({ corpo: p.corpo, cliente, competencia: p.competencia, faltando: p.tipos, bancosPorTipo: doMes.bancosPorTipo, bancosRecebidos: doMes.bancosRecebidos,
        diaLimite: cfg.diaLimite, assinatura: cfg.assinatura || 'Nilma Contabilidade', caixa: de, mostrarRecebidos: cfg.mostrarRecebidos === true });
    }
  } catch (err) { log('cobrança sai só em texto:', err.message); }
  const gmailId = await enviar(Object.assign({ para, assunto: p.assunto, corpo: p.corpo, html: visual.html, imagens: visual.imagens }, respostas), caixa);
  enviosDa(caixa).push(Date.now());
  const em = agora();
  await registrarCobranca(cliente, p.competencia, {
    em, por: p.criadoPor || '', para, tipos: Array.isArray(p.tipos) ? p.tipos : [],
    canal: 'gmail', enviadoPeloRobo: true, gmailId, departamento: dep, caixa: de, ...respostas,
  });
  auditoria('cobranca_gmail', (cliente.codigoOrigem ? cliente.codigoOrigem + ' - ' : '') + cliente.nome + ' · ' + p.competencia + ' · ' + para, p);
  log('enviado para', cliente.nome, '<' + para + '>', 'pela caixa', de);
  return { status: 'enviado', enviadoEm: em, gmailId, caixa: de };
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
  const dep = await departamentoDoPedido(p);
  const envio = await envioDoSetor(dep);
  const caixa = envio.caixa;
  const de = envio.de;
  const respostas = envio.respostas ? { respostasPara: envio.respostas } : {};
  if (!dentroDoLimite(lotes.length, caixa)) throw new Error('limite de ' + MAX_ENVIOS_POR_HORA + ' envios por hora atingido; tente mais tarde');

  const gmailIds = [];
  for (const grupo of lotes) {
    const cco = [...new Set(grupo.map(c => String(c.email).trim().toLowerCase()))];
    gmailIds.push(await enviar(Object.assign({ para: de, cco, assunto: p.assunto, corpo: p.corpo }, respostas), caixa));
    enviosDa(caixa).push(Date.now());
    const em = agora();
    for (const c of grupo) {
      // Mesmo cálculo da tela: o que falta neste cliente no mês, pro histórico.
      const doc = (await db.collection('documentosMensal').doc(c.id + '_' + p.competencia).get()).data() || {};
      const naoAplica = Array.isArray(c.documentosNaoAplicaveis) ? c.documentosNaoAplicaveis : [];
      const tipos = dep === 'fiscal' ? (Array.isArray(p.tipos) ? p.tipos : []) : ['extrato', 'comprovante', 'aplicacao'].filter(t => !naoAplica.includes(t) && !doc[t]);
      await registrarCobranca(c, p.competencia, {
        em, por: p.criadoPor || '', para: c.email, tipos, canal: 'lote', enviadoPeloRobo: true, departamento: dep, caixa: de, ...respostas,
      });
    }
  }
  auditoria('cobranca_lote', clientes.length + ' clientes · ' + p.competencia, p);
  log('lote enviado:', clientes.length, 'clientes em', lotes.length, 'e-mail(s)');
  return { status: 'enviado', enviadoEm: agora(), enviadosPara: clientes.length, gmailIds };
}

// ---------- disparo pra vários clientes (Robô do Gmail › Disparo) ----------
// Um texto e um arquivo pra todos os clientes escolhidos, em Cco (ninguém vê
// o e-mail do outro), em grupos de MAX_CCO. Só admin pede (regras do banco);
// aqui confere de novo pelo cadastro de quem pediu. O arquivo chega em
// pedaços base64 em solicitacoesEmail/{id}/partes/{n} e é apagado depois.
const TIPOS_DE_ANEXO = /^(application\/pdf|image\/(jpeg|png)|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))|application\/vnd\.ms-excel|text\/(plain|csv))$/;
const MAX_ANEXO = 5 * 1024 * 1024;
// o arquivo que a tela subiu em pedaços (solicitacoesEmail/{id}/partes/{n})
async function lerAnexoDasPartes(p, ref) {
  if (!p.anexo || !p.anexo.partes) return null;
  const n = Math.min(Number(p.anexo.partes) || 0, 12);
  const pedacos = [];
  for (let i = 0; i < n; i++) {
    const d = (await ref.collection('partes').doc(String(i)).get()).data();
    if (!d || typeof d.dados !== 'string') throw new Error('o arquivo não chegou inteiro (falta a parte ' + (i + 1) + ' de ' + n + ')');
    pedacos.push(d.dados);
  }
  const buffer = Buffer.from(pedacos.join(''), 'base64');
  const mime = String(p.anexo.mime || '');
  if (!buffer.length || buffer.length > MAX_ANEXO) throw new Error('o arquivo passa de 5 MB');
  if (!TIPOS_DE_ANEXO.test(mime)) throw new Error('tipo de arquivo não aceito: ' + (mime || 'desconhecido'));
  return { nome: String(p.anexo.nome || 'arquivo').split(/[\\/]/).pop().slice(0, 120), mime, buffer };
}
async function apagarPartes(p, ref) {
  for (let i = 0; i < Math.min(Number(p.anexo && p.anexo.partes) || 0, 12); i++) await ref.collection('partes').doc(String(i)).delete().catch(() => {});
}

// Resposta a um e-mail, pela tela (scripts/responder-gmail.js)
async function atenderResponder(p, ref) {
  try {
    if (!dentroDoLimite(1)) throw new Error('limite de ' + MAX_ENVIOS_POR_HORA + ' envios por hora atingido; tente mais tarde');
    const anexo = await lerAnexoDasPartes(p, ref);
    const cx = caixaValida(p.caixa);
    const r = await require('./responder-gmail').responder({ db, gmail: getGmail(cx), p, caixa: await enderecoDaCaixa(cx), montarMime, anexo });
    enviosRecentes.push(Date.now());
    auditoria('resposta_gmail', r.assunto + ' · para ' + r.para + (r.cc.length ? ' (cc ' + r.cc.join(', ') + ')' : '') + (anexo ? ' · anexo ' + anexo.nome : ''), p);
    log('resposta enviada para', r.para + (r.cc.length ? ' + ' + r.cc.length + ' em cópia' : ''), '(' + (p.criadoPor || '') + ')');
    return { status: 'enviado', enviadoEm: agora(), gmailId: r.gmailId, para: r.para, cc: r.cc, assunto: r.assunto };
  } finally { await apagarPartes(p, ref); }
}

async function atenderDisparo(p, ref) {
  // o arquivo não fica no banco, dando certo ou não
  try { return await dispararPara(p, ref); }
  finally { await apagarPartes(p, ref); }
}
async function dispararPara(p, ref) {
  const quem = p.criadoPorUid ? ((await db.collection('usuarios').doc(String(p.criadoPorUid)).get()).data() || {}) : {};
  const papeis = Array.isArray(quem.roles) ? quem.roles : (quem.role ? [quem.role] : []);
  if (!papeis.includes('admin')) throw new Error('só o administrador pode disparar e-mail pra vários clientes');
  const assunto = String(p.assunto || '').trim().slice(0, 200);
  // no HTML pronto, o texto puro (pra quem não abre HTML) sai do próprio HTML
  const corpo = String(p.corpo || (p.formato === 'html' ? htmlParaTexto(String(p.html || '')) : '')).slice(0, 20000);
  if (!assunto) throw new Error('o disparo não tem assunto');
  if (p.formato === 'html' && !String(p.html || '').trim()) throw new Error('o disparo em HTML veio sem o HTML');

  const anexo = await lerAnexoDasPartes(p, ref);

  // destinatários: os clientes escolhidos, com todos os e-mails do cadastro
  const ids = new Set((Array.isArray(p.clienteIds) ? p.clienteIds : []).slice(0, 1000).map(String));
  const ativos = await require('./clientes-cache').clientesAtivos(db, m => log(m));
  const clientes = [];
  ativos.forEach(d => { if (ids.has(d.id)) { const c = Object.assign({ id: d.id }, d.data()); if (enderecosDoCliente(c).length) clientes.push(c); } });
  if (!clientes.length) throw new Error('nenhum dos clientes escolhidos tem e-mail no cadastro');
  const enderecos = [...new Set([].concat(...clientes.map(enderecosDoCliente)))];
  const grupos = [];
  for (let i = 0; i < enderecos.length; i += MAX_CCO) grupos.push(enderecos.slice(i, i + MAX_CCO));
  if (!dentroDoLimite(grupos.length)) throw new Error('limite de ' + MAX_ENVIOS_POR_HORA + ' envios por hora atingido; tente mais tarde');

  const cfg = await configDaCobranca().catch(() => ({}));
  let visual = {};
  if (p.formato === 'html' && p.html) {
    // HTML pronto: vai do jeito que veio (sem a moldura do escritório)
    visual = prepararHtmlPronto(String(p.html).slice(0, 900000));
  } else {
    try { visual = htmlDoDisparo({ assunto, corpo, assinatura: cfg.assinatura || 'Nilma Contabilidade', caixa: CAIXA, anexo: anexo && { nome: anexo.nome, tamanho: anexo.buffer.length } }); }
    catch (err) { log('disparo sai só em texto:', err.message); }
  }

  andamentoAtual = null;
  publicarAndamento({ ativo: true, tipo: 'disparo', motivo: 'pedido por ' + (p.criadoPor || 'alguém'), inicio: agora(), fase: 'enviando',
    feito: 0, total: enderecos.length, texto: 'Disparando "' + assunto.slice(0, 80) + '" para ' + clientes.length + ' clientes' }, true);
  const gmailIds = [];
  let enviados = 0;
  try {
    for (const grupo of grupos) {
      gmailIds.push(await enviar({ para: CAIXA, cco: grupo, assunto, corpo, html: visual.html, imagens: visual.imagens, anexos: anexo ? [anexo] : [] }));
      enviosRecentes.push(Date.now());
      enviados += grupo.length;
      publicarAndamento({ feito: enviados, texto: 'Enviado para ' + enviados + ' de ' + enderecos.length + ' e-mails' });
    }
  } catch (err) {
    publicarAndamento({ ativo: false, fim: agora(), fase: 'erro', texto: 'Parou em ' + enviados + ' de ' + enderecos.length + ': ' + traduzirErro(err) }, true);
    throw new Error((enviados ? 'enviado só para ' + enviados + ' de ' + enderecos.length + ' e-mails; ' : '') + traduzirErro(err));
  }
  publicarAndamento({ ativo: false, fim: agora(), fase: 'concluida', feito: enderecos.length, texto: 'Disparo concluído: ' + clientes.length + ' clientes, ' + enderecos.length + ' e-mails' }, true);
  auditoria('disparo_gmail', '"' + assunto + '" · ' + clientes.length + ' clientes' + (anexo ? ' · ' + anexo.nome : ''), p);
  log('disparo enviado:', clientes.length, 'clientes,', enderecos.length, 'e-mails em', grupos.length, 'mensagem(ns)');
  return { status: 'enviado', enviadoEm: agora(), enviadosPara: clientes.length, enderecos: enderecos.length, gmailIds };
}

// ---------- leitura do Gmail (roda o robô) ----------
let lendo = false;
// A leitura (ou o salvar) que está rodando agora: dá pra parar pela tela
// (pedido tipo 'cancelar') e o vigia para sozinho a que travar.
let filhoAtual = null;
const TRAVADA_MS = 10 * 60 * 1000;      // 10 min sem nenhuma notícia do filho = travou
const LEITURA_MAX_MS = 60 * 60 * 1000;  // e nenhuma leitura passa de 1 h
function pararFilho(motivo) {
  const f = filhoAtual;
  if (!f || f.parado) return false;
  f.parado = motivo;
  log('parando a leitura:', motivo);
  try { f.kill(); } catch (e) {}
  // se não sair por bem em 5 s, sai à força
  setTimeout(() => { try { if (f.exitCode === null) f.kill('SIGKILL'); } catch (e) {} }, 5000);
  return true;
}
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

// ---------- andamento pra tela (robo/estado.andamento) ----------
// O que o robô está fazendo agora e quanto falta. A leitura escreve uma linha
// "ANDAMENTO:{...}" por passo; aqui junta e grava com FREIO: no máximo uma
// gravação a cada ANDAMENTO_A_CADA_MS. Sem isso, 40 e-mails dariam centenas de
// gravações — e cada uma vira leitura em toda tela aberta (foi assim o pico
// de 25/09 com a rota).
const ANDAMENTO_A_CADA_MS = 2000;
let andamentoAtual = null, andamentoTimer = null, andamentoGravadoEm = 0;
function publicarAndamento(parcial, forcar) {
  andamentoAtual = Object.assign({}, andamentoAtual || {}, parcial, { em: agora() });
  if (parcial.texto) {
    const recentes = (andamentoAtual.recentes || []).concat([{ em: agora(), texto: String(parcial.texto).slice(0, 200), destaque: !!parcial.destaque }]);
    andamentoAtual.recentes = recentes.slice(-8);
  }
  delete andamentoAtual.destaque;
  const gravar = () => {
    andamentoTimer = null;
    andamentoGravadoEm = Date.now();
    roboRef.set({ andamento: andamentoAtual }, { merge: true }).catch(() => {});
  };
  if (forcar) { clearTimeout(andamentoTimer); gravar(); return; }
  if (andamentoTimer) return;
  andamentoTimer = setTimeout(gravar, Math.max(0, ANDAMENTO_A_CADA_MS - (Date.now() - andamentoGravadoEm)));
}
// Linha da saída da leitura: se for andamento, publica e some do registro.
function lerLinhaDeAndamento(l) {
  if (!l.startsWith('ANDAMENTO:')) return false;
  try { publicarAndamento(JSON.parse(l.slice(10))); } catch (e) {}
  return true;
}

// Estado que ficou de pé sem nada rodando (vigia reiniciado no meio).
async function limparEstadoPreso(texto) {
  const r = (await roboRef.get()).data() || {};
  const patch = {};
  if (r.status === 'lendo') Object.assign(patch, { status: 'erro', statusEm: agora(), statusMsg: texto });
  if (r.filaAndamento && r.filaAndamento.ativo) patch.filaAndamento = { ativo: false, em: agora() };
  if (Object.keys(patch).length) await roboRef.set(patch, { merge: true });
  if (r.andamento && r.andamento.ativo) {
    andamentoAtual = r.andamento;
    publicarAndamento({ ativo: false, fim: agora(), fase: 'erro', texto: 'A leitura parou: ' + texto + '.' }, true);
  }
  if (Object.keys(patch).length || (r.andamento && r.andamento.ativo)) log('estado preso limpo (' + texto + ')');
}

// As caixas que o robô lê (01/10/2026): a do robô e as dos setores autorizadas com leitura. Cada uma tem a sua
// memória e a sua lista na tela (estado-robo.js e download-attachments.js, por GMAIL_CAIXA).
const NOMES_DAS_CAIXAS = { robo: 'Nilma Contabilidade', contabil: 'setor contábil', fiscal: 'setor fiscal' };
const caixaValida = c => (['robo', 'contabil', 'fiscal'].includes(c) ? c : 'robo');
const caixasQueLe = () => ['robo', 'contabil', 'fiscal'].filter(podeLer);

/** Lê uma caixa de cada vez (todas as que dá para ler); para na primeira cancelada. */
async function rodarTodas(dias, motivo) {
  const resumos = [];
  let ok = true, erro = '';
  for (const caixa of caixasQueLe()) {
    const r = await rodarRobo(dias, motivo, caixa);
    if (r.cancelada) return r;
    if (!r.ok) { ok = false; erro = erro || (NOMES_DAS_CAIXAS[caixa] + ': ' + (r.erro || 'erro')); }
    if (r.resumo) resumos.push((caixa === 'robo' ? '' : NOMES_DAS_CAIXAS[caixa] + ': ') + r.resumo);
  }
  return { ok, resumo: resumos.join(' · '), erro };
}

function rodarRobo(dias, motivo, caixa = 'robo') {
  caixa = caixaValida(caixa);
  if (caixa !== 'robo') motivo = motivo + ', caixa do ' + NOMES_DAS_CAIXAS[caixa];
  const docDaTela = caixa === 'robo' ? roboRef : db.collection('robo').doc('caixa-' + caixa);
  return new Promise(resolve => {
    lendo = true;
    roboRef.set({ status: 'lendo', statusEm: agora(), statusMotivo: motivo }, { merge: true }).catch(() => {});
    log('lendo o Gmail (' + motivo + ')');
    andamentoAtual = null;
    publicarAndamento({ ativo: true, tipo: 'leitura', motivo, inicio: agora(), fase: 'começando', feito: 0, total: 0, texto: 'Começando a leitura do Gmail (' + motivo + ')' }, true);
    const saida = [];
    const filho = spawn(process.execPath, [ROBO, String(dias || 3)], { cwd: __dirname, env: Object.assign({}, process.env, { GMAIL_CAIXA: caixa }) });
    filhoAtual = filho;
    const comecou = Date.now();
    let ultimaNoticia = Date.now();
    const vigiaTrava = setInterval(() => {
      if (Date.now() - ultimaNoticia > TRAVADA_MS) pararFilho('travou (10 min sem andar)');
      else if (Date.now() - comecou > LEITURA_MAX_MS) pararFilho('passou de 1 hora');
    }, 30 * 1000);
    // A saída chega em pedaços: uma linha pode vir partida ao meio. O resto
    // sem quebra de linha espera o próximo pedaço.
    const restos = { out: '', err: '' };
    const guardarDe = qual => b => {
      ultimaNoticia = Date.now();
      const linhas = (restos[qual] + String(b)).split(/\r?\n/);
      restos[qual] = linhas.pop();
      linhas.filter(Boolean).forEach(l => { if (lerLinhaDeAndamento(l)) return; saida.push(l); if (saida.length > 40) saida.shift(); });
    };
    filho.stdout.on('data', guardarDe('out'));
    filho.stderr.on('data', guardarDe('err'));
    filho.on('error', err => {
      lendo = false; log('não consegui iniciar a leitura:', err.message);
      publicarAndamento({ ativo: false, fim: agora(), fase: 'erro', texto: 'Não consegui começar a leitura: ' + err.message }, true);
      resolve({ ok: false, resumo: '', erro: err.message });
    });
    filho.on('close', async code => {
      lendo = false;
      clearInterval(vigiaTrava);
      if (filhoAtual === filho) filhoAtual = null;
      if (filho.parado) {
        const cancelada = /^cancelada/.test(filho.parado);
        const texto = cancelada ? 'Leitura ' + filho.parado + '. O que já tinha sido lido ficou gravado.' : 'A leitura ' + filho.parado + ' e foi interrompida. A próxima leitura continua de onde parou.';
        await roboRef.set({ status: cancelada ? 'ok' : 'erro', statusEm: agora(), statusMsg: texto }, { merge: true }).catch(() => {});
        log(texto);
        publicarAndamento({ ativo: false, fim: agora(), fase: cancelada ? 'concluida' : 'erro', feito: (andamentoAtual && andamentoAtual.feito) || 0, texto }, true);
        if (!cancelada) await alertar('a leitura do Gmail travou', texto + '\nÚltima linha: ' + (saida.slice(-1)[0] || '-'));
        return resolve({ ok: false, resumo: '', erro: texto, cancelada });
      }
      const ultima = saida.filter(l => !/limite de uso/.test(l)).slice(-1)[0] || '';
      let robo = {};
      try { robo = (await docDaTela.get()).data() || {}; } catch (err) { log('não consegui ler o estado depois da leitura:', err.message); }
      const ok = code === 0;
      await roboRef.set({
        status: ok ? 'ok' : 'erro', statusEm: agora(),
        statusMsg: ok ? (robo.ultimaExecucaoResumo || '') : traduzirErro({ message: ultima.replace(/^ERRO:\s*/, '') }),
      }, { merge: true }).catch(() => {});
      log(ok ? 'leitura terminou: ' + (robo.ultimaExecucaoResumo || '') : 'leitura falhou: ' + ultima);
      publicarAndamento({
        ativo: false, fim: agora(), fase: ok ? 'concluida' : 'erro',
        feito: (andamentoAtual && andamentoAtual.total) || 0,
        texto: ok ? 'Leitura concluída: ' + (robo.ultimaExecucaoResumo || 'nada novo') : 'A leitura deu erro: ' + traduzirErro({ message: ultima.replace(/^ERRO:\s*/, '') }),
      }, true);
      // Leitura pedida pela tela já avisa por lá (e pelo alerta do pedido).
      if (!ok && /^automático/.test(motivo)) await alertar('a leitura automática do Gmail falhou', traduzirErro({ message: ultima.replace(/^ERRO:\s*/, '') }));
      resolve({ ok, resumo: robo.ultimaExecucaoResumo || '', erro: ok ? null : ultima });
    });
  });
}

// "Não é deste cliente" (nads, 06/10/2026: "marquei a empresa errada, e não tem como remover"): o e-mail volta para
// "sem cliente". A tela já tirou o remetente do cadastro do cliente; aqui, a caixa da tela mostra o e-mail sem dono, a
// memória do robô o põe de novo em "sem cliente" (a próxima leitura reavalia: se o remetente for de outro cliente, vai
// para ele) e o mês do cliente errado perde a conversa e o que o robô marcou por causa deste e-mail.
async function atenderDesligar(p) {
  const id = String(p.mensagemId || '');
  const clienteId = String(p.clienteId || '');
  if (!id || !clienteId) throw new Error('pedido sem o e-mail ou sem o cliente');
  const caixa = caixaValida(p.caixa);
  const docDaTela = caixa === 'robo' ? roboRef : db.collection('robo').doc('caixa-' + caixa);
  const tela = (await docDaTela.get()).data() || {};
  let remetente = String(p.remetente || '').trim().toLowerCase();
  if (Array.isArray(tela.caixa)) {
    const lista = tela.caixa.map(c => {
      if (c.mensagemId !== id) return c;
      remetente = remetente || String(c.remetente || '').trim().toLowerCase();
      return Object.assign({}, c, { clienteId: null, clienteNome: '', candidatos: [] });
    });
    await docDaTela.set({ caixa: lista }, { merge: true });
  }
  const memoria = db.collection('robo').doc('gmailEstado' + (caixa === 'robo' ? '' : '-' + caixa));
  const m = (await memoria.get()).data() || {};
  const processados = (Array.isArray(m.processados) ? m.processados : []).filter(x => x !== id);
  const semCliente = Object.assign({}, m.semCliente || {});
  if (remetente) semCliente[id] = remetente;
  await memoria.set({ processados, semCliente }, { merge: true });
  // o mês do cliente errado: sai a conversa e o que foi marcado por este e-mail
  const meses = await db.collection('documentosMensal').where('clienteId', '==', clienteId).get();
  let mexidos = 0;
  for (const d of meses.docs) {
    const x = d.data() || {};
    const mensagens = Array.isArray(x.mensagens) ? x.mensagens : [];
    const patch = {};
    if (mensagens.some(k => k && k.mensagemId === id)) patch.mensagens = mensagens.filter(k => !k || k.mensagemId !== id);
    Object.keys(x.detalhes || {}).forEach(t => {
      const det = x.detalhes[t];
      if (det && det.origem === 'gmail' && det.mensagemId === id) { patch[t] = false; patch['detalhes.' + t] = FieldValue.delete(); }
    });
    if (Object.keys(patch).length) { await d.ref.update(patch); mexidos++; }
  }
  log('desligado do cliente', clienteId, 'o e-mail', id, '(' + mexidos + ' mês/meses corrigidos)');
  return { status: 'concluido', concluidoEm: agora(), resumo: 'O e-mail voltou para sem cliente' + (mexidos ? ' e saiu do mês do cliente' : '') + '.' };
}

// Salvar no Drive os anexos de UM e-mail de cliente (botão "Salvar no Drive").
// Roda o próprio robô no modo --mensagem, que já sabe achar o cliente, o mês do
// documento e a pasta; a última linha dele diz o que foi salvo.
// O andamento (baixando do Gmail, salvando no Drive, arquivo a arquivo) vai
// pro mesmo robo/estado.andamento da leitura, com o mesmo freio de 2 s.
function salvarMensagem(p) {
  return new Promise((resolve, reject) => {
    const argsRobo = [ROBO, '--mensagem', String(p.mensagemId)];
    if (p.clienteId) argsRobo.push('--cliente', String(p.clienteId));
    andamentoAtual = null;
    publicarAndamento({
      ativo: true, tipo: 'salvar', mensagemId: String(p.mensagemId), motivo: 'pedido por ' + (p.criadoPor || 'alguém'),
      inicio: agora(), fase: 'começando', feito: 0, total: 0, texto: 'Abrindo o e-mail no Gmail',
    }, true);
    const saida = [];
    const filho = spawn(process.execPath, argsRobo, { cwd: __dirname, env: Object.assign({}, process.env, { GMAIL_CAIXA: caixaValida(p.caixa) }) });
    filhoAtual = filho;
    const restos = { out: '', err: '' };
    const guardarDe = qual => b => {
      const linhas = (restos[qual] + String(b)).split(/\r?\n/);
      restos[qual] = linhas.pop();
      linhas.filter(Boolean).forEach(l => { if (!lerLinhaDeAndamento(l)) saida.push(l); });
    };
    filho.stdout.on('data', guardarDe('out'));
    filho.stderr.on('data', guardarDe('err'));
    const terminar = (ok, texto) => publicarAndamento({
      ativo: false, fim: agora(), fase: ok ? 'concluida' : 'erro',
      feito: (andamentoAtual && andamentoAtual.total) || 0, texto,
    }, true);
    filho.on('error', err => { terminar(false, 'Não consegui começar: ' + err.message); reject(err); });
    filho.on('close', () => {
      if (filhoAtual === filho) filhoAtual = null;
      if (filho.parado) { terminar(false, 'Salvamento ' + filho.parado + '.'); return resolve({ status: 'cancelado', canceladoEm: agora(), erro: filho.parado }); }
      [restos.out, restos.err].filter(Boolean).forEach(l => { if (!lerLinhaDeAndamento(l)) saida.push(l); });
      const linha = saida.filter(l => l.startsWith('RESULTADO:')).pop();
      let r = null;
      try { r = linha ? JSON.parse(linha.slice('RESULTADO:'.length)) : null; } catch (e) { r = null; }
      const erro = !r ? (saida.slice(-1)[0] || 'o robô não respondeu') : r.erro;
      if (erro) { terminar(false, 'Não salvou: ' + traduzirErro({ message: String(erro).replace(/^ERRO:\s*/, '') })); return reject(new Error(erro)); }
      log('salvo no Drive:', r.arquivos, 'arquivo(s) em', r.pasta);
      terminar(true, 'Salvo no Drive: ' + r.arquivos + (r.arquivos === 1 ? ' arquivo' : ' arquivos') + (r.pasta ? ' em ' + r.pasta : ''));
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
  let atendeuAlgum = false;
  try {
    for (;;) {
      const snap = await fila.where('status', '==', 'pendente').get();
      const pendentes = snap.docs.filter(d => d.data().tipo !== 'cancelar').sort((a, b) => String(a.data().criadoEm).localeCompare(String(b.data().criadoEm)));
      if (!pendentes.length) break;
      const doc = pendentes[0];
      const p = doc.data();
      // Marca antes de começar: se o vigia cair no meio, o pedido não é
      // reenviado sozinho ao voltar (e-mail duplicado é pior que um aviso).
      await doc.ref.update({ status: 'processando', processandoEm: agora(), pc: os.hostname() });
      // Pra tela: qual pedido está sendo atendido e quantos faltam (uma
      // gravação por pedido, não por passo).
      const oqueAgora = {
        um: 'Cobrança de ' + (p.clienteNome || p.para || 'um cliente'),
        lote: 'Cobrança em lote' + (Array.isArray(p.clientes) ? ' (' + p.clientes.length + ' clientes)' : ''),
        verificar: 'Leitura do Gmail pedida por ' + (p.criadoPor || 'alguém'),
        salvar: 'Salvando no Drive um e-mail' + (p.clienteNome ? ' de ' + p.clienteNome : ''),
        disparo: 'Disparo "' + String(p.assunto || '').slice(0, 60) + '"',
        responder: 'Resposta de e-mail' + (p.para ? ' para ' + p.para : ''),
        desligar: 'Tirando um e-mail do cliente errado',
      }[p.tipo] || 'Pedido da tela';
      atendeuAlgum = true;
      roboRef.set({ filaAndamento: { ativo: true, atual: oqueAgora, restantes: pendentes.length, desde: agora(), em: agora() } }, { merge: true }).catch(() => {});
      try {
        let resultado;
        if (p.tipo === 'um') resultado = await atenderUm(p);
        else if (p.tipo === 'lote') resultado = await atenderLote(p);
        else if (p.tipo === 'verificar') {
          while (lendo) await new Promise(r => setTimeout(r, 2000));
          const motivoDoPedido = 'pedido por ' + (p.criadoPor || 'alguém');
          const r = p.caixa && podeLer(caixaValida(p.caixa)) ? await rodarRobo(p.dias || 3, motivoDoPedido, caixaValida(p.caixa)) : await rodarTodas(p.dias || 3, motivoDoPedido);
          if (r.cancelada) resultado = { status: 'cancelado', canceladoEm: agora(), resumo: r.erro };
          else if (!r.ok) throw new Error(r.erro || 'o robô terminou com erro');
          else resultado = { status: 'concluido', concluidoEm: agora(), resumo: r.resumo };
        } else if (p.tipo === 'salvar') {
          // Não roda junto com uma leitura automática: as duas mexem no
          // mesmo controle de e-mails já lidos.
          while (lendo) await new Promise(r => setTimeout(r, 2000));
          lendo = true;
          try { resultado = await salvarMensagem(p); } finally { lendo = false; }
        } else if (p.tipo === 'desligar') {
          // mexe na mesma memória da leitura: espera ela acabar
          while (lendo) await new Promise(r => setTimeout(r, 2000));
          lendo = true;
          try { resultado = await atenderDesligar(p); } finally { lendo = false; }
        } else if (p.tipo === 'disparo') resultado = await atenderDisparo(p, doc.ref);
        else if (p.tipo === 'responder') resultado = await atenderResponder(p, doc.ref);
        else throw new Error('tipo de pedido desconhecido: ' + p.tipo);
        await doc.ref.update(resultado);
      } catch (err) {
        const erro = traduzirErro(err);
        log('pedido', doc.id, 'falhou:', erro);
        await doc.ref.update({ status: 'erro', erro, erroEm: agora() }).catch(() => {});
        const oque = { um: 'a cobrança de ' + (p.clienteNome || p.para), lote: 'a cobrança em lote', verificar: 'a verificação do Gmail', salvar: 'salvar anexo no Drive', disparo: 'o disparo "' + (p.assunto || '') + '"', responder: 'a resposta de e-mail' + (p.para ? ' para ' + p.para : ''), desligar: 'tirar o e-mail do cliente errado' }[p.tipo] || 'um pedido';
        await alertar(oque + ' deu erro', 'Pedido de ' + (p.criadoPor || 'alguém') + ' em ' + new Date(p.criadoEm).toLocaleString('pt-BR') + ':\n' + erro);
      }
    }
  } catch (err) {
    log('erro lendo a fila:', err.message);
    filaFalhou = true;
  } finally {
    ocupado = false;
    if (atendeuAlgum) roboRef.set({ filaAndamento: { ativo: false, em: agora() } }, { merge: true }).catch(() => {});
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
  // Vigia que caiu (ou foi atualizado) no meio da leitura deixava "lendo",
  // o andamento e "Atendendo: ..." de pé, e a tela não deixava pedir outra.
  await limparEstadoPreso('o robô reiniciou no meio da leitura; a próxima continua de onde parou').catch(err => log('não consegui limpar o estado:', err.message));

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
  try { require('./fotos-remetentes').iniciarFotosRemetentes(db, log); }
  catch (err) { log('fotos dos remetentes desligadas:', err.message); }
  try { require('./token-novo').iniciarTokenNovo(log); }
  catch (err) { log('troca do token pelo metadado desligada:', err.message); }
  try { require('./avisos-atrasados').iniciarAvisosAtrasados({ db, log, avisos }); }
  catch (err) { log('aviso de tarefas e parcelas atrasadas desligado:', err.message); }
  try { require('./pedidos-do-portal').iniciarPedidosDoPortal(db, log, avisos); }
  catch (err) { log('recados da página do cliente desligados:', err.message); }
  // pedido de liberação do login do nads: avisa os admins no celular
  try { require('./avisos-liberacao-nads').iniciarAvisosDeLiberacao(db, log, avisos); }
  catch (err) { log('aviso de liberação do nads desligado:', err.message); }
  try { require('./envios-do-portal').iniciarEnviosDoPortal(db, log); }
  catch (err) { log('documentos pelo link desligados:', err.message); }
  // Arquivo mandado pelo nads (Tarefas › Drive) para a pasta Claudio Secretario.
  try { require('./envios-do-nads').iniciarEnviosDoNads(db, log); }
  catch (err) { log('envios do nads desligados:', err.message); }
  // e onde cada um foi parar depois do arquivamento (a tela do nads mostra)
  try { require('./envios-do-nads').iniciarDestinoDosEnvios(db, log); }
  catch (err) { log('destino dos envios do nads desligado:', err.message); }
  // Quanto o banco já usou hoje (todo o sistema), pro cartão Saúde do sistema.
  try { require('./uso-banco').iniciarUsoDoBanco(db, log); }
  catch (err) { log('uso do banco desligado:', err.message); }
  // Texto completo de um e-mail, aberto no painel da tela do Robô.
  try { require('./leituras-gmail').iniciarLeiturasGmail(db, log, getGmail); }
  catch (err) { log('texto completo do e-mail desligado:', err.message); }
  // Mapa da pasta do ano no Drive (explorador do Pendências, status pela
  // pasta) e "abrir arquivo" pelo app. Só onde o robô fala com o Drive pela
  // API — na nuvem. Ver drive-indice.js e abrir-do-drive.js.
  if (process.env.USAR_DRIVE_API === '1') {
    try { require('./drive-indice').iniciarIndiceDrive(db, log); }
    catch (err) { log('mapa do Drive desligado:', err.message); }
    try { require('./abrir-do-drive').iniciarAberturaDoDrive(db, log); }
    catch (err) { log('abrir arquivo do Drive desligado:', err.message); }
  }
  // Os dois abaixo mandam e-mail pra CLIENTE e vêm desligados: quem liga é o
  // admin em Pendências › Configurações › Automático. Passam pelo mesmo freio
  // por hora da fila de cobrança.
  // a régua cobra o contábil: sai pela caixa do contábil (ou a do robô, enquanto ela não for autorizada)
  const caixaDaRegua = () => caixaDoDepartamento('contabil');
  const correio = {
    enviar: async dados => { const env = await envioDoSetor('contabil'); return enviar(Object.assign({}, dados, env.respostas ? { respostasPara: env.respostas } : {}), env.caixa); },
    // o endereço que vai no texto ({caixa}): para onde o cliente responde
    endereco: async () => { const env = await envioDoSetor('contabil'); return env.respostas || env.de; },
    podeEnviar: n => dentroDoLimite(n, caixaDaRegua()),
    contar: () => enviosDa(caixaDaRegua()).push(Date.now()),
    registrarCobranca: (c, comp, reg) => registrarCobranca(c, comp, Object.assign({ departamento: 'contabil', caixa: enderecos[caixaDaRegua()] || CAIXA }, reg)),
  };
  // o comprovante de entrega por e-mail continua saindo da caixa do robô
  const correioDoRobo = { enviar, podeEnviar: n => dentroDoLimite(n), contar: () => enviosRecentes.push(Date.now()), registrarCobranca };
  conferirCaixas().then(cx => log('caixas do Gmail:', Object.entries(cx).map(([k, v]) => k + '=' + (v.autorizada ? (v.email || v.erro || '?') : 'não autorizada')).join(', ')));
  setInterval(conferirCaixas, 30 * 60 * 1000);
  try { require('./comprovante-email').iniciarComprovantePorEmail({ db, log, correio: correioDoRobo }); }
  catch (err) { log('comprovante por e-mail desligado:', err.message); }
  try { require('./regua-cobranca').iniciarReguaDeCobranca({ db, log, correio }); }
  catch (err) { log('régua de cobrança desligada:', err.message); }
  limparFila();
  setInterval(limparFila, 24 * 36e5);

  fila.where('status', '==', 'pendente').onSnapshot(
    snap => {
      // "Cancelar" na tela: para a leitura/salvamento em curso agora, sem esperar a fila
      snap.docs.filter(d => d.data().tipo === 'cancelar').forEach(d => {
        const quem = d.data().criadoPor || 'alguém';
        const parou = pararFilho('cancelada por ' + quem);
        d.ref.update({ status: 'concluido', concluidoEm: agora(), resultado: parou ? 'parada' : 'nada rodando' }).catch(() => {});
        // nada rodando: o que a tela mostra como "lendo" é resto; limpa pra poder pedir de novo
        if (!parou && !lendo) limparEstadoPreso('nenhuma leitura estava rodando').catch(() => {});
      });
      if (snap.docs.some(d => d.data().tipo !== 'cancelar')) atenderFila();
    },
    err => { log('perdi a conexão com a fila:', err.message); process.exit(1); }
  );

  if (A_CADA_MIN > 0) {
    setInterval(async () => {
      if (lendo || ocupado) return;
      const dias = await diasDesdeUltimaLeitura();
      if (!lendo && !ocupado) rodarTodas(dias, 'automático a cada ' + A_CADA_MIN + ' min');
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
// O serviço da nuvem (robo.service) religa o vigia 30s depois de qualquer queda. Cada partida lê
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
