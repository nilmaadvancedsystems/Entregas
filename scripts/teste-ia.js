// Testes do reforço de IA. Rode antes de publicar qualquer mudança nele:
//   node teste-ia.js
// Não acessa Gemini nem Firestore: só as funções puras.
//
// O teste mais importante deste arquivo é o da peneira de dado pessoal. Se
// ele quebrar, CPF ou telefone de cliente está indo pro Google — que é
// exatamente o que o escritório evitou quando tirou a base de dentro do
// entregas.html.
const c = require('./ia-consultas');
const a = require('./ia-atendente');

let falhas = 0, total = 0;
function igual(nome, obtido, esperado) {
  total++;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log('FALHOU  ' + nome +
      '\n        obtido:   ' + JSON.stringify(obtido) +
      '\n        esperado: ' + JSON.stringify(esperado));
  }
}
function certo(nome, condicao) { igual(nome, !!condicao, true); }

// ---------- a peneira de dado pessoal ----------
const CLIENTE_COMPLETO = {
  id: 'c1',
  nome: 'VOLPONI AGROPECUARIA LTDA',
  documento: '12.345.678/0001-90',
  telefone: '(66) 99999-1234',
  email: 'volponi@exemplo.com',
  emails: ['financeiro@exemplo.com'],
  endereco: 'Rua das Flores, 100',
  geo: { lat: -15.5, lng: -56.1 },
  ativo: true,
  documentosNaoAplicaveis: ['aplicacao'],
  rg: '1234567',                       // campo inventado: tem que nascer barrado
};

const limpo = c.limparCliente(CLIENTE_COMPLETO);
const saiu = JSON.stringify(limpo);

certo('CNPJ não sai', saiu.indexOf('12.345.678') === -1);
certo('CNPJ sem pontuação também não sai', saiu.indexOf('12345678') === -1);
certo('telefone não sai', saiu.indexOf('99999') === -1);
certo('e-mail não sai', saiu.indexOf('@exemplo.com') === -1);
certo('endereço não sai', saiu.indexOf('Rua das Flores') === -1);
certo('coordenada não sai', saiu.indexOf('-15.5') === -1);
certo('campo novo do cadastro nasce barrado (rg)', saiu.indexOf('1234567') === -1);
certo('o nome sai (é o que a pergunta precisa)', saiu.indexOf('VOLPONI') !== -1);
igual('a peneira devolve exatamente estes campos',
  Object.keys(limpo).sort(),
  ['ativo', 'documentosNaoAplicaveis', 'id', 'nome', 'temEmail']);
igual('temEmail vira booleano, não o endereço', limpo.temEmail, true);
igual('sem e-mail nenhum, temEmail é falso',
  c.limparCliente({ id: 'x', nome: 'Fulano' }).temEmail, false);

// ---------- competência ----------
igual('competência do dia', c.competenciaAtual('2026-09-18T12:00:00Z'), '2026-09');
igual('mês com um dígito ganha zero', c.competenciaAtual('2026-03-01T12:00:00Z'), '2026-03');
certo('AAAA-MM válido', c.competenciaValida('2026-09'));
certo('mês 13 é inválido', !c.competenciaValida('2026-13'));
certo('mês 00 é inválido', !c.competenciaValida('2026-00'));
certo('texto solto é inválido', !c.competenciaValida('setembro'));
certo('vazio é inválido', !c.competenciaValida(''));

// ---------- pendências (a regra da tela de Cobrança) ----------
const CLIENTES = [
  { id: 'a', nome: 'Alfa', ativo: true, email: 'a@x.com' },
  { id: 'b', nome: 'Beta', ativo: true, documentosNaoAplicaveis: ['aplicacao'], email: 'b@x.com' },
  { id: 'd', nome: 'Delta', ativo: true },                       // sem e-mail
  { id: 'i', nome: 'Inativo', ativo: false, email: 'i@x.com' },
  { id: 's', nome: 'SemMovimento', ativo: true, email: 's@x.com' },
  { id: 'z', nome: 'Zulu', ativo: true, email: 'z@x.com' },
];
const DOCS = new Map([
  ['s', { semMovimento: true }],
  ['z', { extrato: true, comprovante: true, aplicacao: true }],   // entregou tudo
  ['b', { extrato: true, comprovante: true }],                    // aplicação não se aplica
]);
const r = c.pendenciasDe(CLIENTES, DOCS, { competencia: '2026-09' });
const nomes = r.pendentes.map(p => p.cliente);

igual('cliente inativo não entra', nomes.indexOf('Inativo'), -1);
igual('mês sem movimento não tem pendência', nomes.indexOf('SemMovimento'), -1);
igual('quem entregou tudo não entra', nomes.indexOf('Zulu'), -1);
igual('"não se aplica" não conta como falta', nomes.indexOf('Beta'), -1);
igual('quem deve tudo entra', nomes, ['Alfa', 'Delta']);
igual('conta quem está sem e-mail', r.semEmail, 1);
igual('ordem alfabética', nomes, nomes.slice().sort());
igual('lista o que falta, por extenso',
  r.pendentes[0].faltando, ['Extrato Bancário', 'Comprovante', 'Aplicação']);
igual('somente_com_email tira quem não tem e-mail',
  c.pendenciasDe(CLIENTES, DOCS, { competencia: '2026-09', incluirSemEmail: false })
    .pendentes.map(p => p.cliente),
  ['Alfa']);

// ---------- busca por nome ----------
const BASE = [
  { id: '1', nome: 'JOSÉ DA SILVA' },
  { id: '2', nome: 'VOLPONI AGROPECUARIA' },
  { id: '3', nome: 'TRANSPORTES VOLPONI' },
];
igual('acha ignorando acento', c.buscarClientesEm(BASE, 'jose').map(x => x.id), ['1']);
igual('acha ignorando maiúscula', c.buscarClientesEm(BASE, 'SILVA').map(x => x.id), ['1']);
igual('quem começa com o termo vem antes de quem só contém',
  c.buscarClientesEm(BASE, 'volponi').map(x => x.id), ['2', '3']);
igual('termo vazio não devolve tudo', c.buscarClientesEm(BASE, '   '), []);

// ---------- teto por consulta ----------
igual('sem limite pedido, usa o padrão', c.limitar(undefined), c.LIMITE_PADRAO);
igual('limite absurdo cai no teto', c.limitar(99999), c.LIMITE_MAXIMO);
igual('limite negativo vira o padrão', c.limitar(-5), c.LIMITE_PADRAO);
igual('limite em texto é entendido', c.limitar('10'), 10);

// ---------- resumo do mês ----------
const ENTREGAS = [
  { status: 'confirmada', temAssinatura: true, itens: [{ tipo: 'das', valor: 100 }] },
  { status: 'confirmada', temAssinatura: false, itens: [{ tipo: 'das', valor: 50.5 }, { tipo: 'fgts', valor: null }] },
  { status: 'pendente', itens: [] },
];
const resumo = c.resumirMes(ENTREGAS);
igual('total', resumo.total, 3);
igual('confirmadas', resumo.confirmadas, 2);
igual('pendentes', resumo.pendentes, 1);
igual('assinadas', resumo.assinadas, 1);
igual('soma valores, ignorando os nulos', resumo.valorTotal, 150.5);
igual('conta por tipo de documento', resumo.porDocumento, { das: 2, fgts: 1 });

// A assinatura é uma imagem em base64; ela nunca pode entrar no resumo que
// sobe pro modelo — não caberia, e não é o que a pergunta precisa.
const comAnexo = c.resumirEntrega({
  id: 'e1', clienteNome: 'Alfa', itens: [], temAssinatura: true,
  assinatura: 'data:image/png;base64,AAAA', foto: 'data:image/jpeg;base64,BBBB',
});
certo('a imagem da assinatura não entra no resumo',
  JSON.stringify(comAnexo).indexOf('base64') === -1);
igual('mas o fato de estar assinada entra', comAnexo.assinada, true);

// ---------- histórico mandado pro modelo ----------
const HIST = [
  { papel: 'user', texto: 'oi' },
  { papel: 'model', texto: 'olá' },
  { papel: 'model', texto: '   ' },      // vazio: não sobe
  { papel: 'user', texto: 'e aí' },
];
igual('mensagem vazia não sobe', a.montarHistorico(HIST).length, 3);
igual('papel do modelo vira "model"', a.montarHistorico(HIST)[1].role, 'model');
igual('qualquer outro papel vira "user"', a.montarHistorico(HIST)[0].role, 'user');
igual('o histórico é cortado no teto',
  a.montarHistorico(Array.from({ length: 100 }, (_, i) => ({ papel: 'user', texto: 'x' + i }))).length,
  24);

// ---------- juntar os pedaços do stream ----------
// Texto com texto emenda; o lacre do raciocínio (thoughtSignature) nunca pode
// ser perdido numa emenda, senão a próxima ida de ferramenta é recusada.
let partes = [];
a.acumularParte(partes, { text: 'Bom ' });
a.acumularParte(partes, { text: 'dia' });
igual('pedaços de texto viram um só', partes, [{ text: 'Bom dia' }]);

partes = [];
a.acumularParte(partes, { text: 'a', thoughtSignature: 'LACRE' });
a.acumularParte(partes, { text: 'b' });
igual('não emenda em cima de um lacre', partes.length, 2);
igual('o lacre sobrevive', partes[0].thoughtSignature, 'LACRE');

partes = [];
a.acumularParte(partes, { text: 'pensando', thought: true });
a.acumularParte(partes, { text: 'resposta' });
igual('raciocínio não emenda com resposta', partes.length, 2);

partes = [];
a.acumularParte(partes, { functionCall: { name: 'listar_pendencias', args: {} } });
a.acumularParte(partes, { text: 'ok' });
igual('chamada de ferramenta vira parte própria', partes.length, 2);

// ---------- erros traduzidos ----------
certo('cota estourada vira recado em português',
  /cota do Gemini/.test(a.traduzirErro(new Error('429 RESOURCE_EXHAUSTED'))));
certo('chave inválida aponta o arquivo',
  /gemini_key\.json/.test(a.traduzirErro(new Error('API key not valid'))));
certo('modelo inexistente manda trocar em Integrações',
  /Integrações/.test(a.traduzirErro(new Error('404 model not found'))));

// ---------- as ferramentas declaradas ----------
igual('são quatro ferramentas', c.FERRAMENTAS.length, 4);
certo('toda ferramenta tem nome e descrição',
  c.FERRAMENTAS.every(f => f.name && f.description));
certo('toda ferramenta usa parametersJsonSchema (e não o "parameters" antigo)',
  c.FERRAMENTAS.every(f => f.parametersJsonSchema && !f.parameters));
certo('nenhuma ferramenta grava, apaga ou envia',
  c.FERRAMENTAS.every(f => !/gravar|apagar|excluir|enviar|criar|alterar|registrar/i.test(f.name)));

console.log('\n' + (total - falhas) + '/' + total + ' passaram.');
if (falhas) { console.log(falhas + ' FALHA(S).'); process.exit(1); }
