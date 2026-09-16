// Cliente Firestore usando a credencial já salva do `firebase login` local
// (não usa service account key nem senha — reaproveita o refresh_token do
// próprio CLI, no formato "authorized_user" que o Application Default
// Credentials do Google entende nativamente).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const FIREBASE_CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

function ensureAdcFile() {
  const credsPath = process.env.USERPROFILE + '/.config/configstore/firebase-tools.json';
  const stored = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
  const adc = {
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: stored.tokens.refresh_token,
    type: 'authorized_user',
  };
  const adcPath = path.join(__dirname, '.firebase-token');
  fs.writeFileSync(adcPath, JSON.stringify(adc), { mode: 0o600 });
  return adcPath;
}

function getDb(projectId) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = ensureAdcFile();
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: projectId,
    });
  }
  return getFirestore();
}

module.exports = { getDb };
