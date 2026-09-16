// Atualiza o status de um pedido em solicitacoesEmail.
// Uso: node mark-status.js <docId> <status> ["mensagem de erro opcional"]
const { getDb } = require('./firestore-client');

async function main() {
  const [id, status, erro] = process.argv.slice(2);
  if (!id || !status) {
    console.error('Uso: node mark-status.js <docId> <pendente|enviado|erro> ["mensagem"]');
    process.exit(1);
  }
  const db = getDb('entregas-2e5e2');
  const dados = { status: status, atualizadoEm: new Date().toISOString() };
  if (status === 'enviado') dados.enviadoEm = new Date().toISOString();
  if (status === 'erro') dados.erroMensagem = erro || 'erro não especificado';
  await db.collection('solicitacoesEmail').doc(id).update(dados);
  console.log('OK: pedido', id, '->', status);
}

main().catch(err => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
