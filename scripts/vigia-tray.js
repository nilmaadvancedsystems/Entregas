// Ícone na bandeja do sistema pro vigia do robô do Gmail, pra não precisar
// mais deixar uma janela preta aberta no PC do escritório.
//
// Este arquivo NÃO é o robô: ele só liga o vigia-robo.js por baixo (janela
// escondida) e mostra o estado com um ícone — verde ligado, cinza sem
// contato há um tempo, vermelho parado por erro. O robô em si continua
// exatamente igual, com a mesma trava e o mesmo freio de reinício.
//
// O ícone é feito de um programinha à parte (tray_windows_release.exe, que
// vem dentro do pacote systray2) que às vezes cai sozinho, sem culpa do
// robô. Por isso o ícone e o robô são tratados como duas coisas separadas
// aqui: se o ícone cair, ele religa sozinho (como o robô já fazia); se não
// conseguir religar de jeito nenhum, o robô continua rodando do mesmo jeito,
// só sem o ícone.
//
// Uso: node vigia-tray.js
// (quem liga isso é o iniciar-vigia.cmd, escondido, pela pasta Inicializar)
const path = require('path');
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
  const linha = agora() + ' [tray] ' + m.join(' ');
  console.log(linha);
  try { fs.appendFileSync(LOG, linha + '\n'); } catch (e) {}
}

// Nada aqui pode derrubar o processo calado: se cair sem log, ninguém sabe
// por quê. Registra e segue — o robô (processo filho) não depende disto.
process.on('uncaughtException', err => log('erro não tratado (segui rodando):', err && err.stack || err));
process.on('unhandledRejection', err => log('promessa rejeitada sem tratar (segui rodando):', err && err.stack || err));

// ---------- liga e religa o robô ----------
let filho = null;
let saindo = false;
// true só entre o kill() do reiniciarAgora() e a saída do processo: faz o
// ÚNICO listener de 'exit' religar na hora em vez de esperar 30s. Antes
// disso ter dois listeners de 'exit' (um daqui, um do religar automático)
// religava duas vezes, e a segunda batia na trava da primeira pra sempre,
// preso pedindo de novo a cada minuto mesmo com o robô já de pé.
let reinicioPedido = false;

function ligarRobo() {
  if (saindo) return;
  const saida = fs.openSync(LOG, 'a');
  filho = spawn(process.execPath, [ROBO, '--a-cada', '120'], {
    cwd: AQUI,
    windowsHide: true,          // aqui é o pulo do gato: sem janela nenhuma
    detached: true,             // o robô não pode morrer se o ícone da bandeja cair
    stdio: ['ignore', saida, saida],
  });
  filho.unref();
  filho.on('exit', code => {
    fs.closeSync(saida);
    if (saindo) return;
    const foiPedido = reinicioPedido;
    reinicioPedido = false;
    if (code === 3) {
      // já tinha outro vigia rodando (não devia acontecer com o tray, mas
      // se acontecer, espera um pouco e tenta nascer de novo).
      log('já existe outro vigia; tento de novo em 1 min');
      setTimeout(ligarRobo, 60000);
      return;
    }
    const espera = foiPedido ? 500 : 30000;
    log('robô parou (código ' + code + ')' + (foiPedido ? ' — reinício pedido' : '') + '; religando em ' + Math.round(espera / 1000) + 's');
    setTimeout(ligarRobo, espera);
  });
}

function reiniciarAgora() {
  log('reinício pedido pelo ícone da bandeja');
  try { fs.unlinkSync(path.join(AQUI, 'vigia-partidas.json')); } catch (e) {}
  if (filho) {
    reinicioPedido = true;
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
// Itens são recriados a cada tentativa (não dá pra reaproveitar objeto de
// uma instância de SysTray morta), mas o texto/cor atual é preservado.
let corAtual = 'cinza';
let textoAtual = 'Robô do Gmail — verificando…';
let systray = null;
let menuAtual = null;    // guarda o menu inteiro (com os itens de verdade), pra
                          // 'update-menu' nunca mandar uma lista vazia por engano
let tentativasSeguidas = 0;
let atualizando = null; // setInterval em uso, pra não duplicar entre tentativas

function montarMenu() {
  const itemStatus = { title: textoAtual, tooltip: '', enabled: false };
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
  return { itemStatus, itemAbrir, itemLog, itemReiniciar, itemSair };
}

function iniciarBandeja() {
  if (saindo) return;
  const itens = montarMenu();
  menuAtual = {
    icon: ICONES[corAtual],
    title: '',
    tooltip: textoAtual,
    items: [itens.itemStatus, SysTray.separator, itens.itemAbrir, itens.itemLog, itens.itemReiniciar, SysTray.separator, itens.itemSair],
  };
  systray = new SysTray({ menu: menuAtual, debug: false, copyDir: false });
  systray._nilmaItemStatus = itens.itemStatus; // referência própria, sem mexer no menu interno do systray2

  systray.onClick(action => { if (action.item.click) action.item.click(); });
  // onError/onExit mexem em systray._process, que só existe depois que o
  // .ready() resolve (o construtor dispara isso de forma assíncrona) — por
  // isso ficam aqui dentro, e não logo depois do "new SysTray(...)".

  systray.ready()
    .then(() => {
      tentativasSeguidas = 0;
      log('ícone da bandeja pronto');
      systray.onError(err => log('ícone da bandeja: erro (' + (err && err.message) + ')'));
      systray.onExit(code => {
        if (saindo) return;
        if (atualizando) { clearInterval(atualizando); atualizando = null; }
        tentativasSeguidas++;
        const espera = Math.min(5 * 60000, 5000 * Math.pow(2, tentativasSeguidas - 1)); // 5s, 10s, 20s... até 5min
        log('ícone da bandeja caiu (código ' + code + '); tento de novo em ' + Math.round(espera / 1000) + 's. O robô continua rodando normalmente.');
        setTimeout(iniciarBandeja, espera);
      });
      atualizarIcone();
      atualizando = setInterval(atualizarIcone, 30000);
    })
    .catch(err => {
      if (saindo) return;
      tentativasSeguidas++;
      const espera = Math.min(5 * 60000, 5000 * Math.pow(2, tentativasSeguidas - 1));
      log('ícone da bandeja não abriu (' + err.message + '); tento de novo em ' + Math.round(espera / 1000) + 's. O robô segue rodando sem ele.');
      setTimeout(iniciarBandeja, espera);
    });
}

async function atualizarIcone() {
  if (!systray) return;
  const s = await statusAtual();
  if (s.texto !== textoAtual) {
    textoAtual = s.texto;
    if (systray._nilmaItemStatus) {
      systray._nilmaItemStatus.title = textoAtual;
      try { systray.sendAction({ type: 'update-item', item: systray._nilmaItemStatus }); } catch (e) {}
    }
  }
  if (s.cor !== corAtual) {
    corAtual = s.cor;
    menuAtual.icon = ICONES[corAtual];
    menuAtual.tooltip = textoAtual;
    try { systray.sendAction({ type: 'update-menu', menu: menuAtual }); } catch (e) { log('não consegui trocar o ícone:', e.message); }
  }
}

function desligarTudo() {
  log('saindo pelo ícone da bandeja');
  saindo = true;
  if (filho) filho.kill('SIGINT');
  setTimeout(() => { try { systray && systray.kill(false); } catch (e) {} process.exit(0); }, 1500);
}
process.on('SIGINT', desligarTudo);
process.on('SIGTERM', desligarTudo);

// ---------- início ----------
ligarRobo();
iniciarBandeja();
