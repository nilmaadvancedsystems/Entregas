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

// (o arquivo de cada caixa vem de gmail-client.js CAIXAS)
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

// Desde 01/10/2026 vale para as três caixas (gmail-client.js CAIXAS): gmail-token-novo (robô),
// gmail-token-contabil-novo e gmail-token-fiscal-novo. A caixa nova chega assim, sem entrar na máquina.
function iniciarTokenNovo(log) {
  const { CAIXAS } = require('./gmail-client');
  async function olharCaixa(caixa) {
    const c = CAIXAS[caixa];
    if (process.env[c.variavel]) return false;   // token vindo de variável de ambiente: não é este caso
    let texto;
    try {
      const r = await fetch(URL_META.replace('gmail-token-novo', c.metadado), { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) });
      if (!r.ok) return false;            // sem o metadado (404) ou fora da nuvem
      texto = await r.text();
    } catch (e) { return false; }
    let atual = '';
    try { atual = fs.readFileSync(c.arquivo, 'utf8'); } catch (e) {}
    const novo = tokenParaTrocar(texto, atual);
    if (!novo) return false;
    try { if (atual) fs.writeFileSync(c.arquivo + '.anterior', atual, { mode: 0o600 }); } catch (e) {}
    fs.writeFileSync(c.arquivo, JSON.stringify(novo, null, 2), { mode: 0o600 });
    log('token do Gmail (' + caixa + ') trocado pelo metadado ' + c.metadado);
    return true;
  }
  async function olhar() {
    let trocou = false;
    for (const caixa of Object.keys(CAIXAS)) if (await olharCaixa(caixa)) trocou = true;
    if (!trocou) return;
    log('religando o robô pra usar o token novo');
    setTimeout(() => process.exit(0), 2000);
  }
  setTimeout(olhar, 20 * 1000);
  setInterval(olhar, 5 * 60 * 1000);
}

module.exports = { tokenParaTrocar, iniciarTokenNovo };
