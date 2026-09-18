// Confere quais modelos do Gemini a sua chave de verdade tem acesso, e se
// o modelo salvo em Perfil -> Reforço de IA existe mesmo. Só lista
// metadados (não gera resposta, não gasta a cota diária de geração).
// Uso: node checar-modelos.js
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

function lerChave() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try {
    return (JSON.parse(fs.readFileSync(path.join(__dirname, 'gemini_key.json'), 'utf8')).apiKey || '').trim();
  } catch (e) { return null; }
}

async function main() {
  const chave = lerChave();
  if (!chave) { console.log('Não achei scripts/gemini_key.json aqui.'); return; }

  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + chave);
  const j = await r.json();
  if (!r.ok) { console.log('A API recusou a chamada:', JSON.stringify(j)); return; }
  const nomes = (j.models || []).map(m => m.name.replace('models/', ''));
  console.log('Total de modelos que essa chave enxerga:', nomes.length);

  const db = getDb('entregas-2e5e2');
  const cfg = await db.doc('config/integracoes').get();
  const salvo = cfg.exists ? cfg.data().iaModelo : null;
  console.log('Modelo salvo em Perfil -> Reforço de IA:', salvo || '(em branco, usa o padrão)');
  console.log('Esse modelo existe pra essa chave?', nomes.indexOf(salvo) !== -1);

  ['gemini-flash-latest', 'gemini-pro-latest', 'gemini-2.5-flash', 'gemini-2.5-pro'].forEach(function (m) {
    console.log(m + ':', nomes.indexOf(m) !== -1 ? 'existe' : 'NÃO existe pra essa chave');
  });
}
main().catch(e => console.error('ERRO:', e.message));
