// Arquivador: o pedaço do robô que fica NESTE PC.
//
// O robô do Gmail foi pra nuvem, mas o arquivamento não pode ir junto: ele é a
// rotina "Claudio Secretario" (/organizar), que roda pelo Claude instalado
// aqui e move arquivos no G:. Este programa faz duas coisas, e só elas:
//
// 1. Atende o botão "Arquivar agora" do Pendências. O app grava o pedido em
//    solicitacoesArquivo; aqui ele vira a mesma execução que a tarefa
//    agendada das 9h faz (/organizar PRODUCAO na pasta da rotina), sem
//    ninguém aprovar passo a passo — decisão do escritório em 24/09/2026.
//
// 2. Publica no banco o que foi arquivado, lendo o manifesto e os relatórios
//    da rotina (arquivo-manifesto.js). Isso vale pra toda execução, inclusive
//    a das 9h: a aba Arquivo mostra tudo, venha de onde vier.
//
// O que ele NÃO faz: não altera nada no repositório da rotina (GUSTAVO\claudio)
// nem nas regras dela. Só lê _CONTROLE\ e chama o comando que já existe.
//
// Duas execuções ao mesmo tempo moveriam os mesmos arquivos e bagunçariam as
// pastas dos clientes. Por isso, antes de começar, o pedido espera se:
//   - a rotina deu sinal de vida nos últimos minutos (arquivo novo em
//     _CONTROLE), o que quer dizer que outra execução está rodando; ou
//   - é o horário da execução das 9h e ela ainda não terminou hoje.
//
// Uso: node arquivador.js     (fica rodando; o iniciar-arquivador.cmd liga no boot)
require('./fuso.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { getDb } = require('./firestore-client');
const { ouvir } = require('./ouvinte');
const man = require('./arquivo-manifesto');

const RAIZ = process.env.ARQUIVO_RAIZ || 'C:\\Users\\DPTO FISCAL 004\\GUSTAVO\\claudio';
const CONTROLE = path.join(RAIZ, '_CONTROLE');
const CLAUDE = process.env.CLAUDE_EXE || path.join(os.homedir(), '.local', 'bin', 'claude.exe');
const DRIVE = process.env.ARQUIVO_DRIVE || 'G:\Meu Drive';
const MODOS = ['PRODUCAO', 'SIMULACAO'];

const LIMITE_EXECUCAO_MS = 3 * 36e5;     // rotina travada não segura o PC o dia inteiro
const SINAL_DE_OUTRA_EXECUCAO_MS = 10 * 60000;
const PUBLICAR_A_CADA_MS = 10 * 60000;
const JANELA_DAS_9H = { de: [8, 30], ate: [11, 0] };  // a tarefa agendada roda às 9h (+ até 10 min de sorteio)

const log = (...m) => console.log(new Date().toLocaleString('pt-BR'), '[arquivo]', ...m);
const agora = () => new Date().toISOString();

// ---------- um arquivador só ----------
const TRAVA = path.join(__dirname, 'arquivador.lock');
try {
  const pid = parseInt(fs.readFileSync(TRAVA, 'utf8'), 10);
  if (pid && pid !== process.pid) { try { process.kill(pid, 0); log('já existe um arquivador rodando (processo ' + pid + ')'); process.exit(3); } catch (e) {} }
} catch (e) {}
fs.writeFileSync(TRAVA, String(process.pid));
process.on('exit', () => { try { if (parseInt(fs.readFileSync(TRAVA, 'utf8'), 10) === process.pid) fs.unlinkSync(TRAVA); } catch (e) {} });

const db = getDb('entregas-2e5e2');
const fila = db.collection('solicitacoesArquivo');
const estadoRef = db.collection('robo').doc('arquivador');

let estado = { situacao: 'livre', pedidoId: null, desde: agora(), mensagem: null };
function baterPonto() {
  estadoRef.set(Object.assign({ em: agora(), pc: os.hostname() }, estado), { merge: true })
    .catch(err => log('não consegui bater o ponto:', err.message));
}
function mudarEstado(novo) { estado = Object.assign({ desde: agora(), pedidoId: null, mensagem: null }, novo); baterPonto(); }

// ---------- a rotina está rodando por fora? ----------
function maisRecenteEm(pasta, profundidade) {
  let maior = 0;
  let itens = [];
  try { itens = fs.readdirSync(pasta, { withFileTypes: true }); } catch (e) { return 0; }
  for (const it of itens) {
    const c = path.join(pasta, it.name);
    try {
      if (it.isDirectory()) { if (profundidade > 0) maior = Math.max(maior, maisRecenteEm(c, profundidade - 1)); }
      else maior = Math.max(maior, fs.statSync(c).mtimeMs);
    } catch (e) { /* arquivo sumiu no meio: segue */ }
  }
  return maior;
}

function hojeIso() { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
function minutosDoDia(h, m) { return h * 60 + m; }

// Motivo pra esperar, ou null se pode começar.
function motivoPraEsperar() {
  const mes = new Date().toISOString().slice(0, 7);
  const ultimoSinal = Math.max(
    maisRecenteEm(path.join(CONTROLE, 'LOGS', mes), 2),
    maisRecenteEm(path.join(CONTROLE, 'MANIFESTO'), 0),
    maisRecenteEm(path.join(CONTROLE, 'STAGING'), 2)
  );
  if (Date.now() - ultimoSinal < SINAL_DE_OUTRA_EXECUCAO_MS) {
    return 'a rotina está rodando agora (provavelmente a das 9h); começo quando ela terminar';
  }
  const d = new Date();
  const m = minutosDoDia(d.getHours(), d.getMinutes());
  if (m >= minutosDoDia(...JANELA_DAS_9H.de) && m < minutosDoDia(...JANELA_DAS_9H.ate)) {
    const feitaHoje = man.listarExecucoes(CONTROLE).some(e => e.id.startsWith('EXEC-' + hojeIso() + '-') &&
      new Date(man.dataDoId(e.id)).getHours() >= 9);
    if (!feitaHoje) return 'é o horário da organização das 9h; começo depois que ela terminar';
  }
  return null;
}

// ---------- publicar o que foi arquivado ----------
// Lembra, neste PC, o que já subiu pro banco (id -> assinatura). Assim cada
// passada só grava execução nova ou que mudou, e não gasta gravação à toa.
const ARQ_PUBLICADOS = path.join(__dirname, 'arquivador-publicados.json');
function lerPublicados() { try { return JSON.parse(fs.readFileSync(ARQ_PUBLICADOS, 'utf8')); } catch (e) { return {}; } }
function gravarPublicados(p) { try { fs.writeFileSync(ARQ_PUBLICADOS, JSON.stringify(p)); } catch (e) {} }

let publicando = false;
async function publicar(ligarPedido) {
  if (publicando) return [];
  publicando = true;
  const novos = [];
  try {
    let manifesto = '', qualidade = '';
    try { manifesto = fs.readFileSync(path.join(CONTROLE, 'MANIFESTO', 'manifesto.jsonl'), 'utf8'); } catch (e) {}
    try { qualidade = fs.readFileSync(path.join(CONTROLE, 'MANIFESTO', 'qualidade.jsonl'), 'utf8'); } catch (e) {}
    const porExec = man.agruparManifesto(manifesto);
    const qual = man.lerQualidade(qualidade);
    const relatorios = new Map(man.listarExecucoes(CONTROLE).map(e => [e.id, e]));
    const ids = new Set([...porExec.keys(), ...relatorios.keys()]);
    const publicados = lerPublicados();
    for (const id of ids) {
      const rel = relatorios.get(id);
      const assinatura = (porExec.get(id) || []).length + ':' + (rel ? Math.round(rel.mtime) : 0) + ':' + JSON.stringify(qual.get(id) || null);
      if (publicados[id] === assinatura) continue;
      let texto = '';
      if (rel) { try { texto = fs.readFileSync(rel.txt, 'utf8'); } catch (e) {} }
      const { resumo, detalhe } = man.montarExecucao(id, porExec.get(id), qual.get(id), texto);
      resumo.publicadoEm = agora();
      if (ligarPedido && ligarPedido.id === id) resumo.pedidoId = ligarPedido.pedidoId;
      const ref = db.collection('arquivamentos').doc(id);
      await ref.set(resumo, { merge: true });
      // merge: a mensagem final do Claude (respostaClaude) é gravada depois,
      // pelo pedido, e uma republicação não pode apagá-la.
      await ref.collection('detalhe').doc('tudo').set(detalhe, { merge: true });
      publicados[id] = assinatura;
      gravarPublicados(publicados);
      novos.push(id);
    }
    if (novos.length) log('publicado no banco:', novos.length, 'execução(ões):', novos.slice(-5).join(', ') + (novos.length > 5 ? '…' : ''));
  } catch (err) {
    log('não consegui publicar o arquivamento:', err.message);
  } finally { publicando = false; }
  return novos;
}

// ---------- rodar a rotina ----------
function branchDaRotina() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: RAIZ, encoding: 'utf8' }).trim();
}

// Sem as variáveis de uma sessão do Claude que por acaso tenha ligado este
// programa: a rotina tem que nascer como uma sessão nova, igual à das 9h.
function ambienteLimpo() {
  const env = Object.assign({}, process.env);
  Object.keys(env).forEach(k => { if (/^CLAUDE_?CODE|^CLAUDECODE$|^ANTHROPIC_/.test(k)) delete env[k]; });
  return env;
}

function rodarRotina(modo) {
  return new Promise(resolve => {
    const saida = [];
    // --add-dir: a rotina move arquivos em G:\Meu Drive, fora da pasta dela. Na
    // tarefa das 9h isso vem de .claude/settings.local.json da rotina, que o
    // Claude só aplica em pasta "confiada" pela janela interativa; aqui a
    // pasta vai dita no comando, sem mexer na configuração de ninguém.
    const filho = spawn(CLAUDE, ['-p', '/organizar ' + modo, '--permission-mode', 'bypassPermissions',
      '--add-dir', DRIVE, '--output-format', 'text'],
      { cwd: RAIZ, windowsHide: true, env: ambienteLimpo(), stdio: ['ignore', 'pipe', 'pipe'] });
    const guardar = b => { saida.push(String(b)); };
    filho.stdout.on('data', guardar);
    filho.stderr.on('data', guardar);
    const relogio = setTimeout(() => { log('a rotina passou de 3 horas; encerrando'); try { filho.kill(); } catch (e) {} }, LIMITE_EXECUCAO_MS);
    filho.on('error', err => { clearTimeout(relogio); resolve({ ok: false, texto: err.message }); });
    filho.on('close', code => { clearTimeout(relogio); resolve({ ok: code === 0, texto: saida.join('').trim(), code }); });
  });
}

let ocupado = false;
async function atenderFila() {
  if (ocupado) return;
  ocupado = true;
  try {
    for (;;) {
      const snap = await fila.where('status', 'in', ['pendente', 'aguardando']).get();
      const pedidos = snap.docs.sort((a, b) => String(a.data().criadoEm).localeCompare(String(b.data().criadoEm)));
      if (!pedidos.length) break;
      const doc = pedidos[0];
      const p = doc.data();
      const modo = MODOS.includes(p.modo) ? p.modo : null;
      if (!modo) { await doc.ref.update({ status: 'erro', erro: 'modo desconhecido: ' + p.modo, erroEm: agora() }); continue; }

      const espera = motivoPraEsperar();
      if (espera) {
        if (p.status !== 'aguardando' || p.aguardandoMotivo !== espera) {
          await doc.ref.update({ status: 'aguardando', aguardandoMotivo: espera, aguardandoEm: agora() });
          log('pedido', doc.id, 'esperando:', espera);
        }
        mudarEstado({ situacao: 'aguardando', pedidoId: doc.id, mensagem: espera });
        break;   // tenta de novo na próxima volta do relógio
      }

      try {
        const branch = branchDaRotina();
        if (modo === 'PRODUCAO' && branch !== 'main') throw new Error('a pasta da rotina está na branch "' + branch + '", não na main; produção só roda na main');
      } catch (err) {
        await doc.ref.update({ status: 'erro', erro: err.message, erroEm: agora() });
        log('pedido', doc.id, 'recusado:', err.message);
        continue;
      }

      const inicio = Date.now();
      await doc.ref.update({ status: 'processando', processandoEm: agora(), pc: os.hostname(), aguardandoMotivo: null });
      mudarEstado({ situacao: 'rodando', pedidoId: doc.id, mensagem: 'organizando (' + modo + ')' });
      log('pedido', doc.id, 'de', p.criadoPor || 'alguém', '- rodando /organizar', modo);

      const r = await rodarRotina(modo);

      // Qual execução saiu desta rodada: o relatório mais novo, do mesmo tipo,
      // criado depois que começamos.
      const prefixo = modo === 'PRODUCAO' ? 'EXEC-' : 'SIM-';
      const execucao = man.listarExecucoes(CONTROLE)
        .filter(e => e.id.startsWith(prefixo) && new Date(man.dataDoId(e.id)).getTime() >= inicio - 60000)
        .map(e => e.id).pop() || null;
      await publicar(execucao ? { id: execucao, pedidoId: doc.id } : null);

      const resposta = r.texto.length > 30000 ? r.texto.slice(-30000) : r.texto;
      // A mensagem final também fica junto da execução: a lista de pedidos da
      // tela só mostra os últimos, e a execução fica pra sempre.
      if (execucao && resposta) {
        await db.collection('arquivamentos').doc(execucao).collection('detalhe').doc('tudo')
          .set({ respostaClaude: resposta, pedidoId: doc.id }, { merge: true })
          .catch(err => log('não consegui guardar a mensagem do Claude na execução:', err.message));
      }
      if (r.ok) {
        await doc.ref.update({ status: 'concluido', concluidoEm: agora(), execucao, resposta });
        log('pedido', doc.id, 'concluído', execucao ? '(' + execucao + ')' : '(sem relatório novo)');
      } else {
        await doc.ref.update({ status: 'erro', erro: 'a rotina terminou com erro' + (r.code != null ? ' (código ' + r.code + ')' : ''), erroEm: agora(), execucao, resposta });
        log('pedido', doc.id, 'falhou, código', r.code);
      }
      mudarEstado({ situacao: 'livre' });
    }
  } catch (err) {
    log('erro atendendo a fila:', err.message);
  } finally { ocupado = false; }
}

// ---------- início ----------
async function iniciar() {
  // Pedido que ficou "processando" quando o PC desligou: não roda de novo às
  // cegas — metade dos arquivos pode já ter sido movida.
  const presos = await fila.where('status', '==', 'processando').get();
  for (const d of presos.docs) {
    await d.ref.update({ status: 'erro', erro: 'o PC desligou no meio da organização; confira a pasta Claudio Secretario antes de pedir de novo', erroEm: agora() });
  }
  mudarEstado({ situacao: 'livre' });
  setInterval(baterPonto, 60 * 1000);

  await publicar(null);
  setInterval(() => publicar(null), PUBLICAR_A_CADA_MS);

  ouvir('pedidos de arquivamento', () => fila.where('status', '==', 'pendente'), snap => { if (!snap.empty) atenderFila(); }, log);
  // Pedido que está esperando a das 9h terminar: confere de 2 em 2 minutos.
  setInterval(() => { if (!ocupado) atenderFila(); }, 2 * 60000);
  log('arquivador ligado em', os.hostname(), '— rotina em', RAIZ);
}

function desligar() {
  estadoRef.set({ em: new Date(0).toISOString(), situacao: 'desligado', desligadoEm: agora() }, { merge: true })
    .finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', desligar);
process.on('SIGTERM', desligar);
process.on('unhandledRejection', err => log('erro não tratado (segui rodando):', err && err.message ? err.message : String(err)));

iniciar().catch(err => { log('ERRO ao iniciar:', err.message); process.exit(1); });
