// Lista de clientes guardada no PC do robô, pra não reler o cadastro inteiro a
// cada leitura do Gmail.
//
// O robô roda de 2 em 2 horas e lia os ~320 clientes toda vez: perto de 4 mil
// leituras por dia, uns 8% do limite gratuito do banco, pra um cadastro que
// quase não muda. O vigia fica ligado o dia todo, então ele mantém um ouvinte
// (que só cobra o que MUDA) e grava a lista num arquivo local. A leitura do
// Gmail usa o arquivo quando ele está fresco; se o vigia não estiver rodando,
// lê do banco como sempre.
//
// O arquivo tem dado de cliente: fica fora do git (.gitignore).
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, 'clientes-cache.json');
const VALIDADE_MS = 20 * 60 * 1000;   // o vigia regrava a cada 10 min enquanto o ouvinte está vivo

// formato que o resto do robô espera: forEach(d => d.id, d.data())
function comoSnap(lista) {
  return { size: lista.length, forEach: fn => lista.forEach(c => fn({ id: c.id, data: () => c.dados })) };
}

function lerDoArquivo(agora) {
  try {
    const j = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    if (!j || !Array.isArray(j.clientes) || !j.em) return null;
    if ((agora || Date.now()) - new Date(j.em).getTime() > VALIDADE_MS) return null;
    return j.clientes;
  } catch (e) { return null; }
}

// Clientes ativos: do arquivo se estiver fresco, senão do banco.
async function clientesAtivos(db, log) {
  const doArquivo = lerDoArquivo();
  if (doArquivo) { if (log) log('clientes: ' + doArquivo.length + ' do arquivo local (sem ler o banco)'); return comoSnap(doArquivo); }
  return db.collection('clientes').where('ativo', '==', true).get();
}

// No vigia: mantém o arquivo em dia.
function manterArquivo(db, log) {
  let lista = null;
  const gravar = () => {
    if (!lista) return;
    try { fs.writeFileSync(ARQUIVO, JSON.stringify({ em: new Date().toISOString(), clientes: lista })); }
    catch (e) { log('clientes: não consegui gravar o arquivo local -', e.message); }
  };
  db.collection('clientes').where('ativo', '==', true).onSnapshot(snap => {
    lista = snap.docs.map(d => ({ id: d.id, dados: JSON.parse(JSON.stringify(d.data())) }));
    gravar();
  }, err => {
    // sem ouvinte não há garantia de que a lista está em dia: para de renovar
    // e o arquivo vence sozinho em 20 minutos
    lista = null;
    log('clientes: perdi o ouvinte do cadastro -', err.message);
  });
  setInterval(gravar, 10 * 60 * 1000);
  log('lista de clientes mantida em arquivo local (a leitura do Gmail deixa de reler o cadastro)');
}

module.exports = { clientesAtivos, manterArquivo, lerDoArquivo, comoSnap, ARQUIVO, VALIDADE_MS };
