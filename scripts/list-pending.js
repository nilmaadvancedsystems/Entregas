// Lista, para a competência informada (padrão: mês atual), os clientes
// ativos que ainda têm algum documento (extrato/comprovante/aplicacao)
// desmarcado na grade de Pendencias-e-envio-automatico-via-Gmail.html.
// Uso: node list-pending.js [AAAA-MM]
const { getDb } = require('./firestore-client');

const TIPOS = ['extrato', 'comprovante', 'aplicacao'];
const NOMES = { extrato: 'Extrato Bancário', comprovante: 'Comprovante', aplicacao: 'Aplicação' };

function competenciaAtual() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

async function main() {
  const competencia = process.argv[2] || competenciaAtual();
  const db = getDb('entregas-2e5e2');

  const [clientesSnap, docsSnap] = await Promise.all([
    db.collection('clientes').where('ativo', '==', true).get(),
    db.collection('documentosMensal').where('competencia', '==', competencia).get(),
  ]);

  const statusPorCliente = new Map();
  docsSnap.forEach(d => statusPorCliente.set(d.data().clienteId, d.data()));

  const pendentes = [];
  clientesSnap.forEach(d => {
    const cliente = Object.assign({ id: d.id }, d.data());
    if (!cliente.email) return; // sem e-mail, não dá pra cobrar
    const status = statusPorCliente.get(cliente.id) || {};
    const faltando = TIPOS.filter(t => !status[t]).map(t => NOMES[t]);
    if (faltando.length === 0) return;
    pendentes.push({
      clienteId: cliente.id,
      clienteNome: cliente.nome,
      email: cliente.email,
      competencia: competencia,
      documentosPendentes: faltando,
    });
  });

  console.log(JSON.stringify(pendentes, null, 2));
  console.error('Total pendentes com e-mail:', pendentes.length, '/ competência', competencia);
}

main().catch(err => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
