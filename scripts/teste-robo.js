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
igual('primeira conferência de cliente inapto avisa', cnpj.avisosDaPrimeiraVez(r2).length, 1);

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

console.log(falhas ? '\n' + falhas + ' de ' + total + ' testes FALHARAM' : total + ' testes, todos passaram');
process.exit(falhas ? 1 : 0);
