// Testes das funções puras do app (entregas.html), tiradas do próprio arquivo.
// Não abre navegador nem banco.  Uso:  node scripts/teste-app.js
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'entregas.html'), 'utf8');
// pega "  function nome(...) { ... }" até a chave de fechamento alinhada em dois espaços
const pega = nome => {
  const ini = s.indexOf('  function ' + nome + '(');
  const fim = s.indexOf('\n  }\n', ini);
  if (ini < 0 || fim < 0) throw new Error('nao achei ' + nome);
  return s.slice(ini, fim + 5);
};
let falhas = 0, total = 0;
const igual = (nome, a, b) => { total++; if (JSON.stringify(a) !== JSON.stringify(b)) { falhas++; console.log('FALHOU', nome, '\n  obtido:  ', JSON.stringify(a), '\n  esperado:', JSON.stringify(b)); } };

// ---------- ler guia com a câmera: linha digitável -> 44 dígitos das barras ----------
const barras = new Function(pega('barrasDaLinha_') + '; return barrasDaLinha_;')();
igual('linha de arrecadação vira as 44 barras', barras('85800000012-3 34560328261-2 23071234567-1 89012345678-1'), '85800000012' + '34560328261' + '23071234567' + '89012345678');
igual('linha de boleto de banco vira as 44 barras', barras('00190.50095 40144.816069 06809.350314 3 37370000000100'), '0019' + '3' + '37370000000100' + '05009' + '4014481606' + '0680935031');
igual('texto que não é linha digitável devolve vazio', barras('12345'), '');

// ---------- o que o histórico ensina sobre o cliente ----------
const dica = new Function(pega('dicaDoCliente_') + '; return dicaDoCliente_;')();
const em = (h, status) => ({ status, confirmadoEm: new Date(2026, 8, 10, h, 15).toISOString() });
igual('menos de três entregas: não fala nada', dica([em(9, 'confirmada'), em(10, 'confirmada')]), '');
igual('faixa de recebimento pelo miolo do histórico', dica([em(9, 'confirmada'), em(9, 'confirmada'), em(10, 'confirmada'), em(10, 'confirmada'), em(16, 'confirmada')]), 'Costuma receber entre 9h e 11h');
igual('duas falhas na mesma hora viram aviso', dica([em(12, 'falha'), em(12, 'falha'), em(9, 'confirmada'), em(9, 'confirmada'), em(10, 'confirmada')]), 'Costuma receber entre 9h e 11h · 2 tentativas sem sucesso por volta das 12h');

// ---------- motivo de não entrega ----------
const listaDeMotivos = s.match(/var MOTIVOS_DE_FALHA_ = (\[[^\]]+\]);/)[1];
const motivo = new Function('var MOTIVOS_DE_FALHA_ = ' + listaDeMotivos + ';' + pega('motivoPadrao_') + '; return motivoPadrao_;')();
igual('motivo de botão com complemento conta como o botão', motivo('Estabelecimento fechado. Volto amanhã cedo'), 'Estabelecimento fechado');
igual('texto livre conta como outro motivo', motivo('portão quebrado'), 'Outro motivo');
igual('sem motivo não conta', motivo(''), '');

// ---------- números do mês ----------
const numeros = new Function('motivoPadrao_', pega('numerosDoMes_') + '; return numerosDoMes_;')(motivo);
const n = numeros([{ status: 'confirmada', entregadoPorNome: 'João', temAssinatura: true }, { status: 'confirmada', entregadoPorNome: 'João', temFoto: true },
  { status: 'confirmada', entregadoPorNome: 'Link do cliente', recebidoPeloLink: true }, { status: 'falha', clienteNome: 'PADARIA', motivoFalha: 'Cliente ausente' },
  { status: 'falha', clienteNome: 'PADARIA', motivoFalha: 'Cliente ausente. De novo' }, { status: 'link' }]);
igual('números do mês', [n.feitas, n.falhas, n.noLink, n.comAssinatura, n.soFoto, n.peloLink, n.porPessoa[0], n.porMotivo[0], n.quemMaisFalha[0]],
  [3, 2, 1, 1, 1, 1, { nome: 'João', n: 2 }, { nome: 'Cliente ausente', n: 2 }, { nome: 'PADARIA', n: 2 }]);

// ---------- bancos do cliente no cadastro ----------
const ficam = new Function(pega('bancosQueFicam_') + '; return bancosQueFicam_;')();
igual('desmarcar banco que o robô aprendeu vira recusado', ficam({ bancos: ['bb', 'itau'], bancosPeloRobo: ['itau'] }, ['bb']), { bancos: ['bb'], bancosRecusados: ['itau'] });
igual('desmarcar banco posto à mão não vira recusado', ficam({ bancos: ['bb', 'itau'], bancosPeloRobo: [] }, ['bb']), { bancos: ['bb'], bancosRecusados: [] });
igual('marcar de novo tira da lista de recusados', ficam({ bancos: [], bancosRecusados: ['itau'] }, ['itau']), { bancos: ['itau'], bancosRecusados: [] });

// ---------- PIX do escritório (mostrado na página do cliente) ----------
const pix = new Function(pega('crc16Pix_') + pega('pixValido_') + pega('pixCopiaECola_') + '; return { gerar: pixCopiaECola_, valido: pixValido_ };')();
const codigoPix = pix.gerar('nilma@exemplo.com.br', 'Nilma Contabilidade', 'Taiobeiras');
igual('o PIX gerado passa no verificador do próprio app', pix.valido(codigoPix), true);
igual('a chave vai dentro do código', codigoPix.indexOf('nilma@exemplo.com.br') !== -1, true);
igual('nome sem acento, em maiúscula e cortado em 25', pix.gerar('x', 'Contabilidade Ação Muito Comprida Demais', 'Taiobeiras').indexOf('CONTABILIDADE ACAO MUITO ') !== -1, true);
igual('sem chave não há código', pix.gerar('', 'X', 'Y'), '');

// ---------- ordem fixa da rota: casar o apelido com a razão social ----------
const listaVazias = s.match(/var VAZIAS_NO_NOME_ = (\[[^\]]+\]);/)[1];
const zonasDaRota = s.slice(s.indexOf('var ZONAS_DA_ROTA_ = ['), s.indexOf('];', s.indexOf('var ZONAS_DA_ROTA_ = [')) + 2);
const rota = new Function(
  zonasDaRota + 'var VAZIAS_NO_NOME_ = ' + listaVazias + ';' +
  pega('palavrasDoNome_') + pega('quantoCombina_') + pega('acharClienteDaLinha_') + pega('zonaDaMarca_') + pega('lerListaDaRota_') +
  '; return { ler: lerListaDaRota_, combina: quantoCombina_, zona: zonaDaMarca_ };')();

const carteira = [
  { id: 'a', nome: 'ASSOCIACAO DOS DIRIGENTES LOJISTAS' },
  { id: 'b', nome: 'LOCADORA DANUBIO LTDA ME' },
  { id: 'c', nome: 'MADEIREIRA MIRANDA COMERCIO DE MADEIRAS LTDA' },
  { id: 'd', nome: 'EMPORIO DAS CARNES EIRELI' },
  { id: 'e', nome: 'JANIO JOSE DE ALMEIDA' },
  { id: 'f', nome: 'POSTO BEIRA RIO LTDA' }
];
igual('acento e Ltda não atrapalham', rota.combina('madeireira Miranda', carteira[2]), 1);
igual('nome que não existe não casa', rota.combina('padaria do zé', carteira[0]) < 0.6, true);
igual('marca de região é reconhecida', [rota.zona('encima'), rota.zona('parte inferior'), rota.zona('centro -'), rota.zona('selma')],
  ['superior', 'inferior', 'central', null]);

const lidas = rota.ler(['encima','associacao dos dirigentes','locadora danubio','nao existe esse ai','','parte inferior','madeireira Miranda','','centro','emporio das carnes','janio jose de almeida'].join(String.fromCharCode(10)), carteira);
igual('cada linha vai pra sua região, na ordem', lidas.map(function (x) { return x.zona + ':' + (x.cliente ? x.cliente.id : '-'); }),
  ['superior:a', 'superior:b', 'superior:-', 'inferior:c', 'central:d', 'central:e']);
igual('linha sem cliente fica marcada pra conferência', lidas.filter(function (x) { return !x.cliente; }).length, 1);

// ---------- a rota sai na ordem fixa quando ninguém arrastou ----------
const mapaDasZonas = s.slice(s.indexOf('var ORDEM_DAS_ZONAS_ ='), s.indexOf(';', s.indexOf('var ORDEM_DAS_ZONAS_ =')) + 1);
const ordenar = new Function('rotaFixa_', mapaDasZonas + pega('posicaoNaRotaFixa_') + pega('ordenarPendentes_') + '; return ordenarPendentes_;')(
  { zonas: { c1: 'superior', c2: 'central', c3: 'inferior' }, ordem: { c1: 2, c2: 1, c3: 1 } });
const naRota = [
  { id: 'e1', clienteId: 'c3', criadoEm: '2026-09-01T10:00:00Z' },
  { id: 'e2', clienteId: 'c2', criadoEm: '2026-09-01T09:00:00Z' },
  { id: 'e3', clienteId: 'c1', criadoEm: '2026-09-01T08:00:00Z' },
  { id: 'e4', clienteId: 'foraDaLista', criadoEm: '2026-09-01T07:00:00Z' }
];
igual('cima, centro, baixo — e quem não está na lista vai pro fim', ordenar(naRota).map(function (e) { return e.id; }), ['e3', 'e2', 'e1', 'e4']);
igual('o que foi arrastado hoje manda mais que a ordem fixa',
  ordenar(naRota.concat([{ id: 'e5', clienteId: 'c3', ordemRota: 0, criadoEm: '2026-09-02T07:00:00Z' }]))[0].id, 'e5');

console.log(falhas ? falhas + ' de ' + total + ' FALHARAM' : total + ' testes, todos passaram');
process.exit(falhas ? 1 : 0);
