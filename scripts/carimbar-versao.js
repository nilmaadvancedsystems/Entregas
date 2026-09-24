// Carimba a versão do app em cada commit (roda pelo .githooks/pre-commit).
//
// Versão = "2.<número do commit> · <data>", mostrada no rodapé do ☰
// (NilmaShell.versao / opção versao do NilmaShell.montar). O mesmo número
// vai no ?v= dos arquivos compartilhados (nilma-shell.js, nilma-ui.css,
// nilma-ui.js, nilma-icones.css, nilma-dialogo.js): mudou o número, o navegador busca o arquivo novo em vez de
// ficar com o antigo guardado.
//
// Só age quando o commit leva alguma página ou arquivo compartilhado. Não
// mexe em página que tenha mudança FORA do commit (outra sessão pode estar
// editando): carimbar e dar "git add" nela levaria esse trabalho junto.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
const PAGINAS = ['entregas.html', 'Pendencias-e-envio-automatico-via-Gmail.html', 'lcdpr.html', 'conciliador.html', 'cheque-especial.html'];
const COMPARTILHADOS = ['nilma-shell.js', 'nilma-ui.css', 'nilma-ui.js', 'nilma-icones.css', 'nilma-dialogo.js'];
const git = (c) => execSync('git ' + c, { encoding: 'utf8' }).trim();

const noCommit = git('diff --cached --name-only').split(/\r?\n/).filter(Boolean);
if (!noCommit.some((f) => PAGINAS.includes(f) || COMPARTILHADOS.includes(f))) process.exit(0);

const n = Number(git('rev-list --count HEAD')) + 1;
const d = new Date();
const data = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
const rotulo = '2.' + n + ' · ' + data;

for (const f of PAGINAS) {
  if (!fs.existsSync(f)) continue;
  try { execSync('git diff --quiet -- "' + f + '"'); } catch (e) {
    console.log('carimbar-versao: pulei ' + f + ' (tem mudança fora deste commit)');
    continue;
  }
  const antes = fs.readFileSync(f, 'utf8');
  const depois = antes
    .replace(/((?:src|href)="nilma-(?:shell\.js|ui\.css|ui\.js|icones\.css|dialogo\.js))(?:\?v=[^"]*)?"/g, '$1?v=' + n + '"')
    .replace(/NilmaShell\.versao\('[^']*'\)/g, "NilmaShell.versao('" + rotulo + "')")
    .replace(/(NilmaShell\.montar\(\{[^\n]*?versao: )'[^']*'/g, "$1'" + rotulo + "'");
  if (depois !== antes) {
    fs.writeFileSync(f, depois);
    git('add -- "' + f + '"');
  }
}
console.log('carimbar-versao: versão ' + rotulo);
