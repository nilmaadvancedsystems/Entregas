// Conexão com o Firestore, que funciona nos dois lugares onde o robô roda.
//
// Na NUVEM não existe "firebase login": o próprio ambiente entrega a
// credencial da conta de serviço (o que o Google chama de Application Default
// Credentials). É só pedir applicationDefault() e pronto — nenhum arquivo,
// nenhum segredo no código.
//
// No PC do escritório não existe conta de serviço. Ali a credencial vem do
// `firebase login` que alguém fez uma vez: o CLI guarda um refresh_token no
// perfil do Windows, e este arquivo o converte para o formato "authorized_user"
// que o ADC entende nativamente. Não usa service account key nem senha.
//
// A ordem importa: se o ambiente já tem credencial, ela manda. Assim o mesmo
// código sobe pra nuvem sem ninguém lembrar de mudar nada aqui.
const fs = require('fs');
const path = require('path');
const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const FIREBASE_CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

// Cloud Run e Cloud Functions marcam o ambiente com estas variáveis; havendo
// GOOGLE_APPLICATION_CREDENTIALS, alguém já apontou uma credencial de propósito
// e não cabe a este arquivo passar por cima.
function ambienteJaTemCredencial() {
  return !!(process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.K_SERVICE ||          // Cloud Run / Functions 2ª geração
    process.env.FUNCTION_TARGET ||    // Cloud Functions
    process.env.GAE_ENV ||            // App Engine
    process.env.ROBO_NA_NUVEM);       // máquina virtual do Google: o serviço do robô liga isto
}

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

// Só pra log: saber qual dos dois caminhos foi usado poupa meia hora de
// adivinhação quando o robô não conecta.
let origemDaCredencial = 'desconhecida';
function credencialUsada() { return origemDaCredencial; }

function getDb(projectId) {
  if (ambienteJaTemCredencial()) {
    origemDaCredencial = 'do ambiente (conta de serviço)';
  } else {
    // No PC. Se o firebase login nunca foi feito (ou o perfil mudou), não
    // adianta estourar aqui com "arquivo não encontrado": o erro que importa
    // é o da conexão, e ele vem logo abaixo com nome e sobrenome.
    try {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = ensureAdcFile();
      origemDaCredencial = 'do firebase login deste computador';
    } catch (e) {
      origemDaCredencial = 'nenhuma (o `firebase login` deste computador não foi encontrado)';
    }
  }

  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: projectId,
    });
  }
  return getFirestore();
}

module.exports = { getDb, credencialUsada };
