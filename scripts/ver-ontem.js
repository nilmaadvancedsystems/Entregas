// Lista (sem baixar nada) os e-mails de ontem com anexo que mencionem
// extrato/comprovante/aplicação, pra conferência manual.
const { getGmail } = require('./gmail-client');

function formatarData(d) {
  return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
}

async function main() {
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  const depoisDeOntem = new Date(hoje);

  const query = `has:attachment (extrato OR aplicação OR aplicacao OR comprovante OR investimento) after:${formatarData(ontem)} before:${formatarData(depoisDeOntem)} in:inbox`;
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
