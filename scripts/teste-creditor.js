// Testes do Creditor (nilma-creditor.js): leitura do relatório do banco, conta
// de cada cliente pelo balancete (com a conta principal quando a filial não
// bate), lançamentos, fechamento por dia e o .xls. Casos vindos do teste do
// Extratudo (nads). Não abre navegador nem banco.  Uso:  node scripts/teste-creditor.js
const XLSX = require('xlsx');
const cr = require('../nilma-creditor');

let falhas = 0, total = 0;
const igual = (nome, a, b) => {
  total++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    falhas++;
    console.log('FALHOU', nome, '\n  obtido:  ', JSON.stringify(a), '\n  esperado:', JSON.stringify(b));
  }
};

// ---------- números ----------
igual('chave da NF', [cr.chaveNf('004521'), cr.chaveNf('4548/2'), cr.chaveNf('NF 4521'), cr.chaveNf('')], ['4521', '4548', '4521', '']);
igual('dinheiro e data', [cr.dinheiro('R$ 1.234,56'), cr.dinheiro('abc'), cr.dataBR('1/9/26'), cr.dataBR('2026-09-01'), cr.dataBR(46266)], [1234.56, null, '01/09/2026', '01/09/2026', '01/09/2026']);

// ---------- relatório em texto (o exemplo) ----------
const r = cr.lerRelatorioTexto(cr.EXEMPLO_RELATORIO);
igual('exemplo: grupos, baixa de fora, sem aviso', [r.grupos.map(g => g.titulos.length), r.ignorados, r.avisos], [[3, 2, 2], 1, []]);
igual('exemplo: primeiro título', (({ sacado, nossoNumero, nf, valor, mora, desconto, liquidacao, cobrado }) => ({ sacado, nossoNumero, nf, valor, mora, desconto, liquidacao, cobrado }))(r.grupos[0].titulos[0]),
  { sacado: 'MERCADO BOM PRECO LTDA', nossoNumero: '00012345671', nf: '4521', valor: 1250, mora: 12.5, desconto: 0, liquidacao: '01/09/2026', cobrado: 1262.5 });
igual('exemplo: totais impressos', [r.grupos[0].impresso, r.totalGeral], [{ valor: 4180.4, mora: 12.5, desconto: 16.61, outros: null, cobrado: 4176.29 }, { valor: 7047.88, mora: 12.5, desconto: 46.21, outros: null, cobrado: 7014.17 }]);
igual('exemplo: grupos conferem', r.grupos.map(g => cr.conferirGrupo(g).situacao), ['ok', 'ok', 'ok']);
igual('filial no nome do sacado', r.grupos[1].titulos[0].sacado, 'SUPERMERCADO ALVORADA LTDA -TAI1');

// ---------- leitura errada: correção pelo total impresso ----------
const errado = cr.lerRelatorioTexto(cr.EXEMPLO_RELATORIO
  .replace('ACOUGUE BOI GORDO  00012345737  4555  02/09/2026  450,00', 'ACOUGUE BOI GORDO  00012345737  4555  02/09/2026  480,00')
  .replace('PADARIA SAO JORGE ME  00012345682  4533  01/09/2026  830,40  0,00  16,61', 'PADARIA SAO JORGE ME  00012345682  4533  01/09/2026  830,40  16,61  0,00'));
igual('lido errado: dois grupos não batem', errado.grupos.map(g => cr.conferirGrupo(g).situacao), ['diverge', 'diverge', 'ok']);
const corr = cr.corrigirLeitura(errado);
igual('corrige o dígito pelo cobrado e a mora/desconto trocados', corr.correcoes.map(c => [c.nf, c.campo, c.antes, c.depois]), [['4533', 'mora', 16.61, 0], ['4533', 'desconto', 0, 16.61], ['4555', 'valor', 480, 450]]);
igual('depois da correção, tudo bate', corr.rel.grupos.map(g => cr.conferirGrupo(g).situacao), ['ok', 'ok', 'ok']);
igual('o que já batia não muda', cr.corrigirLeitura(r).correcoes, []);
const semTotal = cr.lerRelatorioLinhas([['Sacado', 'Seu Número', 'Valor', 'Dt. Liquidação', 'Vlr. Cobrado'], ['A', '1', '10,00', '01/09/2026', '11,00']]);
igual('sem total impresso não mexe', cr.corrigirLeitura(semTotal).correcoes, []);

// ---------- planilha ----------
const pl = cr.lerRelatorioLinhas([
  ['Sacado', 'Seu Número', 'Valor', 'Vlr. Mora', 'Dt. Liquidação', 'Vlr. Cobrado'],
  ['A', '1', '10,00', '1,00', '01/09/2026', '11,00'],
  ['Total de Valores do grupo', '', '10,00', '1,00', '', '11,00'],
]);
igual('planilha: título e total', [pl.grupos.length, pl.grupos[0].titulos[0].mora, pl.grupos[0].impresso.cobrado], [1, 1, 11]);
let erro = '';
try { cr.lerRelatorioLinhas([['x', 'y'], ['1', '2']]); } catch (e) { erro = e.message; }
igual('planilha sem cabeçalho: erro claro', /cabeçalho/.test(erro), true);

// ---------- PDF do Sicoob por posição ----------
const it_ = (texto, x, y, largura) => ({ texto, x, y, largura });
const cabecalho = (y, liq = 'Dt. Liquid.', cobr = 'Vlr. Cobrado') => [
  it_('Sacado', 86, y, 28), it_('Nosso Número', 181, y, 57), it_('Seu Número', 263, y, 47), it_('Dt. Previsão Crédito', 329, y, 76),
  it_('Vencimento', 423, y, 45), it_('Dt. Limite', 492, y - 5, 36), it_('Pgto', 502, y + 5, 18), it_('Valor (R$)', 539, y, 38),
  it_('Vlr. Mora Vlr. Desc. ', 581, y, 75), it_('Vlr. Outros', 657, y - 5, 41), it_('Acresc.', 663, y + 5, 29),
  it_(liq, 709, y, 39), it_(cobr, 761, y, 48),
];
const linha = (y, nome, nosso, seu, valor, mora, liq, cobrado) => [
  ...nome.map((n, i) => it_(n, 31, y - (nome.length > 1 ? 5 : 0) + i * 9, n.length * 5)),
  it_(nosso, 215, y, 29), it_(seu, 294, y, 31), it_(liq, 347, y, 40), it_(liq, 426, y, 40),
  it_(valor, 547, y, 31), it_(mora, 595, y, 20), it_('0,00', 636, y, 16), it_('0,00', 683, y, 16),
  it_(liq, 708, y, 40), it_(cobrado, 781, y, 31),
];
const pag1 = [
  it_('58-LIQUIDAÇÃO - VIA COMPENSAÇÃO', 28, 114, 186), ...cabecalho(136),
  ...linha(161, ['CLIENTE UM'], '10542-4', '9848/2/3', '2.493,55', '69,83', '04/08/2026', '2.563,38'),
  ...linha(189, ['MERCADINHO DOIS DE', 'TAIOBEIRAS LTDA'], '10573-2', '9862/2/2', '1.004,82', '0,00', '05/08/2026', '1.004,82'),
];
const pag2 = [
  it_('58-LIQUIDAÇÃO - VIA COMPENSAÇÃO', 28, 114, 186), ...cabecalho(136),
  ...linha(161, ['CLIENTE TRES'], '10580-4', '9868/2/2', '1.025,66', '0,00', '17/08/2026', '1.025,66'),
  it_('4.593,86', 764, 205, 50), it_('Total de Valores do grupo:', 583, 205, 118),
  it_('3', 803, 220, 11), it_('Total de Registros do grupo:', 575, 220, 126),
  it_('82-BAIXA - PEDIDO CEDENTE', 28, 250, 143), ...cabecalho(272, 'Dt. Baixa', 'Vlr. Baixado'),
  ...linha(297, ['CLIENTE BAIXADO'], '10507-6', '9827/1/1', '344,30', '0,00', '06/08/2026', '344,30'),
  it_('344,30', 775, 330, 39), it_('Total de Valores do grupo:', 583, 330, 118),
  it_('Total de Valores Liquidados:', 564, 420, 137), it_('4.593,86', 764, 424, 50),
  it_('Total de Registros Liquidados:', 554, 435, 147), it_('3', 797, 439, 17),
];
const pdf = cr.relatorioDoPdf([pag1, pag2]);
igual('PDF: títulos pelas colunas, nome em duas linhas, baixa de fora',
  pdf.grupos[0].titulos.map(t => [t.sacado, t.nf, t.valor, t.mora, t.liquidacao, t.cobrado]),
  [['CLIENTE UM', '9848/2/3', 2493.55, 69.83, '04/08/2026', 2563.38], ['MERCADINHO DOIS DE TAIOBEIRAS LTDA', '9862/2/2', 1004.82, 0, '05/08/2026', 1004.82], ['CLIENTE TRES', '9868/2/2', 1025.66, 0, '17/08/2026', 1025.66]]);
igual('PDF: totais e registros', [pdf.grupos[0].impresso.cobrado, pdf.grupos[0].registros, pdf.ignorados, pdf.registrosGeral, cr.conferirGrupo(pdf.grupos[0]).situacao], [4593.86, 3, 1, 3, 'ok']);
igual('PDF sem cabeçalho: lê como texto', cr.relatorioDoPdf([[it_('nada aqui', 10, 10, 50)]]).grupos.length, 0);
igual('linhas do PDF pela altura', cr.linhasDosItens([it_('100,00', 300, 100, 30), it_('CLIENTE', 10, 101, 40), it_('A', 52, 100, 5), it_('Total', 10, 120, 20)]), ['CLIENTE A  100,00', 'Total']);

// ---------- conta de cada cliente pelo balancete ----------
const bal = cr.balanceteDoDocumento({ contas: [
  { codigo: '1', nome: 'ATIVO', sintetica: true, ordem: 0 },
  { codigo: '11', nome: 'CLIENTES', sintetica: true, ordem: 1 },
  { codigo: '12110', nome: 'ARAUJO E SA LTDA', ordem: 2 },
  { codigo: '12200', nome: 'MERCADINHO PLANALTO DE TAIOBEIRAS LTDA', ordem: 3 },
  { codigo: '12300', nome: 'SUPERMERCADO BOA COMPRA LTDA', ordem: 4 },
  { codigo: '12301', nome: 'SUPERMERCADO BOA COMPRA LTDA', ordem: 5 },
  { codigo: '12400', nome: 'SUPERMERCADO A E E', ordem: 6 },
  { codigo: '12500', nome: 'MEDEIROS E MOURA LTDA -PA3', ordem: 7 },
  { codigo: '12501', nome: 'MEDEIROS E MOURA LTDA', ordem: 8 },
  { codigo: '12502', nome: 'MEDEIROS E MOURA LTDA -AL2', ordem: 9 },
  { codigo: '12600', nome: 'COMERCIAL SOUZA LTDA -PA1', ordem: 10 },
  { codigo: '12601', nome: 'COMERCIAL SOUZA LTDA -AL2', ordem: 11 },
  { codigo: '13', nome: 'ESTOQUES', sintetica: true, ordem: 12 },
  { codigo: '13100', nome: 'MERCADORIAS PARA REVENDA', ordem: 13 },
] });
const cl = cr.contasDeClientes(bal);
igual('só as analíticas abaixo de Clientes', cl.map(c => c.codigo), ['12110', '12200', '12300', '12301', '12400', '12500', '12501', '12502', '12600', '12601']);
const mesmo = (a, b) => cr.semelhancaDeNome(a, b) >= cr.SEMELHANCA_MINIMA;
igual('nome cortado e sufixo de filial', [
  mesmo('ARAUJO E SA LTDA -TAI1', 'ARAUJO E SA LTDA'), mesmo('MERCADINHO PLANALTO DE TAIOB', 'MERCADINHO PLANALTO DE TAIOBEIRAS LTDA'),
  mesmo('ARAUJO', 'MERCADORIAS'), mesmo('SUPERMERCADO JJJ MIRANDA LTDA', 'SUPERMERCADO A E E'),
  mesmo('SUPERMERCADOS BOA COMPRA LTDA -TAI1', 'SUPERMERCADOS BOA COMPRA LTDA PA3'),
], [true, true, false, false, false]);

const t = (id, sacado) => ({ id, sacado, nossoNumero: '', nf: String(id), valor: 10, mora: 0, desconto: 0, outros: 0, liquidacao: '03/08/2026', cobrado: 10 });
const [a, b, c, d] = cr.cruzarPeloBalancete([t(1, 'ARAUJO E SA LTDA'), t(2, 'SUPERMERCADO BOA COMPRA'), t(3, 'FULANO DE TAL'), t(4, 'CLIENTE NOVO')], cl, { 'cliente novo': { conta: '12999', nome: 'CLIENTE NOVO', em: '' } });
igual('acha a conta pelo nome', [a.situacao, a.linha.contrapartida], ['ok', '12110']);
igual('mesmo nome em duas contas, sem filial no banco: a principal (primeira do plano)', [b.situacao, b.linha.contrapartida, b.principal, b.opcoes.map(o => o.codigo)], ['ok', '12300', true, ['12300', '12301']]);
igual('sem conta: pede decisão', c.situacao, 'nao-encontrada');
igual('a aprendida resolve', [d.situacao, d.linha.contrapartida, d.aprendida], ['ok', '12999', true]);

const [m1, m2, m3, m4] = cr.cruzarPeloBalancete([t(5, 'MEDEIROS E MOURA LTDA -PA3'), t(6, 'MEDEIROS E MOURA LTDA'), t(7, 'MEDEIROS E MOURA LTDA -TAI1'), t(8, 'COMERCIAL SOUZA LTDA -TAI1')], cl, {});
igual('filial que tem conta: a da filial', [m1.situacao, m1.linha.contrapartida, !!m1.principal], ['ok', '12500', false]);
igual('banco sem filial: a conta principal (a sem filial no nome)', [m2.situacao, m2.linha.contrapartida, m2.principal], ['ok', '12501', true]);
igual('filial sem conta no balancete: a conta principal', [m3.situacao, m3.linha.contrapartida, m3.principal, /TAI1/.test(m3.nota)], ['ok', '12501', true, true]);
igual('filial sem conta e sem conta sem filial: a primeira do plano', [m4.situacao, m4.linha.contrapartida, m4.opcoes.map(o => o.codigo)], ['ok', '12600', ['12600', '12601']]);
igual('a aprendida só sugere quando há conta principal', /Da última vez: 12502/.test(cr.cruzarPeloBalancete([t(6, 'MEDEIROS E MOURA LTDA')], cl, { 'medeiros e moura ltda': { conta: '12502', nome: 'X', em: '' } })[0].nota), true);

// ---------- aprendizado ----------
const ts = [t(1, 'ARAUJO E SA LTDA'), t(2, 'PADARIA SOL'), t(3, 'BAR DO ZE'), t(6, 'MEDEIROS E MOURA LTDA')];
const cz = cr.cruzarPeloBalancete(ts, cl, {});
const dec = { 2: { tipo: 'manual', contrapartida: '21005', historico: '' }, 3: { tipo: 'excluir' } };
const ap = cr.aprender({}, ts, cz, dec, new Date('2026-09-29T12:00:00Z'));
igual('aprende do balancete e da informada; excluído e conta principal não ensinam', Object.keys(ap).sort().map(k => [k, ap[k].conta]), [['araujo e sa ltda', '12110'], ['padaria sol', '21005']]);
const aprendidos = { 'padaria sol': { conta: '21005', nome: 'PADARIA SOL', em: '' } };
const ts2 = [t(1, 'PADARIA SOL'), t(2, 'OUTRO CLIENTE')];
const cz2 = cr.cruzarPeloBalancete(ts2, [], {});
igual('aprendida resolve os sem conta; a da pessoa vence', [cr.decisoesAprendidas(ts2, cz2, aprendidos, {}), cr.decisoesAprendidas(ts2, cz2, aprendidos, { 1: { tipo: 'excluir' } })], [{ 1: { tipo: 'manual', contrapartida: '21005', historico: '' } }, {}]);
igual('pendentes', cr.pendentes(cz2, cr.decisoesAprendidas(ts2, cz2, aprendidos, {})).map(x => x.tituloId), [2]);
igual('nome cortado acha o aprendido só quando é um', [
  (cr.contaAprendida({ 'supermercado central ltda': { conta: '1' }, 'supermercado central filial': { conta: '2' } }, 'SUPERMERCADO CENTRAL') || null),
  cr.contaAprendida({ 'supermercado central ltda': { conta: '1' } }, 'SUPERMERCADO CENTRAL').conta,
], [null, '1']);

// ---------- contas do layout ----------
const comercio = cr.balanceteDoDocumento({ contas: [
  { codigo: '1', nome: 'ATIVO', grupo: 'Ativo', sintetica: true }, { codigo: '10502', nome: 'BANCO DO BRASIL C/ MOVIMENTO', grupo: 'Ativo' },
  { codigo: '10503', nome: 'BANCO SICOOB C/ MOVIMENTO', grupo: 'Ativo' }, { codigo: '10510', nome: 'SICOOB APLICACAO', grupo: 'Ativo' },
  { codigo: '97300', nome: 'JUROS PASSIVOS', grupo: 'Despesa' }, { codigo: '97304', nome: 'JUROS RECEBIDOS', grupo: 'Receita' },
  { codigo: '85000', nome: 'DESCONTOS OBTIDOS', grupo: 'Receita' }, { codigo: '85001', nome: 'DESCONTOS CONCEDIDOS', grupo: 'Despesa' },
] });
igual('sugere banco, juros e descontos pelo nome', cr.resolverContas(comercio, cr.CONFIG_VAZIA).contas, cr.CONTAS_PADRAO);
const cfg = cr.escolherConta(cr.CONFIG_VAZIA, 'banco', '10502', comercio);
igual('salva vale; padrão sem balancete', [cr.resolverContas(comercio, cfg).detalhe.banco.origem, cr.resolverContas(cr.SEM_BALANCETE, cr.CONFIG_VAZIA).detalhe.banco.origem], ['salva', 'padrao']);
const sumiu = Object.assign({}, comercio, { contas: comercio.contas.filter(x => x.codigo !== '10502') });
igual('salva que sumiu do balancete bloqueia', cr.resolverContas(sumiu, cfg).detalhe.banco.bloqueia, true);
igual('confirmar salva as sugeridas', cr.confirmarContas(cr.CONFIG_VAZIA, cr.resolverContas(comercio, cr.CONFIG_VAZIA)).contas, { banco: '10503', juros: '97304', desconto: '85001' });
igual('documento guardado conferido', cr.configDoDocumento({ contas: { banco: ' ', juros: 5 }, clientes: { x: { conta: 5 }, y: { conta: '' } } }), { contas: { juros: '5' }, nomes: {}, clientes: { x: { conta: '5', nome: 'x', em: '' } } });

// ---------- lançamentos, fechamento e o .xls ----------
const tit = r.grupos.flatMap(g => g.titulos);
const balEx = cr.balanceteDoDocumento({ contas: [
  { codigo: '11', nome: 'CLIENTES', sintetica: true }, { codigo: '11201', nome: 'MERCADO BOM PRECO LTDA' }, { codigo: '11202', nome: 'PADARIA SAO JORGE ME' },
  { codigo: '11203', nome: 'RESTAURANTE SABOR CASEIRO LTDA' }, { codigo: '11204', nome: 'SUPERMERCADO ALVORADA LTDA' }, { codigo: '11205', nome: 'ACOUGUE BOI GORDO' },
  { codigo: '11206', nome: 'MERCEARIA DOIS IRMAOS' },
] });
const czEx = cr.cruzarPeloBalancete(tit, cr.contasDeClientes(balEx), {});
const id = nf => tit.find(x => x.nf === nf).id;
igual('exemplo: só o EMPORIO fica sem conta', cr.pendentes(czEx, {}).map(x => tit.find(y => y.id === x.tituloId).nf), ['4560']);
const decEx = { [id('4560')]: { tipo: 'manual', contrapartida: '11299', historico: 'NF 4560 - EMPORIO VERDE' } };
const l = cr.gerarLancamentos(tit, czEx, decEx, cr.CONTAS_PADRAO);
const da = nf => l.filter(x => x.documento === nf).map(x => [x.tipo, x.debito, x.credito, x.codHistorico, x.historico, x.valor, x.data]);
igual('principal + mora', da('4521'), [['principal', '10503', '11201', '246', '4521 - MERCADO BOM PRECO LTDA', 1250, '01/09/2026'], ['mora', '10503', '97304', '59648', '4521 - MERCADO BOM PRECO LTDA', 12.5, '01/09/2026']]);
igual('principal + desconto', da('4533'), [['principal', '10503', '11202', '246', '4533 - PADARIA SAO JORGE ME', 830.4, '01/09/2026'], ['desconto', '85001', '10503', '256', '4533 - PADARIA SAO JORGE ME', 16.61, '01/09/2026']]);
igual('filial TAI1 sem conta vai na principal', da('4548')[0].slice(1, 3), ['10503', '11204']);
igual('conta informada à mão', da('4560')[0].slice(1, 5), ['10503', '11299', '246', 'NF 4560 - EMPORIO VERDE']);
const f = cr.fecharPorDia(r.grupos, l, cr.titulosFora(tit, czEx, decEx), cr.CONTAS_PADRAO);
igual('fecha dia a dia com o impresso', f.map(x => [x.data, x.liquido, x.esperado, x.fonte, x.situacao]), [['01/09/2026', 4176.29, 4176.29, 'impresso', 'ok'], ['02/09/2026', 1065.33, 1065.33, 'impresso', 'ok'], ['03/09/2026', 1772.55, 1772.55, 'impresso', 'ok']]);
const decFora = { [id('4560')]: { tipo: 'excluir' } };
const f2 = cr.fecharPorDia(r.grupos, cr.gerarLancamentos(tit, czEx, decFora, cr.CONTAS_PADRAO), cr.titulosFora(tit, czEx, decFora), cr.CONTAS_PADRAO);
igual('excluído: a diferença do dia fica explicada', [f2[2].fora, f2[2].diferenca, f2[2].situacao], [322.15, -322.15, 'explicada']);
const wb = XLSX.read(cr.planilhaDeImportacao(XLSX, l), { type: 'array' });
const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
igual('.xls: cabeçalho de 8 colunas', linhas[0], cr.CABECALHO_8_COLUNAS);
igual('.xls: valor e documento numéricos, data de verdade', [linhas[1].slice(2), typeof linhas[1][1]], [[10503, 11201, 246, '4521 - MERCADO BOM PRECO LTDA', 1250, 4521], 'number']);

// ---------- competência e Drive ----------
igual('competência padrão e fora do mês', [cr.competenciaPadrao(new Date(2026, 0, 15)), cr.rotuloCompetencia('2026-08'),
  cr.titulosForaDaCompetencia([{ liquidacao: '31/08/2026' }, { liquidacao: '01/09/2026' }, { liquidacao: '' }], '2026-08').map(x => x.liquidacao)], ['2025-12', '08/2026', ['01/09/2026']]);
igual('o nome fala da competência', ['CREDLIQUIDAÇÃO 08-2026.pdf', 'credliquidacao 2026.08.pdf', 'CREDLIQ 082026.pdf', 'CREDLIQUIDACAO AGOSTO 2026.pdf', 'cred liquidacao ago26.pdf', 'CREDLIQUIDAÇÃO 07-2026.pdf', 'CREDLIQUIDACAO 18 2026.pdf'].map(n => cr.falaDaCompetencia(n, '2026-08')), [true, true, true, true, true, false, false]);
const itens = [
  { i: 'c', n: 'CONTÁBIL', p: 'r', t: 'd' }, { i: 'rc', n: 'RECEBIMENTO DE CLIENTES', p: 'c', t: 'd' }, { i: 'm8', n: '08', p: 'rc', t: 'd' },
  { i: 'a', n: 'CREDLIQUIDAÇÃO 07-2026.pdf', p: 'rc', t: 'f' }, { i: 'b', n: 'CREDLIQUIDAÇÃO 08-2026.pdf', p: 'rc', t: 'f', m: '2026-09-02' },
  { i: 'x', n: 'outro 08-2026.pdf', p: 'rc', t: 'f' }, { i: 'y', n: 'CREDLIQUIDAÇÃO 08-2026.pdf', p: 'outra', t: 'f' },
];
igual('pasta do cliente pelo código', cr.pastaDoCliente([{ id: 'r', nomePasta: '292 - FITO', codigo: 292 }], 292).id, 'r');
const busca = cr.acharRelatorioNoDrive(itens, 'r', '2026-08');
igual('acha o credliquidação da competência', [busca.situacao, busca.arquivo.id], ['achou', 'b']);
igual('outras situações da busca', [cr.acharRelatorioNoDrive(itens, 'r', '2026-10').situacao, cr.acharRelatorioNoDrive(itens.filter(i => i.i !== 'c'), 'r', '2026-08').situacao,
  cr.acharRelatorioNoDrive(itens, null, '2026-08').situacao, cr.acharRelatorioNoDrive(itens.concat([{ i: 'c2', n: 'CREDLIQUIDACAO AGOSTO 2026.xlsx', p: 'm8', t: 'f' }]), 'r', '2026-08').situacao], ['nada', 'sem-pasta', 'sem-cliente', 'varios']);

console.log('\n' + (total - falhas) + '/' + total + ' passaram.');
if (falhas) { console.log(falhas + ' FALHA(S).'); process.exit(1); }
