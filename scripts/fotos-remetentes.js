// Foto de perfil do Google de quem manda e-mail, pra tela do Robô do Gmail.
//
// O Gmail não entrega a foto do remetente. Quem entrega é a API de Contatos
// (People): os contatos salvos e os "outros contatos", que o Gmail cria
// sozinho com todo mundo que trocou e-mail com a caixa. Cada um vem com a
// foto do perfil do Google, quando a pessoa tem.
//
// A cada 6 h o robô lê as duas listas e grava em robo/fotos um mapa
// e-mail -> endereço da foto (lh3.googleusercontent.com). A tela usa o mapa;
// quem não tem foto (ou foto padrão) continua com as iniciais.
//
// Precisa da permissão de contatos (gmail-auth.js) e da People API ligada no
// projeto do Google Cloud. Sem isso grava só o motivo em robo/fotos.erro e
// tenta de novo na próxima volta.
//
// Quem não tem foto do Google (Hotmail, Outlook, Yahoo... — a Microsoft não
// deixa ver a foto de fora) ainda pode ter (pedido do escritório, 28/09/2026):
//   1. foto do Gravatar (serviço de foto por e-mail), se a pessoa cadastrou;
//   2. o logo do site, quando o e-mail é de domínio próprio da empresa
//      (@padaria.com.br) — vai em robo/fotos.porDominio, um por domínio.
// Só entra o que existe de verdade (o serviço responde 404 quando não tem).
const crypto = require('crypto');
const { google } = require('googleapis');
const { getAuth } = require('./gmail-client');

const A_CADA_MS = 6 * 36e5;
const MAX_FOTOS = 4000;

// Pessoas da API -> { email: url }. Foto "default" (a letra colorida do Google) não serve.
function fotosDasPessoas(pessoas) {
  const mapa = {};
  (pessoas || []).forEach(p => {
    const foto = (p.photos || []).find(f => f && f.url && !f.default);
    if (!foto) return;
    const url = String(foto.url).replace(/=s\d+(-[a-z]+)?$/i, '') + '=s96-c';
    (p.emailAddresses || []).forEach(e => {
      const email = String(e.value || '').trim().toLowerCase();
      if (email && !mapa[email]) mapa[email] = url;
    });
  });
  return mapa;
}

// Domínios de e-mail pessoal: o logo do site seria o do provedor, não o do cliente.
const PESSOAIS = new Set(('gmail.com googlemail.com hotmail.com hotmail.com.br outlook.com outlook.com.br live.com ' +
  'live.com.br msn.com yahoo.com yahoo.com.br ymail.com icloud.com me.com mac.com bol.com.br uol.com.br terra.com.br ' +
  'ig.com.br globo.com globomail.com r7.com zipmail.com.br oi.com.br aol.com proton.me protonmail.com gmx.com zoho.com').split(' '));

// Todos os e-mails de uma lista de pessoas da API (com ou sem foto).
function emailsDasPessoas(pessoas) {
  const lista = [];
  (pessoas || []).forEach(p => (p.emailAddresses || []).forEach(e => {
    const email = String(e.value || '').trim().toLowerCase();
    if (email) lista.push(email);
  }));
  return lista;
}
function dominioDe(email) { const m = /@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(String(email || '').trim()); return m ? m[1].toLowerCase() : ''; }
function urlGravatar(email) { return 'https://www.gravatar.com/avatar/' + crypto.createHash('md5').update(String(email).trim().toLowerCase()).digest('hex') + '?s=96&d=404'; }
function urlLogo(dominio) { return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://' + dominio + '&size=128'; }

// "Existe?" com memória: o que não existe só é perguntado de novo depois de 7 dias.
const REPERGUNTAR_MS = 7 * 864e5;
const jaVisto = new Map();   // url -> { existe, em }
async function existe(url) {
  const v = jaVisto.get(url);
  if (v && (v.existe || Date.now() - v.em < REPERGUNTAR_MS)) return v.existe;
  let ok = false;
  try { const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(6000) }); ok = r.status === 200; } catch (e) { ok = false; }
  jaVisto.set(url, { existe: ok, em: Date.now() });
  return ok;
}
async function emLotes(itens, fn, simultaneos) {
  for (let i = 0; i < itens.length; i += simultaneos) await Promise.all(itens.slice(i, i + simultaneos).map(fn));
}

// Pra quem ficou sem foto do Google: Gravatar por e-mail e logo por domínio próprio.
async function fotosDeFora(emails, jaTem) {
  const porEmail = {}, porDominio = {};
  const semFoto = Array.from(new Set(emails)).filter(e => !jaTem[e]);
  await emLotes(semFoto, async email => { if (await existe(urlGravatar(email))) porEmail[email] = urlGravatar(email).replace('&d=404', ''); }, 8);
  const dominios = Array.from(new Set(semFoto.filter(e => !porEmail[e]).map(dominioDe))).filter(d => d && !PESSOAIS.has(d));
  await emLotes(dominios, async d => { if (await existe(urlLogo(d))) porDominio[d] = urlLogo(d); }, 8);
  return { porEmail, porDominio };
}

async function lerTudo(chamar, campo) {
  const todos = [];
  let pageToken;
  for (let i = 0; i < 20; i++) {
    const r = await chamar(pageToken);
    (r.data[campo] || []).forEach(x => todos.push(x));
    pageToken = r.data.nextPageToken;
    if (!pageToken) break;
  }
  return todos;
}

function iniciarFotosRemetentes(db, log) {
  const ref = db.collection('robo').doc('fotos');
  let ultimoJson = '';
  async function atualizar() {
    // Sem a permissão de contatos o Google não entra, mas o Gravatar e os
    // logos (pelos e-mails do cadastro de clientes) seguem: o motivo vai em
    // robo/fotos.erro pra aparecer que falta autorizar.
    let outros = [], salvos = [], motivo = null;
    try {
      const people = google.people({ version: 'v1', auth: getAuth() });
      outros = await lerTudo(t => people.otherContacts.list({ pageSize: 1000, readMask: 'emailAddresses,photos', pageToken: t }), 'otherContacts');
      try {
        salvos = await lerTudo(t => people.people.connections.list({ resourceName: 'people/me', pageSize: 1000, personFields: 'emailAddresses,photos', pageToken: t }), 'connections');
      } catch (e) { /* sem contatos salvos ou sem essa permissão: segue com os outros */ }
    } catch (err) {
      const m = err && err.message ? err.message : String(err);
      motivo = /insufficient|scope|403/i.test(m) ? 'falta autorizar os contatos (rode gmail-auth.js de novo)'
        : /People API has not been used|disabled|SERVICE_DISABLED/i.test(m) ? 'a People API não está ligada no projeto do Google Cloud' : m;
      log('fotos dos remetentes: sem o Google -', motivo);
    }
    try {
      const mapa = Object.assign(fotosDasPessoas(outros), fotosDasPessoas(salvos));
      // e-mails de clientes também (nem todo cliente já está nos contatos)
      const emails = emailsDasPessoas(outros).concat(emailsDasPessoas(salvos));
      try {
        const snap = await require('./clientes-cache').clientesAtivos(db);
        snap.forEach(d => { const c = d.data() || {}; [c.email].concat(Array.isArray(c.emails) ? c.emails : []).forEach(e => { if (e) emails.push(String(e).trim().toLowerCase()); }); });
      } catch (e) { /* sem a lista de clientes: segue com os contatos */ }
      const doGoogle = Object.keys(mapa).length;
      const fora = await fotosDeFora(emails, mapa);
      Object.assign(mapa, fora.porEmail);
      const chaves = Object.keys(mapa).slice(0, MAX_FOTOS);
      const porEmail = {}; chaves.forEach(k => { porEmail[k] = mapa[k]; });
      const porDominio = fora.porDominio;
      const json = JSON.stringify([porEmail, porDominio, motivo]);
      if (json === ultimoJson) return;
      ultimoJson = json;
      await ref.set(Object.assign({ porEmail, porDominio, total: chaves.length, em: new Date().toISOString(), erro: motivo }, motivo ? { erroEm: new Date().toISOString() } : {}));
      log('fotos dos remetentes:', doGoogle, 'do Google,', Object.keys(fora.porEmail).length, 'do Gravatar,', Object.keys(porDominio).length, 'logos de empresa');
    } catch (err) {
      const m = err && err.message ? err.message : String(err);
      log('fotos dos remetentes: não gravei -', m);
      await ref.set({ erro: motivo || m, erroEm: new Date().toISOString() }, { merge: true }).catch(() => {});
    }
  }
  setTimeout(atualizar, 90 * 1000);
  setInterval(atualizar, A_CADA_MS);
  log('fotos dos remetentes ligadas (a cada 6 h, pela API de contatos do Google)');
}

module.exports = { fotosDasPessoas, emailsDasPessoas, dominioDe, urlGravatar, PESSOAIS, iniciarFotosRemetentes };
