// As consultas do atendente, servidas pro Claude do PC (atendente-claude.js).
//
// O Claude conversa com ferramentas por um protocolo chamado MCP: ele liga
// este programa, pergunta quais ferramentas existem e pede cada consulta por
// uma linha JSON na entrada; a resposta volta por uma linha JSON na saída.
//
// As ferramentas são as 4 do ia-consultas.js (as mesmas que o Gemini usava),
// a leitura livre do banco do ia-banco.js e as ações preparadas do
// ia-acoes.js. Nenhuma grava no banco. Este
// arquivo só traduz o formato; nenhuma regra nova mora aqui.
//
// A saída padrão é do protocolo: qualquer console.log perdido no meio dela
// quebraria a conversa. Por isso todo log vai pra saída de erro.
require('./fuso.js');
console.log = console.info = console.warn = function () { process.stderr.write(Array.from(arguments).join(' ') + '\n'); };

const readline = require('readline');
const { FERRAMENTAS, executarFerramenta } = require('./ia-consultas');
// Além das 4 prontas, a leitura livre do banco (só pro Claude do PC).
const { FERRAMENTAS_BANCO, executarBanco } = require('./ia-banco');
// E as ações que a IA só PREPARA (ex.: colocar na rota): não gravam nada, a
// pessoa confirma num cartão na tela (ia-acoes.js).
const { FERRAMENTAS_ACOES, NOMES_ACOES, executarAcao } = require('./ia-acoes');
// E a leitura dos arquivos das pastas dos clientes no Drive deste PC (ia-arquivos.js).
const { FERRAMENTAS_ARQUIVOS, NOMES_ARQUIVOS, executarArquivo } = require('./ia-arquivos');
// E o guia de uso do app, pra tirar dúvidas (ia-ajuda.js).
const { FERRAMENTAS_AJUDA, NOMES_AJUDA, executarAjuda } = require('./ia-ajuda');
const TODAS = FERRAMENTAS.concat(FERRAMENTAS_BANCO, FERRAMENTAS_ACOES, FERRAMENTAS_ARQUIVOS, FERRAMENTAS_AJUDA);
const DO_BANCO = new Set(FERRAMENTAS_BANCO.map(f => f.name));

// O firebase-admin leva ~1,5 s pra carregar e trava o processo enquanto
// carrega. Se isso acontecesse na partida, o Claude esperava a resposta do
// "initialize" e às vezes desistia ("status: failed", sem ferramentas).
// Então o banco só começa a carregar DEPOIS de entregar a lista de
// ferramentas — a tempo da primeira consulta, sem atrasar a conexão.
let db = null;
function banco() { return db || (db = require('./firestore-client').getDb('entregas-2e5e2')); }
function carregarBancoDepois() { setTimeout(() => { try { banco(); } catch (e) {} }, 50); }

function enviar(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function atender(msg) {
  const p = msg.params || {};
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: p.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'nilma', version: '1.0.0' },
      };
    case 'ping':
      return {};
    case 'tools/list':
      carregarBancoDepois();
      return {
        tools: TODAS.map(f => ({
          name: f.name,
          description: f.description,
          inputSchema: f.parametersJsonSchema,
          annotations: { readOnlyHint: true },
        })),
      };
    case 'tools/call': {
      try {
        const r = DO_BANCO.has(p.name)
          ? await executarBanco(banco(), p.name, p.arguments || {})
          : NOMES_ACOES.has(p.name)
            ? await executarAcao(banco(), p.name, p.arguments || {})
            : NOMES_ARQUIVOS.has(p.name)
              ? await executarArquivo(banco(), p.name, p.arguments || {})
              : NOMES_AJUDA.has(p.name)
                ? executarAjuda(p.name, p.arguments || {})
                : await executarFerramenta(banco(), p.name, p.arguments || {});
        // imagem de uma pasta do Drive: vai como imagem, pro Claude ver
        if (r && r.imagem) {
          const resto = Object.assign({}, r); delete resto.imagem;
          return { content: [{ type: 'image', data: r.imagem.data, mimeType: r.imagem.mime }, { type: 'text', text: JSON.stringify(resto) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: !!(r && r.erro) };
      } catch (err) {
        return { content: [{ type: 'text', text: 'A consulta falhou: ' + err.message }], isError: true };
      }
    }
    default: {
      const e = new Error('método não suportado: ' + msg.method);
      e.code = -32601;
      throw e;
    }
  }
}

readline.createInterface({ input: process.stdin }).on('line', linha => {
  if (!linha.trim()) return;
  let msg;
  try { msg = JSON.parse(linha); } catch (e) { return; }
  if (msg.id == null) return;   // notificação (ex.: notifications/initialized): não tem resposta
  atender(msg)
    .then(result => enviar({ jsonrpc: '2.0', id: msg.id, result }))
    .catch(err => enviar({ jsonrpc: '2.0', id: msg.id, error: { code: err.code || -32603, message: err.message } }));
});
process.stdin.on('end', () => process.exit(0));
