// Autoriza este PC a ler e ENVIAR pelo Gmail (nilmacontabilidade@gmail.com) via OAuth,
// uma única vez. Abre um servidor local temporário só pra capturar o
// "code" que o Google devolve depois do consentimento, troca por um
// refresh_token e salva em gmail_token.json (nunca vai pro git).
const fs = require('fs');
const http = require('http');
const { google } = require('googleapis');

const CLIENT_PATH = __dirname + '/gmail_oauth_client.json';
const TOKEN_PATH = __dirname + '/gmail_token.json';
// readonly: o robô lê e baixa anexos. send: o vigia envia as cobranças que a
// tela põe na fila. Não pede permissão de apagar nem de mexer em outros e-mails.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];
const PORT = 51733;

const creds = JSON.parse(fs.readFileSync(CLIENT_PATH, 'utf8')).installed;
const redirectUri = `http://localhost:${PORT}`;
const oAuth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret, redirectUri);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
});

console.log('AUTH_URL:' + authUrl);

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/')) return;
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get('code');
  if (!code) {
    res.end('Sem código na URL. Pode fechar esta aba.');
    return;
  }
  res.end('Autorizado! Pode fechar esta aba e voltar pro Claude.');
  server.close();
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('TOKEN_SALVO_OK');
    process.exit(0);
  } catch (err) {
    console.error('ERRO_TROCA_TOKEN:', err.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('Aguardando autorização em ' + redirectUri + ' ...');
});

setTimeout(() => {
  console.error('TIMEOUT: ninguém autorizou em 15 minutos.');
  process.exit(1);
}, 15 * 60 * 1000);
