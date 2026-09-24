// Gera nilma-icones.css: os ícones do app no desenho do design-n1 (SVG de
// traço 1,75 numa grade de 24), no lugar da fonte Phosphor que vinha do
// unpkg.com.
//
// A marcação continua a mesma — <i class="ph ph-trash"></i> —, então nada
// muda nas ~420 chamadas espalhadas pelo código: cada classe ph-<nome> ganha
// o seu SVG como máscara, pintada com a cor do texto (currentColor) e do
// tamanho da fonte (1em), como era a fonte.
//
// O mapa mora em scripts/icones.json: nome do Phosphor → { de, svg }. Os que
// existem no kit do N1 (js/nilma.js, mapa ICONS) vêm de lá; o resto vem do
// Lucide (ISC, https://lucide.dev), que é a mesma família de desenho.
// Ícone novo no código: acrescente a entrada no icones.json (o miolo do
// <svg> do Lucide) e rode `node scripts/monta-icones.js`. O script morre se
// alguma página usar um ph-<nome> que o mapa não tem.
const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..') + path.sep;
const icones = JSON.parse(fs.readFileSync(path.join(__dirname, 'icones.json'), 'utf8'));

const FONTES = ['entregas.html', 'Pendencias-e-envio-automatico-via-Gmail.html', 'lcdpr.html', 'conciliador.html',
  'cheque-especial.html', 'nilma-shell.js', 'nilma-extras.js', 'nilma-ui.js'];
const NAO_SAO_ICONE = new Set(['fill']); // ph-fill é a variante, não um ícone
const usados = new Set();
for (const f of FONTES) {
  for (const m of fs.readFileSync(base + f, 'utf8').matchAll(/\bph-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
    if (!NAO_SAO_ICONE.has(m[1])) usados.add(m[1]);
  }
}
const faltando = [...usados].filter((n) => !icones[n]).sort();
if (faltando.length) {
  console.error('monta-icones: sem desenho no scripts/icones.json para: ' + faltando.join(', '));
  process.exit(1);
}

function dataUri(miolo) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" ' +
    'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + miolo + '</svg>';
  return 'url("data:image/svg+xml,' + svg.replace(/"/g, "'").replace(/[<>#%]/g, encodeURIComponent) + '")';
}

const linhas = Object.keys(icones).sort().map((n) => '.ph-' + n + ' { --ico: ' + dataUri(icones[n].svg) + '; }');
const css = `/* ==========================================================================
   Nilma — ícones (design-n1)

   Gerado por scripts/monta-icones.js a partir de scripts/icones.json.
   Não edite à mão: mude o mapa e rode o script.

   <i class="ph ph-<nome>"></i> desenha o ícone com o traço de 1,75 do N1,
   na cor do texto e no tamanho da fonte. ph-fill (a variante cheia do
   Phosphor) usa o mesmo desenho: o N1 só tem ícone de traço.
   Desenhos: kit design-n1 e Lucide (ISC, https://lucide.dev).
   ========================================================================== */
.ph, .ph-fill {
  display: inline-block; width: 1em; height: 1em; flex: none;
  font-style: normal; line-height: 1; vertical-align: -.125em;
  background-color: currentColor;
  -webkit-mask: var(--ico) center / contain no-repeat;
  mask: var(--ico) center / contain no-repeat;
}
${linhas.join('\n')}
`;
fs.writeFileSync(base + 'nilma-icones.css', css);
console.log('nilma-icones.css:', Object.keys(icones).length, 'ícones,', Math.round(css.length / 1024) + ' KB; usados nas páginas:', usados.size);
