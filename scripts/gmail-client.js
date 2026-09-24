// Cliente Gmail autenticado via OAuth (gmail.readonly + gmail.send), usando o
// token salvo por gmail-auth.js. Renova sozinho quando o access_token expira
// (o google-auth-library já cuida disso usando o refresh_token).
//
// De onde vêm as credenciais depende de onde o robô está rodando:
//
// - No PC do escritório, dos dois arquivos ao lado deste (que estão no
//   .gitignore e nunca entram no repositório).
// - Na nuvem não há disco pra guardar segredo, e arquivo de segredo dentro da
//   imagem é justamente o que não se deve fazer. Lá eles chegam por variável
//   de ambiente, alimentada pelo Secret Manager do Google — o mesmo conteúdo,
//   só que num cofre com controle de acesso e registro de quem leu.
//
// O ambiente vem primeiro; o arquivo é o caminho de casa.
const fs = require('fs');
const { google } = require('googleapis');

const CLIENT_PATH = __dirname + '/gmail_oauth_client.json';
const TOKEN_PATH = __dirname + '/gmail_token.json';

// Lê um segredo em JSON: da variável de ambiente, se houver; senão, do arquivo.
// A mensagem de erro diz os dois caminhos possíveis, porque quem for mexer
// nisso na nuvem não vai estar olhando pra esta pasta.
function segredo(variavel, caminho, oQueE) {
  const doAmbiente = process.env[variavel];
  if (doAmbiente) {
    try {
      return JSON.parse(doAmbiente);
    } catch (e) {
      throw new Error(`A variável ${variavel} (${oQueE}) não é um JSON válido.`);
    }
  }
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch (e) {
    throw new Error(
      `Não achei ${oQueE}: nem na variável ${variavel}, nem no arquivo ${caminho}.`
    );
  }
}

// A mesma conta autoriza o Gmail e o Drive, num token só. Quem precisa de
// outro servico do Google pede o cliente aqui em vez de remontar a autenticacao.
function getAuth() {
  const creds = segredo('GMAIL_OAUTH_CLIENT', CLIENT_PATH, 'o cliente OAuth do Gmail').installed;
  const oAuth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  const token = segredo('GMAIL_TOKEN', TOKEN_PATH, 'o token do Gmail');
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

function getGmail() {
  return google.gmail({ version: 'v1', auth: getAuth() });
}

// Só pra log e diagnóstico: diz de onde vieram, nunca o que são.
function origemDasCredenciais() {
  return {
    cliente: process.env.GMAIL_OAUTH_CLIENT ? 'variável de ambiente' : 'arquivo local',
    token: process.env.GMAIL_TOKEN ? 'variável de ambiente' : 'arquivo local'
  };
}

module.exports = { getAuth, getGmail, origemDasCredenciais };
