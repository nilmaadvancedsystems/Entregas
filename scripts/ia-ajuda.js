// A IA tira dúvidas sobre como usar o app (pedido do escritório, 28/09/2026).
// O conhecimento fica em guia-do-app.md, em linguagem de quem usa; a
// ferramenta devolve o guia inteiro (é curto) ou só as seções do assunto.
const fs = require('fs');
const path = require('path');

const GUIA = path.join(__dirname, 'guia-do-app.md');

function semAcento(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

// Seções "## ..." que tenham alguma palavra do assunto; sem assunto (ou sem
// achar nada), o guia inteiro.
function secoesDoGuia(texto, assunto) {
  const secoes = String(texto).split(/\n(?=## )/);
  const palavras = semAcento(assunto).split(/[^a-z0-9]+/).filter(w => w.length > 3);
  if (!palavras.length) return texto;
  const achadas = secoes.filter(s => { const t = semAcento(s); return palavras.some(w => t.indexOf(w) !== -1); });
  return achadas.length ? achadas.join('\n') : texto;
}

const FERRAMENTAS_AJUDA = [{
  name: 'como_usar_o_app',
  description: 'Guia de uso do app Nilma (Entregas, Rota, Painel, Honorários, Clientes, Pendências, Robô do Gmail, Arquivo, Tarefas, Contábil, Fiscal, a própria IA, configurações e problemas comuns). Use SEMPRE que perguntarem como fazer algo no app, onde fica uma função ou por que algo não aparece.',
  parametersJsonSchema: {
    type: 'object',
    properties: { assunto: { type: 'string', description: 'Opcional: o tema da dúvida (ex.: "rota", "marcar extrato", "foto de perfil").' } },
  },
}];
const NOMES_AJUDA = new Set(FERRAMENTAS_AJUDA.map(f => f.name));

function executarAjuda(nome, args) {
  if (nome !== 'como_usar_o_app') return { erro: 'ferramenta desconhecida: ' + nome };
  let texto;
  try { texto = fs.readFileSync(GUIA, 'utf8'); } catch (e) { return { erro: 'o guia do app não está neste PC' }; }
  return { guia: secoesDoGuia(texto, args && args.assunto) };
}

module.exports = { FERRAMENTAS_AJUDA, NOMES_AJUDA, executarAjuda, secoesDoGuia };
