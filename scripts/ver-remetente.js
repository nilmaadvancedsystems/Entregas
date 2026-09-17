// Lista (sem baixar nada) os e-mails com anexo de um remetente específico,
// pra conferência manual. Uso: node ver-remetente.js <trecho_do_email> [dias]
const { getGmail } = require('./gmail-client');

async function main() {
  const trecho = process.argv[2];
  const dias = parseInt(process.argv[3], 10) || 60;
  if (!trecho) { console.error('Uso: node ver-remetente.js <trecho_do_email> [dias]'); process.exit(1); }

  const query = `from:${trecho} has:attachment newer_than:${dias}d`;
  console.log('Query:', query);

  const gmail = getGmail();
  const lista = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 50 });
  const mensagens = lista.data.messages || [];
  console.log('Encontrados:', mensagens.length);
  console.log('---');

  for (const { id } of mensagens) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
    const headers = msg.data.payload.headers || [];
    const from = (headers.find(h => h.name === 'From') || {}).value || '';
    const subject = (headers.find(h => h.name === 'Subject') || {}).value || '';
    const date = (headers.find(h => h.name === 'Date') || {}).value || '';
    console.log('De:', from);
    console.log('Assunto:', subject);
    console.log('Data:', date);
    console.log('---');
  }
}

main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
