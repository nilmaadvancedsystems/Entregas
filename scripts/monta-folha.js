// Gera nilma-ui.css a partir do entregas.html: tokens, paletas, preferências,
// base e os componentes genéricos (cartão, campo, botão, chip, selo, janela,
// aviso). Assim as telas menores (LCDPR, Conciliadorzinho, Cheque especial)
// usam o MESMO sistema, sem copiar valor na mão.
const fs = require('fs');
const base = 'C:/Users/Pao90/AppData/Local/Temp/claude/C--/9c418bbd-dcf3-486b-83e7-d3870a7108a0/scratchpad/patch-teste/';
const linhas = fs.readFileSync(base + 'entregas.html', 'utf8').split('\n');
const corte = (a, b) => linhas.slice(a - 1, b).join('\n');

// cada pedaço é um intervalo de linha do entregas.html (1 = primeira linha)
const pedacos = [
  ['tokens, tema escuro, paletas, preferências e barra de rolagem', 76, 337],
  ['base: corpo, tipografia, toque, ícones, foco', 339, 407],
  ['cartão', 531, 574],
  ['campo, entrada e erro de campo', 575, 624],
  ['chip', 702, 723],
  ['botão', 740, 796],
  ['selo de situação e tela vazia', 853, 868],
  ['aviso flutuante', 990, 1002],
  ['janela', 1003, 1046],
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

const corpo = pedacos.map(([titulo, a, b]) =>
  '\n/* ---------------------------------------------------------------\n   ' + titulo +
  '\n   (entregas.html, linhas ' + a + '-' + b + ')\n   --------------------------------------------------------------- */\n' +
  corte(a, b)
).join('\n');

// tira a indentação de dois espaços que o bloco <style> do entregas usa
// o que não vem do entregas.html: janela de Aparência e a moldura destas telas
const extra = fs.readFileSync(__dirname + '/extra-folha.css', 'utf8');
const css = (cabeca + corpo).replace(/^ {2}/gm, '') + '\n' + extra + '\n';
fs.writeFileSync(base + 'nilma-ui.css', css);
console.log('nilma-ui.css:', Math.round(css.length / 1024) + ' KB,', css.split('\n').length, 'linhas');
