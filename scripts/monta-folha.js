// Gera nilma-ui.css a partir do entregas.html: tokens, paletas, preferências,
// base e os componentes genéricos (cartão, campo, botão, chip, selo, janela,
// aviso). Assim as telas menores (LCDPR, Conciliadorzinho, Cheque especial)
// usam o MESMO sistema, sem copiar valor na mão.
//
// O recorte é por ÂNCORA, não por número de linha: antes bastava alguém
// acrescentar uma regra no meio do entregas.html pra folha sair cortada no
// lugar errado, em silêncio. Cada pedaço vai da linha que começa até a linha
// que começa o pedaço seguinte (exclusiva), e o script morre se uma âncora
// sumir ou aparecer duas vezes.
const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..') + path.sep;
const linhas = fs.readFileSync(base + 'entregas.html', 'utf8').split('\n');

function acharLinha(texto) {
  const achados = [];
  for (let i = 0; i < linhas.length; i++) if (linhas[i] === texto) achados.push(i);
  if (achados.length === 0) throw new Error('âncora sumiu do entregas.html: ' + JSON.stringify(texto));
  if (achados.length > 1) throw new Error('âncora aparece ' + achados.length + ' vezes: ' + JSON.stringify(texto));
  return achados[0];
}

// [título, primeira linha do pedaço, âncora de fim, quantas linhas parar antes dela]
const pedacos = [
  ['tokens, tema escuro, paletas, preferências e barra de rolagem',
   '  :root {',
   '  /* ---------- base ---------- */'],
  ['base: corpo, tipografia, toque, ícones, foco',
   '  /* ---------- base ---------- */',
   '     Moldura: barra de cima, marca, menu'],
  ['cartão',
   '  .card {',
   '  .field { display: block; margin-bottom: var(--esp-4); }'],
  ['campo, entrada e erro de campo',
   '  .field { display: block; margin-bottom: var(--esp-4); }',
   '  .linha-busca-cnpj { display: flex; gap: var(--esp-2); align-items: stretch; flex-wrap: wrap; }'],
  ['chip',
   '  .chip { position: relative; }',
   '  /* ---------- valores ---------- */'],
  // Começa na regra, não no título: começar no meio do comentário deixava
  // o "*/" solto na frente do .btn, e o navegador jogava a regra fora.
  ['botão',
   '  .btn {',
   '     Linhas de lista — o coração do app', 2],
  ['aviso flutuante',
   '  .toast {',
   '     Modal', 2],
  ['janela (modal)',
   '  .modal-overlay {',
   '  /* barra de meta */', 2],
  ['selo de situação',
   '  /* ---------- selo de situação ---------- */',
   '  .empty-state { color: var(--ink-faint); font-size: var(--t-base); text-align: center; padding: var(--esp-5) var(--esp-3); line-height: 1.5; }'],
  ['tela vazia e janela',
   '  .empty-state { color: var(--ink-faint); font-size: var(--t-base); text-align: center; padding: var(--esp-5) var(--esp-3); line-height: 1.5; }',
   '  /* ---------- esqueleto de carregamento ---------- */'],
  // A casca GitHub (barra de cima, abas do módulo, gavetas) é montada por
  // nilma-shell.js em TODAS as páginas; o visual dela mora no entregas.html
  // entre estas duas âncoras e sai daqui pras outras telas.
  ['casca GitHub: barra de cima, abas do módulo e gavetas (nilma-shell.js)',
   '  /* ---------- casca GitHub: barra, abas e gavetas ---------- */',
   '  /* ---------- fim da casca GitHub ---------- */'],
  // O submenu padrão (a barrinha de categorias no alto do conteúdo) e o
  // painel "Perguntar à IA" (usado por nilma-extras.js nas outras telas).
  ['submenu padrão (menu de 2º nível)',
   '  /* ---------- submenu (menu de 2º nível) ---------- */',
   '  /* ---------- fim do submenu ---------- */'],
  ['painel "Perguntar à IA" (nilma-extras.js)',
   '  /* A consulta abre como uma barra de pesquisa aberta (o "Ask" do GitHub):',
   '  /* ---------- fim da consulta (Perguntar à IA) ---------- */'],
  // A camada design-n1 dos componentes (botões, selos, seletor, campos,
  // janela e aviso flutuante) vem depois de tudo acima e troca só o visual;
  // sem ela as outras telas ficavam com os componentes do jeito antigo.
  // As camadas N1 "telas do Entregas" e "Clientes" são só do entregas.html.
  ['design-n1: componentes (botões, selos, seletor, campos, janela, aviso)',
   '  :root { /* botões do N1 (esta linha não pode ser igual à do :root do topo: é âncora do monta-folha) */',
   '  /* ---------- fim da camada design-n1 (componentes) ---------- */'],
];

const cabeca = `/* ==========================================================================
   Nilma — folha comum das telas menores

   Isto NÃO é um tema novo: é o mesmo sistema do entregas.html (tokens, cores,
   paletas, preferências de aparência e os componentes genéricos), recortado
   pra quem não é um arquivo só — LCDPR, Conciliadorzinho e Cheque especial.

   Como manter: este arquivo é gerado por scripts/monta-folha.js a partir do
   entregas.html. Mudou o sistema lá, rode o script de novo em vez de editar
   aqui na mão.

   Quem usa esta folha também carrega nilma-ui.js, que aplica tema, cor,
   tamanho de texto, espaçamento e animação antes da primeira pintura e
   acompanha a troca feita em outra aba.
   ========================================================================== */
`;

const corpo = pedacos.map(function (p) {
  const titulo = p[0];
  const a = acharLinha(p[1]);
  const b = acharLinha(p[2]) - (p[3] || 0);
  if (b <= a) throw new Error('pedaço "' + titulo + '" está de trás pra frente no entregas.html');
  return '\n/* ---------------------------------------------------------------\n   ' + titulo +
    '\n   (entregas.html, linhas ' + (a + 1) + '-' + b + ')\n   --------------------------------------------------------------- */\n' +
    linhas.slice(a, b).join('\n');
}).join('\n');

// tira a indentação de dois espaços que o bloco <style> do entregas usa
// o que não vem do entregas.html: janela de Aparência e a moldura destas telas
const extra = fs.readFileSync(path.join(__dirname, 'extra-folha.css'), 'utf8');
const css = (cabeca + corpo).replace(/^ {2}/gm, '') + '\n' + extra + '\n';
fs.writeFileSync(base + 'nilma-ui.css', css);
console.log('nilma-ui.css:', Math.round(css.length / 1024) + ' KB,', css.split('\n').length, 'linhas');
