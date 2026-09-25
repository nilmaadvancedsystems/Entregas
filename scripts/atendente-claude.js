// O atendente da Consulta rápida rodando NESTE PC, com o Claude instalado aqui.
//
// Faz o mesmo trabalho do ia-atendente.js (que usa o Gemini, na nuvem), do
// mesmo jeito que o arquivador roda o /organizar: pra cada pergunta, liga uma
// conversa oculta do Claude (`claude -p`, sem janela e sem guardar sessão),
// entrega a conversa, e grava a resposta no Firestore aos pedaços.
//
// Quem responde é escolhido em Ajustes › Integrações (config/integracoes.iaMotor):
//   'claude' (padrão) — este arquivo atende; o Gemini da nuvem fica parado.
//   'gemini'          — este arquivo fica parado; o robô da nuvem atende.
// Os dois nunca atendem juntos, e mesmo se atendessem a transação em
// conversasIA/{id} impede que peguem a mesma pergunta.
//
// O QUE O CLAUDE PODE FAZER AQUI: só LER o banco — as 4 consultas prontas do
// ia-consultas.js e a leitura livre do ia-banco.js, servidas pelo ia-mcp.js.
// Nenhuma ferramenta do Claude Code (arquivo, comando, internet) fica ligada:
// `--tools ""` desliga todas, e `--setting-sources project` numa pasta vazia
// deixa de fora os plugins, ganchos e memórias do Claude deste PC.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { instrucoes, MAX_MENSAGENS_HISTORICO } = require('./ia-atendente');

const CLAUDE = process.env.CLAUDE_EXE || path.join(os.homedir(), '.local', 'bin', 'claude.exe');
const MODELO_PADRAO = 'sonnet';
const MOTOR_PADRAO = 'claude';
const LIMITE_POR_PERGUNTA_MS = 2 * 60000;
const INTERVALO_GRAVACAO_MS = 900;       // freio das gravações de texto parcial (igual ao Gemini)
const PONTO_A_CADA_MS = 2 * 60000;       // a tela considera fora do ar depois de 5 min sem ponto
const MAX_AO_MESMO_TEMPO = 3;

// Pasta vazia onde a conversa oculta nasce: sem CLAUDE.md, sem .claude/.
const PASTA_SESSAO = path.join(os.tmpdir(), 'nilma-ia');
const MCP = JSON.stringify({ mcpServers: { nilma: { command: process.execPath, args: [path.join(__dirname, 'ia-mcp.js')] } } });

// Sem as variáveis de uma sessão do Claude que por acaso tenha ligado este
// programa (mesma regra do arquivador).
function ambienteLimpo() {
  const env = Object.assign({}, process.env);
  Object.keys(env).forEach(k => { if (/^CLAUDE_?CODE|^CLAUDECODE$|^ANTHROPIC_/.test(k)) delete env[k]; });
  return env;
}

// As instruções do Gemini, trocando a linha do "sem CPF/CNPJ" pelo mapa do
// banco: aqui o Claude lê tudo (ia-banco.js), e precisa saber onde procurar.
function instrucoesClaude(agora) {
  return instrucoes(agora)
    .split('\n')
    .filter(l => !/CPF, CNPJ nem telefone/.test(l))
    .concat([
      '',
      'O BANCO (Firestore, só leitura):',
      '- Para perguntas comuns use primeiro as consultas prontas (listar_pendencias, buscar_cliente, entregas_do_cliente, resumo_do_mes).',
      '- Para o resto use listar_colecoes, ler_documento, consultar_colecao e contar. Leia um documento de exemplo antes de filtrar por um campo.',
      '- Coleções principais:',
      '  clientes (nome, nomeFantasia, documento = CPF/CNPJ, telefone, emails, endereco, zona, ativo, bancos, papeis, entrega, receita);',
      '  entregas (clienteId, clienteNome, competencia AAAA-MM, itens [{tipo, valor}], status, temAssinatura, entregadoPorNome, criadoEm);',
      '  documentosMensal (id clienteId_AAAA-MM: extrato, comprovante, aplicacao, cobrancas, semMovimento);',
      '  solicitacoes (pedidos internos: tipo, descricao, status, criadoPorNome); recados; protocolos; assinaturas;',
      '  rotaLinks (rota do dia); portais (painel do cliente); honorarioNaoAplicavel; auditoria (quem fez o quê);',
      '  arquivamentos e solicitacoesArquivo (arquivamento no Drive); driveIndice (pastas do Drive por cliente);',
      '  robo (estado do robô do Gmail e do arquivador); usuarios (equipe: nome, email, roles); config.',
      '- Os dados podem ter CPF, CNPJ e telefone: mostre só quando a pergunta pedir.',
    ])
    .join('\n');
}

// O `claude -p` recebe um texto só. As perguntas anteriores da mesma conversa
// vão como transcrição, e a última é a que ele responde.
function montarPergunta(mensagens) {
  const validas = mensagens.filter(m => m.texto && String(m.texto).trim()).slice(-MAX_MENSAGENS_HISTORICO);
  const ultima = validas.pop();
  if (!validas.length) return String(ultima.texto);
  const antes = validas.map(m => (m.papel === 'model' ? 'Atendente: ' : 'Pessoa: ') + String(m.texto).trim()).join('\n\n');
  return 'Conversa até aqui:\n\n' + antes + '\n\nPergunta nova (responda só a ela):\n' + String(ultima.texto).trim();
}

function traduzirErro(texto) {
  const m = String(texto || '');
  if (/rate.?limit|usage limit|limit reached|429/i.test(m)) return 'o limite de uso do Claude deste período acabou; a busca rápida continua funcionando';
  if (/not logged in|login|authenticat|401|403/i.test(m)) return 'o Claude do PC do escritório não está logado; abra o Claude lá e entre na conta';
  if (/overloaded|529|503/i.test(m)) return 'o Claude está sobrecarregado agora; tenta de novo em um minuto';
  if (/ENOENT/.test(m)) return 'não achei o Claude instalado no PC do escritório';
  if (/tempo|timed? ?out/i.test(m)) return 'o Claude passou de 2 minutos sem terminar; tenta perguntar de um jeito mais específico';
  return m.slice(0, 300) || 'o Claude terminou sem resposta';
}

// Uma pergunta, do começo ao fim. aoTexto recebe o texto da resposta
// crescendo; aoFerramenta, o nome de cada consulta pedida.
function perguntarAoClaude(pergunta, opcoes) {
  const aoTexto = opcoes.aoTexto || function () {};
  const aoFerramenta = opcoes.aoFerramenta || function () {};
  return new Promise(resolve => {
    fs.mkdirSync(PASTA_SESSAO, { recursive: true });
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--model', opcoes.modelo || MODELO_PADRAO, '--system-prompt', instrucoesClaude(),
      '--tools', '', '--strict-mcp-config', '--mcp-config', MCP, '--allowedTools', 'mcp__nilma',
      '--permission-mode', 'dontAsk', '--no-session-persistence',
      '--setting-sources', 'project', '--disable-slash-commands'];
    const filho = spawn(CLAUDE, args, { cwd: PASTA_SESSAO, env: ambienteLimpo(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    filho.stdin.end(pergunta);

    let resto = '', texto = '', final = null, erro = false, uso = null, modelo = null;
    const erros = [];
    const ferramentas = [];
    filho.stdout.on('data', b => {
      resto += String(b);
      const linhas = resto.split(/\r?\n/);
      resto = linhas.pop();
      for (const l of linhas) {
        if (!l.trim()) continue;
        let ev;
        try { ev = JSON.parse(l); } catch (e) { continue; }
        if (ev.type === 'system' && ev.subtype === 'init') modelo = ev.model || null;
        if (ev.type === 'stream_event' && ev.event) {
          // Cada mensagem nova do modelo (depois de uma consulta) recomeça o
          // texto: o que ele disse antes de consultar não é a resposta.
          if (ev.event.type === 'message_start') texto = '';
          const d = ev.event.delta;
          if (ev.event.type === 'content_block_delta' && d && d.type === 'text_delta' && d.text) {
            texto += d.text;
            aoTexto(texto);
          }
        }
        if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
          for (const c of ev.message.content) {
            if (c.type === 'tool_use') {
              const nome = String(c.name || '').replace(/^mcp__nilma__/, '');
              ferramentas.push({ nome, args: c.input || {} });
              aoFerramenta(nome, c.input || {});
            }
          }
        }
        if (ev.type === 'result') {
          final = String(ev.result || '');
          erro = ev.is_error === true || ev.subtype !== 'success';
          if (ev.usage) uso = { entrada: ev.usage.input_tokens || 0, saida: ev.usage.output_tokens || 0 };
        }
      }
    });
    filho.stderr.on('data', b => { erros.push(String(b)); if (erros.length > 20) erros.shift(); });
    let estourou = false;
    const relogio = setTimeout(() => { estourou = true; try { filho.kill(); } catch (e) {} }, LIMITE_POR_PERGUNTA_MS);
    filho.on('error', err => { clearTimeout(relogio); resolve({ ok: false, erro: traduzirErro(err.code || err.message) }); });
    filho.on('close', code => {
      clearTimeout(relogio);
      if (estourou) return resolve({ ok: false, erro: traduzirErro('timeout') });
      const resposta = (final != null ? final : texto).trim();
      if (code !== 0 || erro || !resposta) {
        return resolve({ ok: false, erro: traduzirErro(resposta || erros.join('') || 'código ' + code) });
      }
      resolve({ ok: true, texto: resposta, ferramentas, uso, modelo });
    });
  });
}

// ---------- ligar na fila ----------
function iniciarAtendenteClaude(opcoes) {
  const db = opcoes.db;
  const log = opcoes.log || console.log;
  const fila = db.collection('conversasIA');
  const estadoRef = db.collection('robo').doc('estado');

  let motor = null;             // só começa a atender depois de ler a escolha
  let modelo = MODELO_PADRAO;
  let pararFila = null;
  let ativos = 0;
  const emAndamento = new Set();

  function baterPonto() {
    // quem manda no selo da tela é o motor escolhido
    if (motor !== 'claude') return;
    estadoRef.set({ ia: { ligado: true, motor: 'claude', em: new Date().toISOString(), pc: os.hostname() } }, { merge: true })
      .catch(err => log('[ia] não consegui bater o ponto:', err.message));
  }

  async function atender(doc) {
    const conversaRef = doc.ref;
    const mensagensRef = conversaRef.collection('mensagens');
    const snap = await mensagensRef.orderBy('ordem', 'asc').limit(200).get();
    const mensagens = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    const ultima = mensagens[mensagens.length - 1];
    if (!ultima || ultima.papel !== 'user') {
      await conversaRef.update({ estado: 'ocioso' });
      return;
    }

    const respostaRef = mensagensRef.doc();
    await respostaRef.set({
      papel: 'model', texto: '', estado: 'gerando',
      ordem: (ultima.ordem || mensagens.length) + 1, criadoEm: new Date().toISOString(),
    });

    let ultimaGravacao = 0;
    const gravarTexto = t => {
      const agora = Date.now();
      if (agora - ultimaGravacao < INTERVALO_GRAVACAO_MS) return;
      ultimaGravacao = agora;
      respostaRef.update({ texto: t, consultando: null }).catch(() => {});
    };

    const inicio = Date.now();
    const r = await perguntarAoClaude(montarPergunta(mensagens), {
      modelo,
      aoTexto: gravarTexto,
      aoFerramenta: (nome, args) => {
        log('[ia] consulta:', nome, JSON.stringify(args));
        respostaRef.update({ consultando: nome }).catch(() => {});
      },
    });

    if (r.ok) {
      await respostaRef.update({
        texto: r.texto, estado: 'pronta', ferramentas: r.ferramentas, uso: r.uso || null,
        modelo: r.modelo || modelo, motor: 'claude', consultando: null, concluidoEm: new Date().toISOString(),
      });
      await conversaRef.update({ estado: 'ocioso', erro: null, atualizadoEm: new Date().toISOString() });
      log('[ia] respondeu', conversaRef.id, 'em', Math.round((Date.now() - inicio) / 1000) + 's');
    } else {
      log('[ia] falhou em', conversaRef.id + ':', r.erro);
      await respostaRef.update({ texto: '', estado: 'erro', erro: r.erro, consultando: null }).catch(() => {});
      await conversaRef.update({ estado: 'erro', erro: r.erro, atualizadoEm: new Date().toISOString() }).catch(() => {});
    }
  }

  function pegar(doc) {
    if (emAndamento.has(doc.id) || ativos >= MAX_AO_MESMO_TEMPO) return;
    emAndamento.add(doc.id);
    ativos++;
    db.runTransaction(async t => {
      const atual = await t.get(doc.ref);
      if (!atual.exists || atual.data().estado !== 'pendente') return false;
      t.update(doc.ref, { estado: 'gerando' });
      return true;
    })
      .then(meu => (meu ? atender(doc) : null))
      .catch(err => log('[ia] erro atendendo', doc.id + ':', err.message))
      .then(() => {
        emAndamento.delete(doc.id);
        ativos--;
        // pergunta que ficou esperando vaga
        if (pararFila) fila.where('estado', '==', 'pendente').limit(20).get()
          .then(s => s.docs.forEach(pegar)).catch(() => {});
      });
  }

  function ligarFila() {
    if (pararFila) return;
    pararFila = fila.where('estado', '==', 'pendente').limit(20).onSnapshot(
      snap => snap.docs.forEach(pegar),
      err => log('[ia] a escuta da fila caiu:', err.message));
    log('[ia] atendente ligado: Claude deste PC (modelo', modelo + ')');
  }
  function desligarFila() {
    if (!pararFila) return;
    pararFila();
    pararFila = null;
    log('[ia] atendente parado: o motor escolhido agora é', motor);
  }

  db.doc('config/integracoes').onSnapshot(snap => {
    const d = snap.exists ? snap.data() : {};
    motor = String(d.iaMotor || MOTOR_PADRAO).trim();
    modelo = String(d.iaModeloClaude || '').trim() || MODELO_PADRAO;
    if (motor === 'claude') { ligarFila(); baterPonto(); } else desligarFila();
  }, err => log('[ia] não consegui ler a escolha do motor:', err.message));

  const timer = setInterval(baterPonto, PONTO_A_CADA_MS);

  // Ao fechar: a tela deixa de oferecer a IA na hora.
  return function parar() {
    clearInterval(timer);
    if (pararFila) pararFila();
    if (motor !== 'claude') return Promise.resolve();
    return estadoRef.set({ ia: { ligado: false, motor: 'claude', em: new Date().toISOString() } }, { merge: true }).catch(() => {});
  };
}

module.exports = { iniciarAtendenteClaude, perguntarAoClaude, montarPergunta, traduzirErro, instrucoesClaude };
