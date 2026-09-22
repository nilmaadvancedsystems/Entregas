// Testes do robô do Gmail, com casos reais que já deram problema.
// Rode antes de publicar qualquer mudança no robô:  node teste-robo.js
// Não acessa Gmail nem Firestore: só as funções de detecção.
const r = require('./download-attachments');

let falhas = 0, total = 0;
function igual(nome, obtido, esperado) {
  total++;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log('FALHOU  ' + nome + '\n        obtido:   ' + JSON.stringify(obtido) + '\n        esperado: ' + JSON.stringify(esperado)); }
}

const SET_18 = Date.parse('2026-09-18T12:00:00Z');
const SET_15 = Date.parse('2026-09-15T12:00:00Z');
const JAN_10 = Date.parse('2027-01-10T12:00:00Z');

// ---------- mês a que o documento se refere ----------
igual('abreviação + ano', r.competenciaDoTexto('EXTRATOS BANCÁRIOS EMPRESAS VOLPONI AGO2026', SET_15), '2026-08');
igual('mês inteiro + ano colado', r.competenciaDoTexto('TÍTULOS PAGOS VOLPONI REF AGOSTO2026', SET_15), '2026-08');
igual('mm.aaaa no nome do arquivo', r.competenciaDoTexto('ArqEFD-11222333000181-07.2026.txt', SET_18), '2026-07');
igual('mês por extenso sem ano vale o mais recente', r.competenciaDoTexto('Extrato agosto', SET_15), '2026-08');
igual('dezembro visto em janeiro é do ano anterior', r.competenciaDoTexto('extrato dezembro', JAN_10), '2026-12');
igual('sem mês nenhum', r.competenciaDoTexto('bom dia, segue em anexo', SET_15), null);
igual('abreviação solta sem ano não conta ("mar", "out")', r.competenciaDoTexto('boleto mar aberto out', SET_15), null);
igual('corpo do e-mail: data de envio não define mês', r.competenciaDoTexto('Bom dia, enviado em 18/09/2026, segue', SET_18, true), null);
igual('corpo do e-mail: mês por extenso ainda vale', r.competenciaDoTexto('segue o extrato de agosto', SET_18, true), '2026-08');
igual('dígitos de CNPJ não viram mês', r.competenciaDoTexto('CNPJ 11222333000181', SET_18), null);
igual('chave de NF-e não vira mês', r.competenciaDoTexto('Nfe_000155-1-31260811222333000181550010000001551192419083.xml', SET_18), null);

// ---------- documento sem mês escrito: vale o dia limite do escritório ----------
const SET_02 = new Date(2026, 8, 2, 10).getTime();
const SET_11 = new Date(2026, 8, 11, 10).getTime();
const JAN_05 = new Date(2027, 0, 5, 10).getTime();
igual('chegou antes do dia limite: é do mês anterior', r.competenciaPresumida(SET_02, 10), '2026-08');
igual('chegou depois do dia limite: é do mês do e-mail', r.competenciaPresumida(SET_11, 10), '2026-09');
igual('janeiro antes do limite volta pra dezembro do ano anterior', r.competenciaPresumida(JAN_05, 10), '2026-12');
igual('sem dia limite configurado, nada muda', r.competenciaPresumida(SET_02, 0), '2026-09');

// ---------- portal do cliente: o que ainda falta ----------
igual('portal mostra os dois últimos meses fechados', r.mesesDoPortal(new Date(2026, 8, 18)), ['2026-08', '2026-07']);
igual('portal em janeiro olha dezembro e novembro', r.mesesDoPortal(new Date(2027, 0, 5)), ['2026-12', '2026-11']);
igual('nada recebido: faltam os três', r.faltamNoMes({}, null), ['extrato', 'comprovante', 'aplicacao']);
igual('recebeu extrato, não tem aplicação', r.faltamNoMes({ documentosNaoAplicaveis: ['aplicacao'] }, { extrato: true }), ['comprovante']);
igual('mês sem movimento não deve nada', r.faltamNoMes({}, { semMovimento: true }), []);

// ---------- vigia de CNPJ: o que mudou na Receita ----------
const cnpj = require('./vigia-cnpj');
const daApi = { descricao_situacao_cadastral: 'Ativa', opcao_pelo_simples: true, opcao_pelo_mei: false, razao_social: 'PADARIA EXEMPLO LTDA', cnae_fiscal: 1091102,
  cnae_fiscal_descricao: 'Padaria', descricao_tipo_de_logradouro: 'RUA', logradouro: 'DAS FLORES', numero: '120', bairro: 'CENTRO', municipio: 'TAIOBEIRAS', uf: 'MG',
  qsa: [{ nome_socio: 'MARIA EXEMPLO', cnpj_cpf_do_socio: '***123456**', faixa_etaria: 'Entre 41 a 50 anos' }, { nome_socio: 'ANA EXEMPLO' }] };
const r1 = cnpj.retrato(daApi);
igual('retrato guarda situação em maiúsculas', r1.situacao, 'ATIVA');
igual('retrato monta o endereço', r1.endereco, 'RUA DAS FLORES, 120, CENTRO, TAIOBEIRAS/MG');
igual('retrato não guarda CPF nem idade de sócio', JSON.stringify(r1).includes('123456') || JSON.stringify(r1).includes('anos'), false);
igual('sócios em ordem, só o nome', r1.socios, ['ANA EXEMPLO', 'MARIA EXEMPLO']);
igual('nada mudou: nenhuma diferença', cnpj.diferencas(r1, cnpj.retrato(daApi)), []);
const r2 = cnpj.retrato(Object.assign({}, daApi, { opcao_pelo_simples: false, descricao_situacao_cadastral: 'INAPTA', descricao_motivo_situacao_cadastral: 'OMISSAO DE DECLARACOES', qsa: [{ nome_socio: 'ANA EXEMPLO' }, { nome_socio: 'JOSE NOVO' }] }));
igual('saiu do Simples e ficou inapta são graves', cnpj.diferencas(r1, r2).filter(m => m.grave).map(m => m.texto),
  ['Situação cadastral: ATIVA → INAPTA (omissao de declaracoes)', 'Saiu do Simples Nacional']);
igual('troca de sócio aparece, sem ser grave', cnpj.diferencas(r1, r2).filter(m => !m.grave).map(m => m.texto),
  ['Saiu do quadro de sócios: MARIA EXEMPLO', 'Entrou no quadro de sócios: JOSE NOVO']);
igual('primeira conferência de cliente ativo não avisa nada', cnpj.avisosDaPrimeiraVez(r1), []);
igual('resposta de outro CNPJ é recusada', cnpj.respostaValida(Object.assign({ cnpj: '11222333000181' }, daApi), '12.345.678/0001-95'), false);
igual('resposta sem situação é recusada', cnpj.respostaValida({ cnpj: '11222333000181' }, '11222333000181'), false);
igual('resposta boa passa', cnpj.respostaValida(Object.assign({ cnpj: '11222333000181' }, daApi), '11.222.333/0001-81'), true);
const semCampos = cnpj.retrato(Object.assign({}, daApi, { opcao_pelo_simples: null, opcao_pelo_mei: null, qsa: null }), r1);
igual('Simples e sócios que vieram vazios mantêm o que já se sabia (sem falso alarme)', cnpj.diferencas(r1, semCampos), []);
igual('retrato igual não é regravado', cnpj.mesmoRetrato(r1, cnpj.retrato(daApi)), true);
igual('retrato diferente é regravado', cnpj.mesmoRetrato(r1, r2), false);
igual('primeira conferência de cliente inapto avisa', cnpj.avisosDaPrimeiraVez(r2).length, 1);

// ---------- lembrete de vencimento pro cliente ----------
const venc = require('./avisos-vencimento');
const guias = [
  { id: 'a', vencimento: '2026-11-19', status: 'confirmada', itens: [{ tipo: 'DAS', valor: 1240.5 }] },
  { id: 'b', vencimento: '2026-11-20', status: 'pendente', itens: [{ tipo: 'FGTS', valor: null }] },
  { id: 'c', vencimento: '2026-11-20', status: 'falha', itens: [{ tipo: 'DARF', valor: 10 }] },
  { id: 'd', vencimento: '2026-11-23', status: 'confirmada', itens: [{ tipo: 'INSS', valor: 99 }] },
  { id: 'e', vencimento: '', status: 'confirmada', itens: [] },
];
igual('quinta avisa o de hoje e o de amanhã, sem o que falhou', venc.guiasParaAvisar(guias, new Date(2026, 10, 19, 9)).map(a => a.entrega.id + ':' + a.quando), ['a:hoje', 'b:amanhã']);
igual('sexta olha até segunda', venc.guiasParaAvisar(guias, new Date(2026, 10, 20, 9)).map(a => a.entrega.id + ':' + a.quando), ['b:hoje', 'd:segunda']);
igual('dia sem vencimento não avisa', venc.guiasParaAvisar(guias, new Date(2026, 10, 10, 9)), []);
igual('texto de uma guia', venc.textoDoAviso(venc.guiasParaAvisar(guias, new Date(2026, 10, 18, 9))).titulo, 'Vence amanhã: DAS R$ 1.240,50');
igual('texto de várias', venc.textoDoAviso(venc.guiasParaAvisar(guias, new Date(2026, 10, 19, 9))).titulo, '2 guias vencendo');

// ---------- lista local de clientes (o robô não relê o cadastro a cada rodada) ----------
const cache = require('./clientes-cache');
const fsT = require('fs');
const guardado = fsT.existsSync(cache.ARQUIVO) ? fsT.readFileSync(cache.ARQUIVO) : null;
fsT.writeFileSync(cache.ARQUIVO, JSON.stringify({ em: new Date().toISOString(), clientes: [{ id: 'x', dados: { nome: 'EXEMPLO', email: 'a@exemplo.com.br' } }] }));
igual('arquivo fresco é usado', (cache.lerDoArquivo() || []).length, 1);
igual('arquivo com mais de 20 min é ignorado', cache.lerDoArquivo(Date.now() + cache.VALIDADE_MS + 1000), null);
const vistos = [];
cache.comoSnap(cache.lerDoArquivo()).forEach(d => vistos.push(d.id + ':' + d.data().email));
igual('tem o mesmo formato que o robô espera do banco', vistos, ['x:a@exemplo.com.br']);
fsT.writeFileSync(cache.ARQUIVO, 'lixo');
igual('arquivo estragado é ignorado', cache.lerDoArquivo(), null);
if (guardado) fsT.writeFileSync(cache.ARQUIVO, guardado); else fsT.unlinkSync(cache.ARQUIVO);

// ---------- resumo da semana ----------
const sem = require('./resumo-semanal');
igual('quinta ainda não é hora do resumo', sem.horaDoResumo(new Date(2026, 8, 17, 18)), false);
igual('sexta às 16h ainda não', sem.horaDoResumo(new Date(2026, 8, 18, 16)), false);
igual('sexta às 17h é', sem.horaDoResumo(new Date(2026, 8, 18, 17)), true);
igual('PC desligado na sexta: sábado e domingo ainda mandam', [sem.horaDoResumo(new Date(2026, 8, 19, 9)), sem.horaDoResumo(new Date(2026, 8, 20, 9))], [true, true]);
igual('segunda já é outra semana', sem.horaDoResumo(new Date(2026, 8, 21, 9)), false);
igual('PC desligado de sexta a domingo: na segunda a semana devida é a ANTERIOR', sem.segundaDaSemana(sem.semanaDevida(new Date(2026, 8, 21, 9))).getDate(), 14);
igual('na sexta às 17h a semana devida é a atual', sem.segundaDaSemana(sem.semanaDevida(new Date(2026, 8, 18, 17))).getDate(), 14);
igual('na quinta ainda se deve a semana anterior', sem.segundaDaSemana(sem.semanaDevida(new Date(2026, 8, 17, 9))).getDate(), 7);
igual('segunda da semana de um domingo é a anterior', sem.segundaDaSemana(new Date(2026, 8, 20, 9)).getDate(), 14);
const textoSem = sem.montarTexto({ de: '14/09/2026', ate: '18/09/2026', mesDosDocumentos: 'agosto de 2026',
  entregas: [{ status: 'confirmada', entregadoPorNome: 'João' }, { status: 'confirmada', entregadoPorNome: 'João' }, { status: 'falha', clienteNome: 'PADARIA EXEMPLO', motivoFalha: 'Fechado' }],
  portais: { total: 5, abriram: ['MERCEARIA EXEMPLO'] }, devendo: [{ nome: 'OFICINA EXEMPLO', faltam: ['extrato', 'aplicacao'] }],
  receita: [{ nome: 'MERCEARIA EXEMPLO', textos: ['Saiu do Simples Nacional'] }], backup: null });
igual('assunto do resumo', textoSem.assunto, 'Resumo da semana: 2 entregas, 1 não realizada, 1 devendo documento');
igual('resumo traz cada bloco', ['- João: 2', '! PADARIA EXEMPLO: Fechado', '1 cliente abriu o link', 'OFICINA EXEMPLO: extrato, aplicação', 'Saiu do Simples Nacional', 'Ainda não há registro de backup']
  .map(p => textoSem.texto.includes(p)), [true, true, true, true, true, true]);

// ---------- entrega pelo link ----------
const elk = require('./entrega-pelo-link');
igual('toque bem formado', elk.lerToque('2026-09-19T12:00:00.000Z|Maria  Souza'), { em: '2026-09-19T12:00:00.000Z', nome: 'Maria Souza' });
igual('toque sem nome ainda vale', elk.lerToque('2026-09-19T12:00:00.000Z|'), { em: '2026-09-19T12:00:00.000Z', nome: '' });
igual('toque com lixo no lugar da data é recusado', elk.lerToque('ontem|Maria'), null);
igual('nome gigante é cortado em 60', elk.lerToque('2026-09-19T12:00:00.000Z|' + 'a'.repeat(200)).nome.length, 60);
igual('entrega esperando no link: confirma', elk.podeConfirmar({ status: 'link' }), true);
igual('entrega da rota não é confirmada por toque', elk.podeConfirmar({ status: 'pendente' }), false);
igual('entrega já confirmada não é mexida de novo', elk.podeConfirmar({ status: 'confirmada' }), false);
const linkDeTeste = { entregas: { lista: [{ id: 'abcdef1', status: 'link' }, { id: 'abcdef2', status: 'confirmada' }] },
  recebido: { abcdef1: '2026-09-19T12:00:00.000Z|Maria', abcdef2: '2026-09-19T12:00:00.000Z|Maria', deOutroLink: '2026-09-19T12:00:00.000Z|X', 'a/b': 'lixo', abcdef9: 'sem data|X' } };
const tri = elk.triar(linkDeTeste);
igual('só o toque de entrega que a EQUIPE pôs no link como "link" vai pra conferência', tri.conferir.map(c => c.id), ['abcdef1']);
igual('o resto é apagado sem ler nada do banco (entrega de fora, já confirmada, lixo)', tri.descartar.sort(), ['a/b', 'abcdef2', 'abcdef9', 'deOutroLink']);
igual('link sem toque nenhum não faz nada', elk.triar({ entregas: { lista: [] } }), { conferir: [], descartar: [] });
igual('hora do toque dentro da janela vale', elk.horaConfiavel('2026-09-19T12:00:00.000Z', '2026-09-18T10:00:00.000Z', '2026-09-19T12:01:00.000Z'), '2026-09-19T12:00:00.000Z');
igual('hora do toque retrodatada vira a hora do robô', elk.horaConfiavel('2020-01-01T00:00:00.000Z', '2026-09-18T10:00:00.000Z', '2026-09-19T12:01:00.000Z'), '2026-09-19T12:01:00.000Z');
igual('hora do toque no futuro vira a hora do robô', elk.horaConfiavel('2030-01-01T00:00:00.000Z', '2026-09-18T10:00:00.000Z', '2026-09-19T12:01:00.000Z'), '2026-09-19T12:01:00.000Z');

// ---------- tipo de documento ----------
igual('títulos pagos = comprovante', r.detectarTipos('TITULOS PAGOS SICOOB AGO2026.pdf'), ['comprovante']);
igual('tit liquidados = comprovante', r.detectarTipos('TIT LIQUIDADOS BBDVCM AGO2026.pdf'), ['comprovante']);
igual('boletos pagos = comprovante', r.detectarTipos('BOLETOS PAGOS BNB AGO2026.pdf'), ['comprovante']);
igual('extrato', r.detectarTipos('EXTRATO SICOOB AGO2026.pdf'), ['extrato']);
igual('aplicação', r.detectarTipos('APLICACAO CDB AGO2026.pdf'), ['aplicacao']);
igual('antecipação de recebíveis não é documento da cobrança', r.detectarTipos('RELATÓRIO DE ANTECIPAÇÃO DE RECEBÍVEIS SICOOB'), []);

// ---------- anexos: assinatura e logo não contam ----------
igual('image001.png é assinatura', r.IMAGEM_DE_ASSINATURA.test('image001.png'), true);
igual('~WRD0000.jpg é assinatura do Word', r.IMAGEM_DE_ASSINATURA.test('~WRD0000.jpg'), true);
igual('Outlook-ab12.png é assinatura', r.IMAGEM_DE_ASSINATURA.test('Outlook-ab12.png'), true);
igual('foto.jpg de cliente não é assinatura', r.IMAGEM_DE_ASSINATURA.test('foto.jpg'), false);
igual('PDF não é assinatura', r.IMAGEM_DE_ASSINATURA.test('EXTRATO.pdf'), false);
const parte = (filename, disp, mime) => ({ filename, mimeType: mime || 'application/pdf', body: { attachmentId: 'x' + filename, size: 10 }, headers: disp ? [{ name: 'Content-Disposition', value: disp }] : [] });
const email = { parts: [
  { mimeType: 'text/plain', body: { size: 3 } },
  parte('LOGO EMPRESAS VOLPONI °.jpeg', 'inline; filename="LOGO.jpeg"', 'image/jpeg'),
  parte('image003.png', 'attachment; filename="image003.png"', 'image/png'),
  parte('EXTRATO SICOOB AGO2026.pdf', 'attachment; filename="EXTRATO.pdf"'),
] };
igual('só o documento de verdade é anexo', r.coletarAnexos(email, []).map(a => a.filename), ['EXTRATO SICOOB AGO2026.pdf']);

// ---------- remetente ----------
igual('noreply é automático', r.AUTOMATICO.test('Banco <noreply@banco.com.br>'), true);
igual('cliente não é automático', r.AUTOMATICO.test('Cássia Volponi <torneariavolponi@hotmail.com>'), false);
igual('e-mail do cabeçalho From', r.extrairEmail('"Cássia Volponi" <TorneariaVolponi@Hotmail.com>'), 'torneariavolponi@hotmail.com');
igual('nome do cabeçalho From', r.extrairNome('"Cássia Volponi" <torneariavolponi@hotmail.com>'), 'Cássia Volponi');
igual('domínio', r.dominioDe('financeiro@volponi.com.br'), 'volponi.com.br');
igual('gmail é domínio público', r.DOMINIOS_PUBLICOS.has('gmail.com'), true);
igual('entidades do trecho do Gmail', r.decodificarEntidades('Olá &#39;teste&#39; &amp; &quot;mais&quot;'), 'Olá \'teste\' & "mais"');

// ---------- filiais no mesmo e-mail ----------
const matriz = { id: 'a', documento: '12.345.678/0001-95' };
const filial = { id: 'b', documento: '12.345.678/0002-76' };
igual('CNPJ da filial no texto decide', (r.desempatarPorDocumento([matriz, filial], 'extrato filial 12.345.678/0002-76 agosto') || {}).id, 'b');
igual('sem CNPJ no texto, não decide', r.desempatarPorDocumento([matriz, filial], 'extrato agosto'), null);
igual('os dois CNPJs no texto, não decide', r.desempatarPorDocumento([matriz, filial], '12345678000195 e 12345678000276'), null);

// ---------- régua de cobrança automática ----------
const rg = require('./regua-cobranca');
igual('dias da régua: texto solto, fora da faixa e repetidos', rg.diasDaRegua('15, 5; 10 5 31 0'), [5, 10, 15]);
igual('dias da régua: lista', rg.diasDaRegua([20, '3']), [3, 20]);
igual('competência anterior na virada do ano', rg.competenciaAnterior(new Date(2027, 0, 5)), '2026-12');
const qui10 = new Date(2026, 8, 10, 10, 0);   // quinta, 10/09
igual('dia marcado, ainda não rodou: roda', rg.diaDeRodar(qui10, [10], ''), true);
igual('já rodou depois do dia marcado: não roda', rg.diaDeRodar(qui10, [10], '2026-09-10'), false);
igual('antes das 9h: espera', rg.diaDeRodar(new Date(2026, 8, 10, 8, 0), [10], ''), false);
igual('dia 5 caiu no sábado: roda na segunda 7', rg.diaDeRodar(new Date(2026, 8, 7, 10, 0), [5], '2026-08-20'), true);
igual('sábado não roda', rg.diaDeRodar(new Date(2026, 8, 5, 10, 0), [5], ''), false);
igual('antes do primeiro dia da régua: não roda', rg.diaDeRodar(new Date(2026, 8, 3, 10, 0), [5, 15], '2026-08-15'), false);
const cli = { id: 'c1', nome: 'PADARIA SAO JORGE LTDA', email: 'Padaria@Exemplo.com', documentosNaoAplicaveis: ['aplicacao'] };
igual('falta só o que se aplica e não chegou', rg.faltandoDo(cli, { extrato: { em: 'x' } }).map(t => t.chave), ['comprovante']);
igual('sem movimento: nada falta', rg.faltandoDo(cli, { semMovimento: true }), []);
const agoraMs = qui10.getTime();
igual('sem e-mail fica de fora', rg.cobrancaDo({ id: 'x', nome: 'X' }, null, {}, '2026-08', agoraMs).pula, 'sem e-mail');
igual('cobrado há 2 dias fica de fora', rg.cobrancaDo(cli, { cobrancas: [{ em: new Date(agoraMs - 2 * 864e5).toISOString(), canal: 'gmail' }] }, {}, '2026-08', agoraMs).pula, 'cobrado há pouco');
const segunda = rg.cobrancaDo(Object.assign({ portalToken: 'tok' }, cli), { cobrancas: [{ em: '2026-09-01T12:00:00Z', canal: 'gmail' }, { em: '2026-09-02T12:00:00Z', canal: 'coleta' }] }, { diaLimite: 15 }, '2026-08', agoraMs);
igual('coleta não conta: vira a 2ª cobrança, com prazo e link', [segunda.n, segunda.para, segunda.assunto, /dia 15\/09/.test(segunda.corpo), /cliente\.html\?portal=tok$/.test(segunda.corpo), segunda.tipos],
  [2, 'padaria@exemplo.com', 'Lembrete: documentos de agosto de 2026 - PADARIA SAO JORGE LTDA', true, true, ['extrato', 'comprovante']]);
igual('modelo do admin vale no lugar do padrão', rg.cobrancaDo(cli, null, { modelos: { '1': { assunto: 'Docs {mes}' } } }, '2026-12', agoraMs).assunto, 'Docs dezembro de 2026');

// ---------- comprovante de entrega por e-mail ----------
const ce = require('./comprovante-email');
const agoraCe = Date.parse('2026-09-19T15:00:00Z');
igual('entrega confirmada agora pede comprovante', ce.precisaDeComprovante({ status: 'confirmada', confirmadoEm: '2026-09-19T14:00:00Z' }, agoraCe), true);
igual('pelo link não pede', ce.precisaDeComprovante({ status: 'confirmada', recebidoPeloLink: true, confirmadoEm: '2026-09-19T14:00:00Z' }, agoraCe), false);
igual('já mandado não pede de novo', ce.precisaDeComprovante({ status: 'confirmada', comprovanteEmail: { em: 'x' }, confirmadoEm: '2026-09-19T14:00:00Z' }, agoraCe), false);
igual('de anteontem não pede', ce.precisaDeComprovante({ status: 'confirmada', confirmadoEm: '2026-09-17T14:00:00Z' }, agoraCe), false);
igual('não entregue não pede', ce.precisaDeComprovante({ status: 'falha', confirmadoEm: '2026-09-19T14:00:00Z' }, agoraCe), false);
const comp = ce.textoDoComprovante({ nome: 'PADARIA', portalToken: 'tok' }, [
  { itens: [{ tipo: 'DAS', valor: 1240.5 }], competencia: '2026-08', vencimento: '2026-09-22', recebedor: 'Maria', confirmadoEm: '2026-09-19T13:00:00Z' },
  { itens: [{ tipo: 'Guia INSS', valor: null }], competencia: '2026-08', recebedor: 'Maria', confirmadoEm: '2026-09-19T13:01:00Z' }], 'Escritório');
igual('comprovante de duas guias num e-mail só', [comp.assunto, /- DAS R\$ 1\.240,50 \(agosto de 2026, vence 22\/09\/2026\)/.test(comp.corpo), /Recebido por Maria em /.test(comp.corpo), /\?portal=tok/.test(comp.corpo), /Escritório$/.test(comp.corpo)],
  ['Entrega registrada: 2 documentos', true, true, true, true]);
igual('assunto de uma guia só', ce.textoDoComprovante({ nome: 'X' }, [{ itens: [{ tipo: 'DAS', valor: 50 }], competencia: '2026-08', confirmadoEm: '2026-09-19T13:00:00Z' }]).assunto, 'Entrega registrada: DAS R$ 50,00');

// ---------- documento enviado pelo link do cliente ----------
const ep = require('./envios-do-portal');
const pdf = Buffer.from('%PDF-1.4\n%fim');
igual('PDF pelos primeiros bytes', ep.tipoReal(pdf), 'pdf');
igual('JPEG pelos primeiros bytes', ep.tipoReal(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0])), 'jpg');
igual('texto com nome de .pdf não passa', ep.tipoReal(Buffer.from('<html>oi</html>')), '');
const envioOk = { competencia: '2026-08', tipo: 'extrato', nome: 'C:\\fakepath\\extrato: agosto?.PDF', dados: pdf.toString('base64') };
igual('envio certo passa', [ep.conferirEnvio(envioOk).ext, !!ep.conferirEnvio(envioOk).buffer], ['pdf', true]);
igual('mês inválido não passa', ep.conferirEnvio(Object.assign({}, envioOk, { competencia: '2026-13' })).erro, 'competência inválida');
igual('tipo fora da lista não passa', ep.conferirEnvio(Object.assign({}, envioOk, { tipo: 'contrato' })).erro, 'tipo de documento inválido');
igual('arquivo disfarçado não passa', ep.conferirEnvio(Object.assign({}, envioOk, { dados: Buffer.from('MZ executável').toString('base64') })).erro, 'não é PDF nem foto');
igual('nome no Drive sem caminho nem caractere proibido', ep.nomeNoDrive(envioOk, 'pdf', new Date(2026, 8, 19)), 'Pelo link 2026-09-19 - Extrato - extrato agosto.pdf');

// ---------- bancos dos extratos ----------
const bk = require('./bancos');
igual('BB pelo cabeçalho', bk.bancosDoTexto('BANCO DO BRASIL S.A.\nSISBB - Sistema de Informações\nExtrato de conta corrente'), ['bb']);
igual('Sicoob (Bancoob) pelo cabeçalho', bk.bancosDoTexto('SICOOB CREDINOR\nCooperativa de Crédito\nExtrato'), ['sicoob']);
igual('banco citado no meio do extrato não conta', bk.bancosDoTexto('SICREDI Extrato\n' + 'x'.repeat(2000) + ' TED para BANCO DO BRASIL'), ['sicredi']);

// Cabeçalhos de verdade, dos extratos que o escritório recebe. Só o pedaço
// que identifica a instituição: sem nome de cliente, CNPJ, conta ou valor.
// Dois destes NÃO eram reconhecidos — o banco não escreve o próprio nome.
const miolo = ' PIX RECEBIDO REM: FULANO 03/08 1743583 1.400,00 '.repeat(60);
igual('BB: o extrato não diz "Banco do Brasil" em lugar nenhum',
  bk.bancosDoTexto('Extrato Mensal / Por Período\n\nFolha 1/4\n\nAgência | Conta Total Disponível (R$)\n' + miolo + '\nSaldos Invest Fácil / Plus'), ['bb']);
igual('BB consolidado, mesmo caso',
  bk.bancosDoTexto('Extrato Consolidado / Por Período\n\nFolha 1/5\n' + miolo), ['bb']);
igual('BNB: o nome só aparece no fundo automático do saldo',
  bk.bancosDoTexto('Extrato de Conta Corrente - no período\n\nAgência/Conta Corrente: 060 - SALINAS\n\nDetalhamento do Saldo\nInvestimentos BNB AUTOMATICO FIF (*)'), ['bnb']);
igual('Sicoob do internet banking',
  bk.bancosDoTexto('Sicoob | Internet banking\n\nEXTRATO DE CONTA CORRENTE 01/09/2026\n\nCooperativa: 3144-5 / SICOOB CREDINOR'), ['sicoob']);
igual('Stone diz a instituição no alto',
  bk.bancosDoTexto('Extrato de conta corrente Emitido em 14 setembro 2026\n\nDados da conta\n\nInstituição Stone Instituição de Pagamento S.A.'), ['stone']);
// O Nubank só assina no rodapé; num extrato com movimento isso fica longe do topo.
igual('Nubank assina no rodapé',
  bk.bancosDoTexto('01 DE AGOSTO DE 2026 a 31 DE AGOSTO DE 2026 VALORES EM R$\nSaldo final do período\n' + miolo +
    '\nNu Financeira S.A. - Sociedade de Credito, Financiamento e Investimento\nNu Pagamentos S.A. - Instituição de Pagamento'), ['nubank']);
// e a assinatura no rodapé não pode abrir a porta pra nome de banco no miolo
igual('assinatura no rodapé não vale pra nome solto no fim',
  bk.bancosDoTexto('Sicoob | Internet banking\n' + miolo + '\nPIX ENVIADO DES: BANCO DO BRASIL'), ['sicoob']);
igual('Nu Pagamentos', bk.bancosDoTexto('Nu Pagamentos S.A. - Instituição de Pagamento\nExtrato'), ['nubank']);
igual('vários PDFs, cada um o seu', bk.bancosDosTextos(['Banco do Nordeste do Brasil', 'CAIXA ECONOMICA FEDERAL']).sort(), ['bnb', 'caixa']);
igual('texto sem banco', bk.bancosDoTexto('Extrato mensal'), []);
igual('banco novo pro cadastro, sem o que o admin recusou', r.bancosNovos({ bancos: ['bb'], bancosRecusados: ['itau'] }, ['bb', 'itau', 'sicoob']), ['sicoob']);

// ---------- cobrança em HTML ----------
const eh = require('./email-html');
const visual = eh.htmlDaCobranca({
  corpo: 'Olá,\n\nFaltam:\n\n- Extrato Bancário\n- Comprovante\n\nVeja aqui:\nhttps://x.github.io/cliente.html?portal=t\n\nObrigado,\nNilma',
  cliente: { bancos: ['bb', 'sicoob', 'inexistente'], documentosNaoAplicaveis: ['aplicacao'] }, competencia: '2026-08', bancosRecebidos: ['bb'],
  diaLimite: 15, assinatura: 'Nilma <Contabilidade>', agora: new Date(2026, 8, 19),
});
// Dois bancos e dois documentos exigidos = quatro coisas; só o extrato do BB
// chegou. O campo antigo (bancosRecebidos) continua valendo como extrato.
igual('HTML: manchete, mês, bancos, botão, prazo vencido e texto escapado', [
  /Faltam 3 documentos de agosto/.test(visual.html), />AGO 2026</.test(visual.html), /1 de 4 já chegaram/.test(visual.html),
  /Banco do Brasil[\s\S]*?Recebido/.test(visual.html), /Sicoob[\s\S]*?Falta/.test(visual.html), /inexistente/.test(visual.html),
  /href="https:\/\/x\.github\.io\/cliente\.html\?portal=t"/.test(visual.html), /Veja aqui:/.test(visual.html),
  /O prazo era 15\/09 \(há 4 dias\)/.test(visual.html), /Nilma &lt;Contabilidade&gt;/.test(visual.html),
], [true, true, true, true, true, false, true, false, true, true]);
igual('HTML: logos e ícones anexados por cid, uma vez cada', [visual.imagens.some(i => i.cid === 'banco-bb'), visual.imagens.some(i => i.cid === 'icone-extrato'),
  new Set(visual.imagens.map(i => i.cid)).size === visual.imagens.length], [true, true, true]);
// Agora cada documento é por banco: o comprovante também nomeia o banco.
const visual2 = eh.htmlDaCobranca({
  corpo: 'Olá,\n\nFaltam:\n\n- Extrato Bancário\n- Comprovante\n\nObrigado,\nNilma',
  cliente: { bancos: ['bb', 'sicoob'], documentosNaoAplicaveis: ['aplicacao'] }, competencia: '2026-08',
  bancosPorTipo: { extrato: ['bb', 'sicoob'], comprovante: ['bb'] },
  diaLimite: 15, assinatura: 'Nilma', agora: new Date(2026, 8, 19),
});
igual('HTML: o comprovante também conta por banco', [
  /3 de 4 já chegaram/.test(visual2.html),
  (visual2.html.match(/Sicoob/g) || []).length === 2,
  /Falta 1 banco/.test(visual2.html),
], [true, true, true]);

igual('prazo: no futuro', eh.textoDoPrazo('2026-08', 22, new Date(2026, 8, 19)).texto, 'Prazo: até 22/09 (faltam 3 dias)');
igual('prazo: sem dia limite não aparece', eh.textoDoPrazo('2026-08', null), null);

// ---------- lembretes do escritório ----------
const lb = require('./lembretes');
const semFeriado = new Set();
const comFeriado = new Set(['2026-09-07']);
igual('dia útil comum', lb.ehDiaUtil(new Date(2026, 8, 10), semFeriado), true);
igual('sábado não é dia útil', lb.ehDiaUtil(new Date(2026, 8, 5), semFeriado), false);
igual('feriado não é dia útil', lb.ehDiaUtil(new Date(2026, 8, 7), comFeriado), false);
igual('dia 10 (quinta) sai no próprio dia', lb.diaDoAviso(2026, 8, 10, semFeriado), '2026-09-10');
igual('dia 5 (sábado) escorrega pra segunda', lb.diaDoAviso(2026, 8, 5, semFeriado), '2026-09-07');
igual('dia 5 com a segunda feriado vai pra terça', lb.diaDoAviso(2026, 8, 5, comFeriado), '2026-09-08');
const lembretes = [{ texto: 'GFIP', dia: 5, quem: 'contabil' }, { texto: 'Boletos', dia: 25 }, { texto: 'sem dia' }];
igual('só o que cai hoje', lb.lembretesDeHoje(lembretes, new Date(2026, 8, 7), semFeriado).map(l => l.texto), ['GFIP']);
igual('dia sem lembrete devolve vazio', lb.lembretesDeHoje(lembretes, new Date(2026, 8, 10), semFeriado), []);

// ---------- recado da página do cliente ----------
const pp = require('./pedidos-do-portal');
const solic = pp.solicitacaoDoPedido(
  { assunto: 'segunda-via', texto: 'Perdi a guia do DAS de agosto' },
  { id: 'c1', nome: 'PADARIA SAO JORGE LTDA', nomeFantasia: 'Padaria São Jorge' },
  new Date('2026-09-20T12:00:00Z'));
igual('recado vira solicitação com nome e texto', [solic.tipo, solic.status, solic.clienteId, solic.descricao],
  ['documento', 'pendente', 'c1', 'Segunda via de guia — Padaria São Jorge: Perdi a guia do DAS de agosto']);
igual('assunto desconhecido cai em "outro"', pp.solicitacaoDoPedido({ assunto: 'xxx', texto: 'oi' }, { nome: 'X' }).tipo, 'outro');
igual('texto comprido é cortado em 400', pp.solicitacaoDoPedido({ assunto: 'duvida', texto: 'a'.repeat(500) }, { nome: 'X' }).descricao.length,
  'Dúvida do cliente — X: '.length + 400);

// ---------- certidão, procuração e certificado vencendo ----------
const pv = require('./papeis-vencendo');
const hojePv = new Date(2026, 8, 20);            // 20/09/2026
igual('dias até uma data futura', pv.diasAte('2026-10-05', hojePv), 15);
igual('data passada dá negativo', pv.diasAte('2026-09-18', hojePv), -2);
igual('data inválida não conta', pv.diasAte('', hojePv), null);
const clientesPv = [
  { nome: 'PADARIA', papeis: [{ tipo: 'certificado', vence: '2026-10-20' }, { tipo: 'cnd-federal', vence: '2026-10-05' }, { tipo: 'outro', vence: '2026-09-25' }] },
  { nome: 'MERCEARIA', papeis: [{ tipo: 'procuracao', vence: '2026-09-19' }] },
  { nome: 'INATIVO', ativo: false, papeis: [{ tipo: 'fgts', vence: '2026-09-23' }] },
  { nome: 'SEM PAPEL' }
];
const avisar = pv.papeisParaAvisar(clientesPv, hojePv);
igual('avisa só nos marcos (30, 15, 3) e no dia seguinte ao vencimento',
  avisar.map(x => x.nome + '/' + x.dias), ['Procuração eletrônica/-1', 'CND Federal/15', 'Certificado digital/30']);
igual('cliente inativo fica de fora', avisar.some(x => x.cliente === 'INATIVO'), false);
igual('dia sem marco não avisa nada', pv.papeisParaAvisar(clientesPv, new Date(2026, 8, 21)), []);
igual('texto de um documento só', pv.textoDoAviso([{ nome: 'CND Federal', cliente: 'PADARIA', dias: 15 }]),
  { titulo: 'Documento vencendo', corpo: 'CND Federal de PADARIA vence em 15 dias' });
igual('texto de vários', pv.textoDoAviso(avisar).titulo, '3 documentos vencendo');

// ---------- planilha do backup: separar código do nome ----------
const bp = require('./backup-planilha');
igual('código colado no nome', bp.separarCodigo('207 - BMJ SOM AUTOMOTIVO LTDA'), { codigo: '207', nome: 'BMJ SOM AUTOMOTIVO LTDA' });
igual('sem código no nome, usa o solto', bp.separarCodigo('GAS TAIOBEIRAS LTDA', '600'), { codigo: '600', nome: 'GAS TAIOBEIRAS LTDA' });
igual('sem código nenhum', bp.separarCodigo('ALVES CRUZ ACADEMIA'), { codigo: '', nome: 'ALVES CRUZ ACADEMIA' });
igual('nome que começa com número mas não é código (sem traço)', bp.separarCodigo('2894'), { codigo: '', nome: '2894' });

const clientesJson = {
  a: { dados: { nome: '207 - BMJ SOM AUTOMOTIVO LTDA', ativo: true, entrega: true, documento: '12.673.416/0001-50', receita: { situacao: 'ATIVA', simples: true } } },
  b: { dados: { nome: 'ALVES CRUZ ACADEMIA', codigoOrigem: '600', ativo: false } },
};
const abaClientes = bp.montarAba_Clientes(clientesJson);
igual('aba de clientes vem ordenada por nome', abaClientes.map(l => l['Cliente']), ['ALVES CRUZ ACADEMIA', 'BMJ SOM AUTOMOTIVO LTDA']);
igual('código separado do nome na planilha', abaClientes[1]['Código'], '207');
igual('inativo aparece como Não', abaClientes[0]['Ativo'], 'Não');

const entregasJson = {
  x: { dados: { clienteNome: '10 - PADARIA', criadoEm: '2026-09-10T10:00:00Z', itens: [{ tipo: 'DAS', valor: 100.5 }, { tipo: 'FGTS', valor: 20 }], status: 'confirmada' } },
  y: { dados: { clienteNome: '5 - ACADEMIA', criadoEm: '2026-09-09T10:00:00Z', itens: [{ tipo: 'Honorário', valor: null }], status: 'pendente' } },
};
const abaEntregas = bp.montarAba_Entregas(entregasJson);
igual('entregas ordenadas por cliente', abaEntregas.map(l => l['Cliente']), ['ACADEMIA', 'PADARIA']);
igual('soma o valor dos itens', abaEntregas[1]['Valor total'], 120.5);
igual('item sem valor não quebra a soma', abaEntregas[0]['Valor total'], '');
igual('itens viram texto legível', abaEntregas[1]['Itens'], 'DAS (R$ 100,50), FGTS (R$ 20,00)');

console.log(falhas ? '\n' + falhas + ' de ' + total + ' testes FALHARAM' : total + ' testes, todos passaram');
process.exit(falhas ? 1 : 0);
