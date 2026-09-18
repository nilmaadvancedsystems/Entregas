// Testes da Consulta rápida (o painel de perguntas do entregas.html).
// Rode antes de publicar qualquer mexida nela:  node teste-consulta.js
// Não abre navegador, não acessa Firestore: extrai do HTML as funções que
// decidem MÊS e INTENÇÃO — que é onde os erros de verdade acontecem — e roda
// elas contra casos concretos.
//
// Por que ler do HTML em vez de ter uma cópia aqui: cópia envelhece. Se
// alguém mexer no reconhecedor lá e não aqui, o teste continuaria passando
// enquanto a tela erra. Lendo do arquivo de verdade, o teste quebra junto.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'entregas.html'), 'utf8');

// Pega uma função pelo nome, do "function nome" até a linha que fecha com "}"
// na mesma indentação. O arquivo é indentado com 2 espaços de forma
// consistente, então isso é confiável aqui.
function extrair(nome) {
  const inicio = html.indexOf('  function ' + nome + '(');
  if (inicio === -1) throw new Error('não achei a função ' + nome + ' no entregas.html');
  const fim = html.indexOf('\n  }\n', inicio);
  if (fim === -1) throw new Error('não achei o fim da função ' + nome);
  return html.slice(inicio, fim + 4);
}

function extrairVar(nome) {
  const m = html.match(new RegExp('^  var ' + nome + ' = \\[[^\\]]*\\];', 'm'));
  if (!m) throw new Error('não achei a variável ' + nome);
  return m[0];
}

// Monta um mundinho com só o que essas funções precisam.
const codigo = [
  extrairVar('MESES_BUSCA_'),
  extrair('normalizarTexto_'),
  extrair('cqMes_'),
  'return { cqMes_: cqMes_, normalizarTexto_: normalizarTexto_ };',
].join('\n');
const alvo = new Function(codigo)();

let falhas = 0, total = 0;
function igual(nome, obtido, esperado) {
  total++;
  if (obtido !== esperado) {
    falhas++;
    console.log('FALHOU  ' + nome + '\n        obtido:   ' + obtido + '\n        esperado: ' + esperado);
  }
}

// ---------- o mês que a pergunta cita ----------
const hoje = new Date();
const mesAtual = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
const mesPassadoD = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
const mesPassado = mesPassadoD.getFullYear() + '-' + String(mesPassadoD.getMonth() + 1).padStart(2, '0');

igual('sem mês citado é o mês corrente',
  alvo.cqMes_('quem não mandou extrato?'), mesAtual);
igual('"esse mês" é o mês corrente',
  alvo.cqMes_('pendências desse mês'), mesAtual);
igual('"mês passado" volta um',
  alvo.cqMes_('pendências do mês passado'), mesPassado);
igual('formato AAAA-MM',
  alvo.cqMes_('pendências de 2026-03'), '2026-03');
igual('formato MM/AAAA',
  alvo.cqMes_('entregas de 08/2025'), '2025-08');
igual('MM/AAAA com um dígito',
  alvo.cqMes_('entregas de 3/2025'), '2025-03');
igual('mês por extenso com ano dito',
  alvo.cqMes_('pendências de março de 2024'), '2024-03');
igual('abreviação de três letras',
  alvo.cqMes_('resumo de ago'), (hoje.getMonth() >= 7 ? hoje.getFullYear() : hoje.getFullYear() - 1) + '-08');
igual('"março" não é confundido com "mar" de outro mês',
  alvo.cqMes_('pendências de marco de 2026'), '2026-03');
igual('maiúscula e acento não atrapalham',
  alvo.cqMes_('Pendências de MARÇO de 2026'), '2026-03');

// A regra do ano implícito: mês que ainda não chegou é do ano passado.
// Em setembro, "dezembro" quer dizer o dezembro anterior, não o que vem.
const dezEsperado = (hoje.getMonth() >= 11 ? hoje.getFullYear() : hoje.getFullYear() - 1) + '-12';
igual('mês que ainda não chegou é do ano passado',
  alvo.cqMes_('entregas de dezembro'), dezEsperado);

// ---------- a intenção reconhecida ----------
// Mesmas expressões do cqResponder_, lidas do arquivo pra não virar cópia
// que envelhece: se alguém mudar lá, isto lê a versão nova.
function regexDo(trecho) {
  const m = html.match(new RegExp('if \\(/' + trecho + '[^/]*/\\.test\\(t\\)'));
  if (!m) throw new Error('não achei o reconhecedor de ' + trecho);
  return new RegExp(m[0].slice(m[0].indexOf('/') + 1, m[0].lastIndexOf('/')));
}
const rePendencia = regexDo('pendencia');
const reRota = regexDo('\\\\brota');

function normal(s) { return alvo.normalizarTexto_(s).toLowerCase(); }
function ehPendencia(p) { return rePendencia.test(normal(p)) && !/rota|entregar/.test(normal(p)); }
function ehRota(p) { return reRota.test(normal(p)); }

igual('"quem não mandou extrato" é pendência', ehPendencia('quem não mandou extrato esse mês?'), true);
igual('"quem está devendo" é pendência', ehPendencia('quem está devendo documento?'), true);
igual('"o que está faltando" é pendência', ehPendencia('o que está faltando em agosto?'), true);
igual('"não entregou" é pendência', ehPendencia('quem não entregou nada?'), true);
igual('"o que falta entregar" NÃO é pendência, é rota',
  ehPendencia('o que falta entregar hoje?'), false);
igual('"o que falta entregar" é rota', ehRota('o que falta entregar hoje?'), true);
igual('"rota" é rota', ehRota('como está a rota?'), true);
igual('pergunta de cliente não vira pendência', ehPendencia('entregas do Volponi'), false);

console.log('\n' + (total - falhas) + '/' + total + ' passaram.');
if (falhas) { console.log(falhas + ' FALHA(S).'); process.exit(1); }
