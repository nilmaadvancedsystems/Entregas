// Como o robô reconhece o banco de um extrato.
//
// Ele olha o CABEÇALHO do PDF (o começo do texto), não o documento inteiro:
// extrato do Sicoob cita "Banco do Brasil" numa TED no meio da página e isso
// não pode virar conta no BB.
//
// Quem é cada banco (nome, sigla, cores) mora em ../bancos-nilma.js, que o
// cadastro e a tela de Pendências também leem. Aqui fica só o que é do robô:
// os padrões de texto, casados por id. Banco novo entra lá; se precisar ser
// reconhecido sozinho, ganha um padrão aqui também.
const { BANCOS: LISTA } = require('../bancos-nilma');

const PADROES = {
  bb: [/banco do brasil/i, /\bsisbb\b/i, /\bbb\.com\.br/i],
  caixa: [/caixa econ[oô]mica/i, /\bcaixa\.gov\.br/i],
  bnb: [/banco do nordeste/i, /\bbnb\.gov\.br/i],
  itau: [/ita[uú] unibanco/i, /\bbanco ita[uú]\b/i, /\bitau\.com\.br/i],
  bradesco: [/bradesco/i],
  santander: [/santander/i],
  sicoob: [/sicoob/i, /bancoob/i],
  sicredi: [/sicredi/i],
  cresol: [/cresol/i],
  nubank: [/nu pagamentos/i, /nubank/i],
  inter: [/banco inter\b/i, /\binter&co/i, /bancointer/i],
  c6: [/\bc6 bank\b/i, /\bbanco c6\b/i],
  mercadopago: [/mercado ?pago/i],
  pagbank: [/pagseguro/i, /pagbank/i],
  cora: [/cora sociedade/i, /\bcora scd\b/i],
  stone: [/stone pagamentos/i, /stone institui/i],
  btg: [/btg pactual/i],
  safra: [/banco safra/i],
  banrisul: [/banrisul/i]
};

// A lista do cadastro com os padrões acoplados, pra quem já usava BANCOS.
const BANCOS = LISTA.map(b => Object.assign({}, b, { padroes: PADROES[b.id] || [] }));
// POR_ID continua sendo Map: é assim que email-html.js já lia.
const POR_ID = new Map(BANCOS.map(b => [b.id, b]));
const CABECALHO = 1500;   // caracteres do começo de cada PDF que contam

// Bancos de UM extrato, pelo cabeçalho do texto.
function bancosDoTexto(texto) {
  const topo = String(texto || '').slice(0, CABECALHO);
  return BANCOS.filter(b => b.padroes.some(p => p.test(topo))).map(b => b.id);
}

// Vários PDFs: cada um olhado pelo próprio cabeçalho.
function bancosDosTextos(textos) {
  const achados = new Set();
  (textos || []).forEach(t => bancosDoTexto(t).forEach(id => achados.add(id)));
  return [...achados];
}

module.exports = { BANCOS, POR_ID, bancosDoTexto, bancosDosTextos };
