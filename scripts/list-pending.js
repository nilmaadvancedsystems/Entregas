// Lista os pedidos de e-mail pendentes na coleção solicitacoesEmail.
const { getDb } = require('./firestore-client');

async function main() {
  const db = getDb('entregas-2e5e2');
  const snap = await db.collection('solicitacoesEmail').where('status', '==', 'pendente').get();
  const pedidos = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  console.log(JSON.stringify(pedidos, null, 2));
}

main().catch(err => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
