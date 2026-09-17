// Cliente Gmail autenticado via OAuth (escopo gmail.readonly), usando o
// token salvo por gmail-auth.js. Renova sozinho quando o access_token
// expira (o google-auth-library já cuida disso usando o refresh_token).
const fs = require('fs');
const { google } = require('googleapis');

const CLIENT_PATH = __dirname + '/gmail_oauth_client.json';
const TOKEN_PATH = __dirname + '/gmail_token.json';

function getGmail() {
  const creds = JSON.parse(fs.readFileSync(CLIENT_PATH, 'utf8')).installed;
  const oAuth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oAuth2Client.setCredentials(token);
  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

module.exports = { getGmail };
