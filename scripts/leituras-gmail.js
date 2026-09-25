// Texto completo de um e-mail, pedido pela tela do Robô do Gmail.
//
// A lista da tela mostra só o começo do e-mail (o "trecho" que o robô grava em
// robo/estado.caixa). Ao abrir um e-mail, a tela grava um pedido em
// leiturasGmail ({ mensagemId, status: 'pendente' }). O robô:
//   1. confere que o e-mail é um dos que ele mesmo listou pra tela (caixa,
//      spam ou remetentes sem cliente) — o pedido não pode virar um jeito de
//      ler qualquer e-mail da caixa do escritório;
//   2. lê o e-mail inteiro no Gmail (format: 'full');
//   3. tira o texto (text/plain; sem ele, o HTML sem as marcas);
//   4. grava o texto no próprio pedido, e apaga o pedido pouco depois.
//
// Nada fica guardado: o texto vive no pedido por TEXTO_DURA_MS e some. Quem
// lê é só quem pediu (regras do Firestore), e só admin ou contábil pede.
const { ouvir } = require('./ouvinte');

const TEXTO_DURA_MS = 10 * 60 * 1000;
const TEXTO_MAXIMO = 60000;    // letras; e-mail maior que isso vem cortado (1 MB por documento)
const ID_VALIDO = /^[0-9a-f]{10,32}$/i;

function cabecalho(headers, nome) {
  return ((headers || []).find(h => String(h.name).toLowerCase() === nome.toLowerCase()) || {}).value || '';
}

// O corpo vem do Gmail em base64 "de URL", nos bytes do charset do e-mail.
function decodificarCorpo(part) {
  const dados = part && part.body && part.body.data;
  if (!dados) return '';
  const bytes = Buffer.from(String(dados).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const tipo = cabecalho(part.headers, 'Content-Type');
  const m = tipo.match(/charset="?([\w.:-]+)"?/i);
  const charset = m ? m[1].toLowerCase() : 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); }
  catch (e) { return bytes.toString('utf8'); }
}

function decodificarEntidades(t) {
  return String(t || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// HTML sem as marcas: quebra de linha onde o e-mail quebrava, o resto some.
function htmlParaTexto(html) {
  return decodificarEntidades(String(html || '')
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Primeiro text/plain que não é anexo; sem ele, o primeiro text/html.
function acharParte(part, tipo) {
  if (!part) return null;
  if (part.mimeType === tipo && !part.filename && part.body && part.body.data) return part;
  for (const p of part.parts || []) {
    const achou = acharParte(p, tipo);
    if (achou) return achou;
  }
  return null;
}

function textoDoEmail(payload) {
  const plano = acharParte(payload, 'text/plain');
  let texto = plano ? decodificarCorpo(plano).replace(/\r\n/g, '\n').trim() : '';
  if (!texto) {
    const html = acharParte(payload, 'text/html');
    texto = html ? htmlParaTexto(decodificarCorpo(html)) : '';
  }
  return texto.replace(/\n{3,}/g, '\n\n');
}

function anexosDe(part, acc) {
  if (!part) return acc;
  if (part.filename && part.body && part.body.attachmentId) acc.push({ nome: part.filename, tamanho: Number(part.body.size || 0) });
  (part.parts || []).forEach(p => anexosDe(p, acc));
  return acc;
}

// E-mails que o robô pôs na tela: só esses podem ser lidos por este caminho.
async function mensagensDaTela(db) {
  const r = (await db.collection('robo').doc('estado').get()).data() || {};
  const ids = new Set();
  ['caixa', 'spam', 'naoReconhecidos'].forEach(k => (Array.isArray(r[k]) ? r[k] : []).forEach(m => { if (m && m.mensagemId) ids.add(String(m.mensagemId)); }));
  return ids;
}

function iniciarLeiturasGmail(db, log, getGmail, opcoes) {
  const pedidos = db.collection('leiturasGmail');

  async function atender(doc) {
    const ref = doc.ref;
    const p = doc.data() || {};
    try {
      const id = String(p.mensagemId || '');
      if (!ID_VALIDO.test(id)) throw new Error('e-mail inválido');
      if (!(await mensagensDaTela(db)).has(id)) throw new Error('este e-mail não está mais na lista do robô');
      await ref.update({ status: 'lendo' });
      const msg = (await getGmail().users.messages.get({ userId: 'me', id, format: 'full' })).data;
      const headers = (msg.payload && msg.payload.headers) || [];
      let texto = textoDoEmail(msg.payload);
      const truncado = texto.length > TEXTO_MAXIMO;
      if (truncado) texto = texto.slice(0, TEXTO_MAXIMO);
      await ref.update({
        status: 'pronto', texto, truncado,
        de: cabecalho(headers, 'From'), para: cabecalho(headers, 'To'), cc: cabecalho(headers, 'Cc'),
        assunto: cabecalho(headers, 'Subject'),
        em: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : '',
        anexos: anexosDe(msg.payload, []).slice(0, 50),
        prontoEm: new Date().toISOString(),
      });
      log('leitura de e-mail:', id, '(' + texto.length + ' letras) para', p.criadoPor || 'alguém');
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      await ref.update({ status: 'erro', erro: msg, erroEm: new Date().toISOString() }).catch(() => {});
      log('leitura de e-mail falhou:', msg);
    }
    // O texto não fica guardado: o pedido some depois de lido.
    setTimeout(() => ref.delete().catch(() => {}), TEXTO_DURA_MS);
  }

  // Pedido que sobrou de um robô anterior (reiniciou antes de apagar).
  async function limpar() {
    try {
      const velhos = await pedidos.where('criadoEm', '<', new Date(Date.now() - TEXTO_DURA_MS).toISOString()).limit(200).get();
      for (const d of velhos.docs) await d.ref.delete();
    } catch (e) {}
  }

  if (opcoes && opcoes.semFila) return { atender };
  const fila = [];
  let ocupado = false;
  async function andar() {
    if (ocupado) return;
    ocupado = true;
    try { while (fila.length) await atender(fila.shift()); } finally { ocupado = false; }
  }
  ouvir('leituras do Gmail', () => pedidos.where('status', '==', 'pendente'), snap => {
    snap.docChanges().forEach(ch => { if (ch.type === 'added') { fila.push(ch.doc); andar(); } });
  }, log);
  limpar();
  setInterval(limpar, 5 * 60 * 1000);
  log('texto completo do e-mail pela tela ligado (apaga em ' + Math.round(TEXTO_DURA_MS / 60000) + ' min)');
}

module.exports = { iniciarLeiturasGmail, textoDoEmail, htmlParaTexto };
