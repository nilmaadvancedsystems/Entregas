// Autoriza este PC a ler e ENVIAR pelo Gmail (nilmacontabilidade@gmail.com) via OAuth,
// uma única vez. Abre um servidor local temporário só pra capturar o
// "code" que o Google devolve depois do consentimento, troca por um
// refresh_token e salva em gmail_token.json (nunca vai pro git).
const fs = require('fs');
const http = require('http');
const { google } = require('googleapis');

const CLIENT_PATH = __dirname + '/gmail_oauth_client.json';
// --caixa contabil|fiscal (01/10/2026): autoriza a caixa da cobrança de um departamento, com menos poder que o
// robô: o contábil lê e envia (as respostas dos clientes voltam para lá), o fiscal só envia. Sem --caixa, o robô.
const { CAIXAS } = require('./gmail-client');
const iCaixa = process.argv.indexOf('--caixa');
const CAIXA = iCaixa !== -1 ? process.argv[iCaixa + 1] : 'robo';
if (!CAIXAS[CAIXA]) { console.error('caixa desconhecida: ' + CAIXA + ' (use contabil ou fiscal)'); process.exit(1); }
const TOKEN_PATH = CAIXAS[CAIXA].arquivo;
// O que esta conta autoriza o robô a fazer — nada além disto.
//
// gmail.readonly: ler e baixar anexo.  gmail.send: enviar as cobranças que a
// tela põe na fila.  drive.readonly: enxergar a pasta "Claudio Secretario"
// para achar o mês certo e reconhecer anexo repetido.  drive.file: gravar,
// e só no que ele mesmo criar.
//
// contacts.other.readonly + contacts.readonly: só LER os contatos (os salvos
// e os "outros contatos", que o Gmail cria com quem trocou e-mail) — é daí que
// vem a foto de perfil do Google de quem manda e-mail, pra tela do Robô
// (scripts/fotos-remetentes.js). Não dá pra criar, mudar nem apagar contato.
//
// Nenhum deles dá poder de apagar. Não existe aqui gmail.modify (que mexeria
// nos e-mails do escritório) nem o drive inteiro (que apagaria arquivo). Se um
// dia alguém precisar disso, terá de acrescentar nesta lista, à vista de todos,
// e pedir a autorização de novo.
const SCOPES_DO_ROBO = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
];
const SCOPES = {
  robo: SCOPES_DO_ROBO,
  contabil: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
  // só enviar; o openid + userinfo.email só dizem QUAL é a conta (o robô precisa do endereço para o remetente),
  // sem ler nenhum e-mail
  fiscal: ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send'],
}[CAIXA];
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
    // Guarda o token anterior antes de trocar: se a autorização nova vier
    // capenga, dá pra voltar renomeando um arquivo, sem o robô ficar mudo.
    try { fs.copyFileSync(TOKEN_PATH, TOKEN_PATH + '.anterior'); } catch (e) { /* primeira vez */ }
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('TOKEN_SALVO_OK (' + CAIXA + ')');
    // qual conta autorizou (para não autorizar a conta errada sem perceber)
    try {
      oAuth2Client.setCredentials(tokens);
      const email = CAIXA === 'fiscal'
        ? (await google.oauth2({ version: 'v2', auth: oAuth2Client }).userinfo.get()).data.email
        : (await google.gmail({ version: 'v1', auth: oAuth2Client }).users.getProfile({ userId: 'me' })).data.emailAddress;
      console.log('CONTA: ' + email);
    } catch (e) { console.log('CONTA: (não consegui ler: ' + e.message + ')'); }
    // Robô na nuvem: o token novo vai pro metadado "gmail-token-novo" da
    // máquina (Compute Engine › robo-nilma › Editar › Metadados); o robô troca
    // sozinho em até 5 minutos (scripts/token-novo.js).
    console.log('\nPara o robô da nuvem, copie o texto abaixo para o metadado "' + CAIXAS[CAIXA].metadado + '" da máquina robo-nilma:\n');
    console.log(JSON.stringify(tokens));
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
