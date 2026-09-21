// Como o robô reconhece o banco de um extrato.
//
// Ele olha o CABEÇALHO do PDF (o começo do texto), não o documento inteiro:
// extrato do Sicoob cita "Banco do Brasil" numa TED no meio da página e isso
// não pode virar conta no BB. A exceção é a ASSINATURA da instituição (razão
// social com S.A.), que também vale no rodapé — ver ASSINATURAS abaixo.
//
// Quem é cada banco (nome, sigla, cores) mora em ../bancos-nilma.js, que o
// cadastro e a tela de Pendências também leem. Aqui fica só o que é do robô:
// os padrões de texto, casados por id. Banco novo entra lá; se precisar ser
// reconhecido sozinho, ganha um padrão aqui também.
const { BANCOS: LISTA } = require('../bancos-nilma');

const PADROES = {
  // O extrato do BB (Extrato Mensal / Consolidado, do internet banking) não
  // traz o nome do banco em canto nenhum. O que o identifica é o título do
  // próprio extrato e o Invest Fácil, que é produto só dele.
  bb: [/banco do brasil/i, /\bsisbb\b/i, /\bbb\.com\.br/i,
       /extrato (mensal|consolidado) \/ por per[ií]odo/i, /invest f[áa]cil/i],
  caixa: [/caixa econ[oô]mica/i, /\bcaixa\.gov\.br/i],
  // No extrato do BNB o nome só aparece abreviado, no fundo de investimento
  // automático do saldo.
  bnb: [/banco do nordeste/i, /\bbnb\.gov\.br/i, /\bbnb\b/i],
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
// A assinatura da instituição — razão social com S.A. — pode ser procurada
// no rodapé, porque é ali que a instituição de pagamento assina o documento.
// Um PIX recebido de alguém do Nubank aparece como "REM: FULANO", não como
// "Nu Pagamentos S.A. - Instituição de Pagamento".
const ASSINATURAS = {
  nubank: [/nu pagamentos s\.?\s?a\.?\s*[-–]\s*institui/i, /nu financeira s\.?\s?a\.?/i],
  stone: [/stone institui[cç][aã]o de pagamento s\.?\s?a\.?/i],
  bnb: [/banco do nordeste do brasil s\.?\s?a\.?/i]
};

const CABECALHO = 1500;   // caracteres do começo do PDF que valem pro nome
const RODAPE = 1200;      // e do fim, que valem só pra assinatura

// O MIOLO do extrato é lançamento, e lançamento cita outro banco o tempo
// todo ("PIX RECEBIDO REM: ...", "TED para BANCO DO BRASIL"): é isso que não
// pode virar conta no banco errado. Por isso o nome do banco só conta no
// cabeçalho.
function bancosDoTexto(texto) {
  const t = String(texto || '');
  const topo = t.slice(0, CABECALHO);
  const fim = t.length > CABECALHO ? t.slice(-RODAPE) : '';
  return BANCOS.filter(function (b) {
    if (b.padroes.some(p => p.test(topo))) return true;
    const assina = ASSINATURAS[b.id] || [];
    return assina.some(p => p.test(topo) || p.test(fim));
  }).map(b => b.id);
}

// Vários PDFs: cada um olhado pelas próprias bordas.
function bancosDosTextos(textos) {
  const achados = new Set();
  (textos || []).forEach(t => bancosDoTexto(t).forEach(id => achados.add(id)));
  return [...achados];
}

module.exports = { BANCOS, POR_ID, ASSINATURAS, bancosDoTexto, bancosDosTextos };
