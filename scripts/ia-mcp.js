// As consultas do atendente, servidas pro Claude do PC (atendente-claude.js).
//
// O Claude conversa com ferramentas por um protocolo chamado MCP: ele liga
// este programa, pergunta quais ferramentas existem e pede cada consulta por
// uma linha JSON na entrada; a resposta volta por uma linha JSON na saída.
//
// As ferramentas são as 4 do ia-consultas.js (as mesmas que o Gemini usava)
// mais a leitura livre do banco do ia-banco.js. Todas só de leitura. Este
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
const TODAS = FERRAMENTAS.concat(FERRAMENTAS_BANCO);
const DO_BANCO = new Set(FERRAMENTAS_BANCO.map(f => f.name));

// O firebase-admin leva segundos pra carregar, e o Claude espera a lista de
// ferramentas antes de começar a pensar. Então o banco só é carregado na
// primeira consulta de verdade — e já começa a carregar em segundo plano.
let db = null;
function banco() { return db || (db = require('./firestore-client').getDb('entregas-2e5e2')); }
setImmediate(() => { try { banco(); } catch (e) {} });

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
          : await executarFerramenta(banco(), p.name, p.arguments || {});
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
