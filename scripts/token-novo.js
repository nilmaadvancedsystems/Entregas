// Trocar o token do Gmail do robô da nuvem sem entrar na máquina.
//
// Quem refaz a autorização (node gmail-auth.js, num computador com navegador)
// cola o token novo no metadado "gmail-token-novo" da máquina robo-nilma. A
// cada 5 minutos o robô olha esse metadado; se o token for outro, guarda o
// atual em gmail_token.json.anterior, grava o novo e sai — o serviço religa
// sozinho em 30 s já com ele. Token igual ao do disco não faz nada, então o
// metadado pode ficar lá (ou ser apagado depois, tanto faz).
//
// Fora da nuvem do Google (o PC do escritório) o metadado não existe e nada
// acontece.
const fs = require('fs');
const path = require('path');

const TOKEN = path.join(__dirname, 'gmail_token.json');
const URL_META = 'http://metadata.google.internal/computeMetadata/v1/instance/attributes/gmail-token-novo';

// -> o token novo (objeto) se ele serve e é diferente do atual; senão null
function tokenParaTrocar(textoNovo, textoAtual) {
  let novo, atual = {};
  try { novo = JSON.parse(String(textoNovo || '').trim()); } catch (e) { return null; }
  if (!novo || typeof novo !== 'object' || !novo.refresh_token) return null;
  try { atual = JSON.parse(textoAtual || '{}'); } catch (e) { atual = {}; }
  if (atual.refresh_token === novo.refresh_token && (atual.scope || '') === (novo.scope || '')) return null;
  return novo;
}

function iniciarTokenNovo(log) {
  if (process.env.GMAIL_TOKEN) return;   // token vindo de variável de ambiente: não é este caso
  async function olhar() {
    let texto;
    try {
      const r = await fetch(URL_META, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) });
      if (!r.ok) return;                  // sem o metadado (404) ou fora da nuvem
      texto = await r.text();
    } catch (e) { return; }
    let atual = '';
    try { atual = fs.readFileSync(TOKEN, 'utf8'); } catch (e) {}
    const novo = tokenParaTrocar(texto, atual);
    if (!novo) return;
    try { if (atual) fs.writeFileSync(TOKEN + '.anterior', atual, { mode: 0o600 }); } catch (e) {}
    fs.writeFileSync(TOKEN, JSON.stringify(novo, null, 2), { mode: 0o600 });
    log('token do Gmail trocado pelo metadado gmail-token-novo; religando o robô pra usar o novo');
    setTimeout(() => process.exit(0), 2000);
  }
  setTimeout(olhar, 20 * 1000);
  setInterval(olhar, 5 * 60 * 1000);
}

module.exports = { tokenParaTrocar, iniciarTokenNovo };
