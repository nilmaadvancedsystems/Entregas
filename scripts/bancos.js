// Bancos que o escritório vê nos extratos dos clientes.
//
// O robô reconhece o banco pelo CABEÇALHO do extrato (o começo do texto do
// PDF), não pelo documento inteiro: extrato do Sicoob cita "Banco do Brasil"
// numa TED no meio da página e isso não pode virar conta no BB.
//
// A mesma lista (id, nome, cor) está em entregas.html (BANCOS_), pro cadastro;
// banco novo entra nos dois lugares. O logo de cada um fica em
// scripts/logos-bancos/<id>.png; sem o arquivo, o e-mail e o cadastro mostram
// um selo com a cor e a sigla.
const BANCOS = [
  { id: 'bb', nome: 'Banco do Brasil', sigla: 'BB', compe: '001', cor: '#FCF800', tinta: '#003DA5', padroes: [/banco do brasil/i, /\bsisbb\b/i, /\bbb\.com\.br/i] },
  { id: 'caixa', nome: 'Caixa', sigla: 'CAIXA', compe: '104', cor: '#005CA9', tinta: '#FFFFFF', padroes: [/caixa econ[oô]mica/i, /\bcaixa\.gov\.br/i] },
  { id: 'bnb', nome: 'Banco do Nordeste', sigla: 'BNB', compe: '004', cor: '#A6192E', tinta: '#FFFFFF', padroes: [/banco do nordeste/i, /\bbnb\.gov\.br/i] },
  { id: 'itau', nome: 'Itaú', sigla: 'itaú', compe: '341', cor: '#EC7000', tinta: '#FFFFFF', padroes: [/ita[uú] unibanco/i, /\bbanco ita[uú]\b/i, /\bitau\.com\.br/i] },
  { id: 'bradesco', nome: 'Bradesco', sigla: 'BRA', compe: '237', cor: '#CC092F', tinta: '#FFFFFF', padroes: [/bradesco/i] },
  { id: 'santander', nome: 'Santander', sigla: 'SAN', compe: '033', cor: '#EC0000', tinta: '#FFFFFF', padroes: [/santander/i] },
  { id: 'sicoob', nome: 'Sicoob', sigla: 'SICOOB', compe: '756', cor: '#003641', tinta: '#7DB61C', padroes: [/sicoob/i, /bancoob/i] },
  { id: 'sicredi', nome: 'Sicredi', sigla: 'SICREDI', compe: '748', cor: '#3FA110', tinta: '#FFFFFF', padroes: [/sicredi/i] },
  { id: 'cresol', nome: 'Cresol', sigla: 'CRESOL', compe: '133', cor: '#00843D', tinta: '#FFFFFF', padroes: [/cresol/i] },
  { id: 'nubank', nome: 'Nubank', sigla: 'nu', compe: '260', cor: '#820AD1', tinta: '#FFFFFF', padroes: [/nu pagamentos/i, /nubank/i] },
  { id: 'inter', nome: 'Inter', sigla: 'inter', compe: '077', cor: '#FF7A00', tinta: '#FFFFFF', padroes: [/banco inter\b/i, /\binter&co/i, /bancointer/i] },
  { id: 'c6', nome: 'C6 Bank', sigla: 'C6', compe: '336', cor: '#242424', tinta: '#FFFFFF', padroes: [/\bc6 bank\b/i, /\bbanco c6\b/i] },
  { id: 'mercadopago', nome: 'Mercado Pago', sigla: 'MP', compe: '323', cor: '#00B1EA', tinta: '#FFFFFF', padroes: [/mercado ?pago/i] },
  { id: 'pagbank', nome: 'PagBank', sigla: 'PAG', compe: '290', cor: '#1BB99A', tinta: '#FFFFFF', padroes: [/pagseguro/i, /pagbank/i] },
  { id: 'cora', nome: 'Cora', sigla: 'cora', compe: '403', cor: '#FE3E6D', tinta: '#FFFFFF', padroes: [/cora sociedade/i, /\bcora scd\b/i] },
  { id: 'stone', nome: 'Stone', sigla: 'stone', compe: '197', cor: '#00A868', tinta: '#FFFFFF', padroes: [/stone pagamentos/i, /stone institui/i] },
  { id: 'btg', nome: 'BTG Pactual', sigla: 'BTG', compe: '208', cor: '#0B2A4A', tinta: '#FFFFFF', padroes: [/btg pactual/i] },
  { id: 'safra', nome: 'Safra', sigla: 'SAFRA', compe: '422', cor: '#1C2C4C', tinta: '#C9A96E', padroes: [/banco safra/i] },
  { id: 'banrisul', nome: 'Banrisul', sigla: 'BANRI', compe: '041', cor: '#004B8D', tinta: '#FFFFFF', padroes: [/banrisul/i] },
];
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
