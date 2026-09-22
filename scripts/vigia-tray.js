// Ícone na bandeja do sistema pro vigia do robô do Gmail, pra não precisar
// mais deixar uma janela preta aberta no PC do escritório.
//
// Este arquivo NÃO é o robô: ele só liga o vigia-robo.js por baixo (janela
// escondida) e mostra o estado com um ícone — verde ligado, cinza sem
// contato há um tempo, vermelho parado por erro. O robô em si continua
// exatamente igual, com a mesma trava e o mesmo freio de reinício.
//
// Uso: node vigia-tray.js
// (quem liga isso é o iniciar-vigia.cmd, escondido, pela pasta Inicializar)
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const SysTray = require('systray2').default || require('systray2');

const AQUI = __dirname;
const ROBO = path.join(AQUI, 'vigia-robo.js');
const LOG = path.join(AQUI, 'vigia-robo.log');
const ICONES = {
  verde: path.join(AQUI, 'tray-icons', 'robo-verde.ico'),
  cinza: path.join(AQUI, 'tray-icons', 'robo-cinza.ico'),
  vermelho: path.join(AQUI, 'tray-icons', 'robo-vermelho.ico'),
};
const PAGINA_ROBO = 'https://nilmaadvancedsystems.github.io/Entregas/Pendencias-e-envio-automatico-via-Gmail.html';

function agora() { return new Date().toLocaleString('pt-BR'); }
function log(...m) {
  const linha = agora() + ' [tray] ' + m.join(' ') + '\n';
  try { fs.appendFileSync(LOG, linha); } catch (e) {}
}

// ---------- liga e religa o robô (mesma regra do vigia-laco.cmd de antes) ----------
let filho = null;
let ultimoCodigo = null;
let saindo = false;

function ligarRobo() {
  if (saindo) return;
  const saida = fs.openSync(LOG, 'a');
  filho = spawn(process.execPath, [ROBO, '--a-cada', '120'], {
    cwd: AQUI,
    windowsHide: true,          // aqui é o pulo do gato: sem janela nenhuma
    stdio: ['ignore', saida, saida],
  });
  filho.on('exit', code => {
    fs.closeSync(saida);
    ultimoCodigo = code;
    if (saindo) return;
    if (code === 3) {
      // já tinha outro vigia rodando (não devia acontecer com o tray, mas
      // se acontecer, espera um pouco e tenta nascer de novo).
      log('já existe outro vigia; tento de novo em 1 min');
      setTimeout(ligarRobo, 60000);
      return;
    }
    log('robô parou (código ' + code + '); religando em 30s');
    setTimeout(ligarRobo, 30000);
  });
}

function reiniciarAgora() {
  log('reinício pedido pelo ícone da bandeja');
  try { fs.unlinkSync(path.join(AQUI, 'vigia-partidas.json')); } catch (e) {}
  if (filho) {
    filho.once('exit', () => setTimeout(ligarRobo, 500));
    filho.kill();
  } else {
    ligarRobo();
  }
}

// ---------- estado mostrado no ícone ----------
// Lê o mesmo sinal de vida que a tela "Robô do Gmail" usa (robo/estado.vigia),
// pra o ícone bater exatamente com o que a Nilma vê no navegador.
let getDb = null;
try { ({ getDb } = require('./firestore-client')); } catch (e) {}
let db = null;
try { db = getDb && getDb('entregas-2e5e2'); } catch (e) { log('não consegui ligar ao Firestore pro status:', e.message); }

async function statusAtual() {
  if (!db) return { cor: 'cinza', texto: 'Robô do Gmail — sem conexão com o banco' };
  try {
    const doc = await db.collection('robo').doc('estado').get();
    const v = (doc.exists ? doc.data() : {}).vigia || {};
    if (v.desligadoEm) return { cor: 'vermelho', texto: 'Robô do Gmail — desligado' };
    const minutos = v.em ? Math.round((Date.now() - new Date(v.em).getTime()) / 60000) : null;
    if (minutos === null) return { cor: 'cinza', texto: 'Robô do Gmail — nunca ligou' };
    if (minutos < 3) return { cor: 'verde', texto: 'Robô do Gmail — online' };
    if (minutos < 15) return { cor: 'cinza', texto: 'Robô do Gmail — sem contato há ' + minutos + ' min' };
    return { cor: 'vermelho', texto: 'Robô do Gmail — parado há ' + minutos + ' min' };
  } catch (e) {
    return { cor: 'vermelho', texto: 'Robô do Gmail — erro: ' + e.message };
  }
}

// ---------- bandeja ----------
const itemStatus = { title: 'Robô do Gmail — verificando…', tooltip: '', enabled: false };
const itemAbrir = {
  title: 'Abrir Cobrança de Documentos',
  tooltip: 'Abre a tela do robô no navegador',
  enabled: true,
  click: () => exec('start "" "' + PAGINA_ROBO + '"'),
};
const itemLog = {
  title: 'Ver registro (log)',
  tooltip: 'Abre o arquivo de registro do robô',
  enabled: true,
  click: () => exec('notepad "' + LOG + '"'),
};
const itemReiniciar = {
  title: 'Reiniciar o robô agora',
  tooltip: '',
  enabled: true,
  click: () => reiniciarAgora(),
};
const itemSair = {
  title: 'Sair',
  tooltip: 'Desliga o robô e o ícone da bandeja',
  enabled: true,
  click: () => desligarTudo(),
};

const systray = new SysTray({
  menu: {
    icon: ICONES.cinza,
    title: '',
    tooltip: 'Robô do Gmail',
    items: [itemStatus, SysTray.separator, itemAbrir, itemLog, itemReiniciar, SysTray.separator, itemSair],
  },
  debug: false,
  copyDir: false,
});

systray.onClick(action => {
  if (action.item.click) action.item.click();
});

let corAtual = null;
async function atualizarIcone() {
  const s = await statusAtual();
  itemStatus.title = s.texto;
  systray.sendAction({ type: 'update-item', item: itemStatus });
  if (s.cor !== corAtual) {
    corAtual = s.cor;
    systray.sendAction({ type: 'update-menu', menu: Object.assign({}, systray._conf.menu, { icon: ICONES[s.cor], tooltip: s.texto }) });
  }
}

function desligarTudo() {
  log('saindo pelo ícone da bandeja');
  saindo = true;
  if (filho) filho.kill('SIGINT');
  setTimeout(() => { try { systray.kill(false); } catch (e) {} process.exit(0); }, 1500);
}
process.on('SIGINT', desligarTudo);
process.on('SIGTERM', desligarTudo);

// ---------- início ----------
systray.ready()
  .then(() => { log('ícone da bandeja pronto'); })
  .catch(err => { log('ícone da bandeja não abriu (' + err.message + '); o robô segue rodando sem ele'); });

ligarRobo();
atualizarIcone();
setInterval(atualizarIcone, 30000);
