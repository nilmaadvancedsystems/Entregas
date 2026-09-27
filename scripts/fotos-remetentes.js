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
    try {
      const people = google.people({ version: 'v1', auth: getAuth() });
      const outros = await lerTudo(t => people.otherContacts.list({ pageSize: 1000, readMask: 'emailAddresses,photos', pageToken: t }), 'otherContacts');
      let salvos = [];
      try {
        salvos = await lerTudo(t => people.people.connections.list({ resourceName: 'people/me', pageSize: 1000, personFields: 'emailAddresses,photos', pageToken: t }), 'connections');
      } catch (e) { /* sem contatos salvos ou sem essa permissão: segue com os outros */ }
      const mapa = Object.assign(fotosDasPessoas(outros), fotosDasPessoas(salvos));
      const chaves = Object.keys(mapa).slice(0, MAX_FOTOS);
      const porEmail = {}; chaves.forEach(k => { porEmail[k] = mapa[k]; });
      const json = JSON.stringify(porEmail);
      if (json === ultimoJson) return;
      ultimoJson = json;
      await ref.set({ porEmail, total: chaves.length, em: new Date().toISOString(), erro: null });
      log('fotos dos remetentes:', chaves.length, 'com foto do Google');
    } catch (err) {
      const m = err && err.message ? err.message : String(err);
      const motivo = /insufficient|scope|403/i.test(m) ? 'falta autorizar os contatos (rode gmail-auth.js de novo)'
        : /People API has not been used|disabled|SERVICE_DISABLED/i.test(m) ? 'a People API não está ligada no projeto do Google Cloud' : m;
      log('fotos dos remetentes: não li -', motivo);
      await ref.set({ erro: motivo, erroEm: new Date().toISOString() }, { merge: true }).catch(() => {});
    }
  }
  setTimeout(atualizar, 90 * 1000);
  setInterval(atualizar, A_CADA_MS);
  log('fotos dos remetentes ligadas (a cada 6 h, pela API de contatos do Google)');
}

module.exports = { fotosDasPessoas, iniciarFotosRemetentes };
