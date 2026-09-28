// Ações que a IA PREPARA e a pessoa confirma na tela (pedido do escritório,
// 28/09/2026: "quero que a IA possa montar rota e essas coisas").
//
// A IA nunca grava: a ferramenta daqui só confere o pedido no banco (cliente
// certo, documentos conhecidos, mês, região, se já está na rota) e devolve
// uma PROPOSTA. O atendente (atendente-claude.js) anexa a proposta à resposta
// (conversasIA/{id}/mensagens/{msg}.acoes) e a tela mostra um cartão com o
// botão de confirmar. Quem grava é a tela, com o login de quem confirmou e as
// mesmas regras do banco da tela de Rota (nilma-acoes-ia.js).
//
// Ação de hoje: 'rota' — colocar documentos na rota de entregas.
const { competenciaAtual, competenciaValida, normalizar } = require('./ia-consultas');

// Os mesmos documentos da tela de Nova entrega (DOC_TIPOS do entregas.html).
// Documento fora da lista entra com o nome que a pessoa falou (a tela também
// aceita "Outro").
const DOC_TIPOS = [
  { key: 'das', label: 'DAS' },
  { key: 'icms_antecipado', label: 'ICMS Antec.', sinonimos: ['icms antecipado'] },
  { key: 'icms_difal', label: 'ICMS Dif. Alíq.', sinonimos: ['icms difal', 'difal', 'diferencial de aliquota'] },
  { key: 'icms_st', label: 'ICMS ST', sinonimos: ['st', 'substituicao tributaria'] },
  { key: 'fgts', label: 'FGTS' },
  { key: 'darf', label: 'DARF' },
  { key: 'dae', label: 'DAE' },
  { key: 'honorario', label: 'Honorário', semValor: true, sinonimos: ['honorarios'] },
  { key: 'notas', label: 'Notas', semValor: true, sinonimos: ['nota', 'notas fiscais', 'nota fiscal'] },
  { key: 'boleto', label: 'Boleto' },
  { key: 'ccir', label: 'CCIR', semValor: true },
  { key: 'multa_rescisoria', label: 'Multa Rescisória', sinonimos: ['multa rescisoria', 'multa'] },
  { key: 'ferias', label: 'Férias' },
  { key: 'folha_pagamento', label: 'Folha de Pagamento', semValor: true, sinonimos: ['folha'] },
  { key: 'prolabore', label: 'Prólabore', semValor: true, sinonimos: ['pro labore', 'pro-labore'] },
  { key: 'esocial', label: 'eSocial', semValor: true },
];
const ZONAS = { superior: 'Parte superior', central: 'Central', inferior: 'Parte inferior' };
const MAX_ENTREGAS = 30;

function simples(texto) { return normalizar(texto).replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function tipoDoDocumento(texto) {
  const alvo = simples(texto);
  if (!alvo) return null;
  const achou = DOC_TIPOS.find(t => simples(t.label) === alvo || t.key.replace(/_/g, ' ') === alvo
    || (t.sinonimos || []).some(s => simples(s) === alvo));
  return achou ? { tipo: achou.label, semValor: !!achou.semValor } : { tipo: String(texto).trim(), semValor: false, outro: true };
}

function valorEmReais(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) / 100 : null;
  const s = String(v).replace(/[R$\s]/g, '');
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''));
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Igual ao clienteLabel() da tela.
function rotuloCliente(c) { return (c.codigoOrigem ? c.codigoOrigem + ' - ' : '') + (c.nome || ''); }

// Acha UM cliente pelo id, pelo código do escritório ou pelo nome.
// Mais de um candidato: devolve os nomes pra IA perguntar qual.
function acharCliente(clientes, termo) {
  const t = String(termo == null ? '' : termo).trim();
  if (!t) return { erro: 'faltou o cliente' };
  const porId = clientes.find(c => c.id === t);
  if (porId) return { cliente: porId };
  const cod = t.replace(/\s*-.*$/, '');
  const porCodigo = clientes.filter(c => c.codigoOrigem != null && String(c.codigoOrigem) === cod);
  if (porCodigo.length === 1) return { cliente: porCodigo[0] };
  const alvo = normalizar(t.replace(/^\d+\s*-\s*/, ''));
  const nomes = c => [c.nome, c.nomeFantasia].filter(Boolean).map(normalizar);
  const exatos = clientes.filter(c => nomes(c).some(n => n === alvo));
  if (exatos.length === 1) return { cliente: exatos[0] };
  const contem = clientes.filter(c => nomes(c).some(n => n.indexOf(alvo) !== -1));
  if (contem.length === 1) return { cliente: contem[0] };
  // Palavras espalhadas entre razão social e nome fantasia ("ACE Taiobeiras"
  // = fantasia ACE + razão "... DE TAIOBEIRAS"): cada palavra tem que ser
  // palavra inteira de um dos dois. Entre vários, fica quem tem alguma
  // palavra igual ao nome fantasia inteiro.
  const palavras = alvo.split(/\s+/).filter(w => w.length > 1 && !/^(de|da|do|das|dos|e|ltda|me)$/.test(w));
  if (palavras.length > 1) {
    const todas = clientes.filter(c => {
      const ws = new Set(nomes(c).join(' ').split(/[^a-z0-9]+/));
      return palavras.every(w => ws.has(w));
    });
    if (todas.length === 1) return { cliente: todas[0] };
    const pelaFantasia = todas.filter(c => c.nomeFantasia && palavras.indexOf(normalizar(c.nomeFantasia)) !== -1);
    if (pelaFantasia.length === 1) return { cliente: pelaFantasia[0] };
    if (todas.length) return { erro: 'mais de um cliente com "' + t + '"', candidatos: todas.slice(0, 8).map(rotuloCliente) };
    // Nome no cadastro cortado ("ASSOCIAÇÃO COMERCIAL E EMPRESARIAL DE",
    // fantasia "ACE"): uma das palavras é o nome fantasia inteiro de UM
    // cliente só. O cartão mostra o nome pra pessoa conferir.
    const soFantasia = clientes.filter(c => c.nomeFantasia && palavras.indexOf(normalizar(c.nomeFantasia)) !== -1);
    if (soFantasia.length === 1) return { cliente: soFantasia[0] };
  }
  if (!contem.length) return { erro: 'nenhum cliente ativo com "' + t + '"' };
  return { erro: 'mais de um cliente com "' + t + '"', candidatos: contem.slice(0, 8).map(rotuloCliente) };
}

// A proposta, sem banco (testável). clientes = ativos [{id, nome, codigoOrigem, zona, ...}];
// naRota = entregas com status 'pendente' [{clienteId, competencia, itens}].
function prepararRota(clientes, naRota, args, agora) {
  const pedidos = Array.isArray(args && args.entregas) ? args.entregas.slice(0, MAX_ENTREGAS) : [];
  if (!pedidos.length) return { erro: 'diga pelo menos um cliente e os documentos' };
  const entregas = [], problemas = [];
  pedidos.forEach((p, i) => {
    const r = acharCliente(clientes, p && p.cliente);
    if (r.erro) {
      problemas.push(Object.assign({ item: i + 1, pedido: String((p && p.cliente) || ''), problema: r.erro }, r.candidatos ? { candidatos: r.candidatos } : {}));
      return;
    }
    const c = r.cliente;
    const docs = (Array.isArray(p.documentos) ? p.documentos : []).map(d => (typeof d === 'string' ? { tipo: d } : (d || {})));
    const itens = [], avisos = [];
    docs.forEach(d => {
      const t = tipoDoDocumento(d.tipo);
      if (!t) return;
      itens.push({ tipo: t.tipo, valor: t.semValor ? null : valorEmReais(d.valor) });
      if (t.outro) avisos.push('"' + t.tipo + '" não é um documento da lista: entra com esse nome');
    });
    if (!itens.length) { problemas.push({ item: i + 1, pedido: rotuloCliente(c), problema: 'faltaram os documentos' }); return; }
    const competencia = p.competencia ? String(p.competencia).trim() : competenciaAtual(agora);
    if (!competenciaValida(competencia)) { problemas.push({ item: i + 1, pedido: rotuloCliente(c), problema: 'mês inválido (use AAAA-MM): ' + competencia }); return; }
    const vencimento = /^\d{4}-\d{2}-\d{2}$/.test(String(p.vencimento || '')) ? String(p.vencimento) : '';
    const zonaPedida = normalizar(p.zona || '');
    const zona = ZONAS[zonaPedida] ? zonaPedida
      : (Object.keys(ZONAS).find(z => zonaPedida && normalizar(ZONAS[z]).indexOf(zonaPedida) !== -1) || c.zona || '');
    if (!zona) avisos.push('cliente sem região da rota');
    const jaNaRota = naRota.filter(e => e.clienteId === c.id && e.competencia === competencia)
      .reduce((l, e) => l.concat((e.itens || []).map(x => x.tipo)), []);
    const repetidos = itens.filter(x => jaNaRota.indexOf(x.tipo) !== -1).map(x => x.tipo);
    if (repetidos.length) avisos.push('já está na rota neste mês: ' + repetidos.join(', '));
    entregas.push({
      clienteId: c.id, clienteNome: rotuloCliente(c), competencia, vencimento, zona,
      zonaNome: ZONAS[zona] || '', itens, observacao: String(p.observacao || '').slice(0, 300), avisos,
    });
  });
  if (!entregas.length) return { erro: 'não deu pra preparar nenhuma entrega', problemas };
  return {
    acao: 'rota',
    titulo: entregas.length === 1 ? 'Colocar na rota: ' + entregas[0].clienteNome : 'Colocar ' + entregas.length + ' clientes na rota',
    entregas,
    problemas,
    aviso_para_a_ia: 'NADA foi gravado ainda. Diga em uma frase o que preparou (e os problemas, se houver) e que a pessoa confirma no cartão "Colocar na rota" logo abaixo da resposta. Não diga que já colocou.',
  };
}

const FERRAMENTAS_ACOES = [
  {
    name: 'preparar_rota',
    description: 'Prepara a colocação de documentos na ROTA DE ENTREGAS (o que o entregador leva ao cliente). NÃO grava: devolve uma proposta que a pessoa confirma num cartão na tela. Use quando pedirem para pôr, colocar, montar ou adicionar clientes/documentos na rota. Um item por cliente. Se o cliente for ambíguo, a resposta traz candidatos: pergunte qual.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        entregas: {
          type: 'array',
          description: 'Uma entrega por cliente.',
          items: {
            type: 'object',
            properties: {
              cliente: { type: 'string', description: 'Nome, código do escritório (ex.: "0123") ou id do cliente.' },
              documentos: {
                type: 'array',
                description: 'Documentos a entregar. Tipos conhecidos: DAS, ICMS Antec., ICMS Dif. Alíq., ICMS ST, FGTS, DARF, DAE, Honorário, Notas, Boleto, CCIR, Multa Rescisória, Férias, Folha de Pagamento, Prólabore, eSocial.',
                items: { type: 'object', properties: { tipo: { type: 'string' }, valor: { type: 'number', description: 'Valor em reais, se a pessoa disse.' } }, required: ['tipo'] },
              },
              competencia: { type: 'string', description: 'Mês de referência AAAA-MM. Sem isso, o mês atual.' },
              vencimento: { type: 'string', description: 'Vencimento AAAA-MM-DD, se a pessoa disse.' },
              zona: { type: 'string', description: 'Região da rota: superior, central ou inferior. Sem isso, a do cadastro.' },
              observacao: { type: 'string' },
            },
            required: ['cliente', 'documentos'],
          },
        },
      },
      required: ['entregas'],
    },
  },
];
const NOMES_ACOES = new Set(FERRAMENTAS_ACOES.map(f => f.name));

async function executarAcao(db, nome, args, agora) {
  if (nome !== 'preparar_rota') return { erro: 'ação desconhecida: ' + nome };
  const [snapClientes, snapRota] = await Promise.all([
    db.collection('clientes').where('ativo', '==', true).get(),
    db.collection('entregas').where('status', '==', 'pendente').get(),
  ]);
  const clientes = snapClientes.docs.map(d => Object.assign({ id: d.id }, d.data()));
  const naRota = snapRota.docs.map(d => d.data());
  return prepararRota(clientes, naRota, args || {}, agora);
}

module.exports = { FERRAMENTAS_ACOES, NOMES_ACOES, executarAcao, prepararRota, acharCliente, tipoDoDocumento, valorEmReais, DOC_TIPOS };
