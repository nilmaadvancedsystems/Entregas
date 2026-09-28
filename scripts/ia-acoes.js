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
// Ações:
//   'rota'      — colocar documentos na rota de entregas (preparar_rota);
//   'documento' — marcar extrato/comprovante/aplicação como recebido na
//                 Pendências (preparar_documento_recebido);
//   'tarefa'    — criar tarefa ou requisição no módulo Tarefas (preparar_tarefa).
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

// Data AAAA-MM-DD, aceitando também DD/MM/AAAA (é como vem numa guia).
function dataIso(v) {
  const t = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : '';
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
    const vencimento = dataIso(p.vencimento);
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

// ---------- documento recebido (Pendências) ----------
const TIPOS_RECEBIDO = [
  { chave: 'extrato', rotulo: 'Extrato bancário', sinonimos: ['extrato', 'extratos', 'extrato bancario', 'extratos bancarios'] },
  { chave: 'comprovante', rotulo: 'Comprovantes de pagamento', sinonimos: ['comprovante', 'comprovantes', 'comprovantes de pagamento', 'comprovante de pagamento'] },
  { chave: 'aplicacao', rotulo: 'Extrato de aplicação', sinonimos: ['aplicacao', 'aplicacoes', 'extrato de aplicacao', 'investimento', 'investimentos'] },
];
function tipoRecebido(texto) {
  const alvo = simples(texto);
  return TIPOS_RECEBIDO.find(t => t.chave === alvo || t.sinonimos.some(x => simples(x) === alvo)) || null;
}
// Banco pelo id, sigla ou nome (lista do robô, bancos.js); só entre os do cliente, se ele tiver.
function acharBanco(bancos, texto, doCliente) {
  const alvo = simples(texto);
  if (!alvo) return null;
  const lista = doCliente && doCliente.length ? bancos.filter(b => doCliente.indexOf(b.id) !== -1) : bancos;
  return lista.find(b => b.id === alvo || simples(b.sigla) === alvo || simples(b.nome) === alvo)
    || lista.find(b => simples(b.nome).indexOf(alvo) !== -1) || null;
}

// clientes ativos; docs = { 'clienteId_AAAA-MM': documentosMensal }; bancos = BANCOS do bancos.js.
// A regra da pendência é a da Pendências (bancosFaltando): tipo marcado sem
// banco nenhum conta como recebido; com parte dos bancos já recebida, falta
// o resto — aí sem dizer o banco a marcação não adiantaria, e a IA pergunta.
function prepararDocumento(clientes, docs, bancos, args, agora) {
  const pedidos = Array.isArray(args && args.marcacoes) ? args.marcacoes.slice(0, MAX_ENTREGAS) : [];
  if (!pedidos.length) return { erro: 'diga o cliente e o documento' };
  const marcacoes = [], problemas = [];
  const nomeBanco = id => (bancos.find(b => b.id === id) || {}).nome || id;
  pedidos.forEach((p, i) => {
    const r = acharCliente(clientes, p && p.cliente);
    if (r.erro) { problemas.push(Object.assign({ item: i + 1, pedido: String((p && p.cliente) || ''), problema: r.erro }, r.candidatos ? { candidatos: r.candidatos } : {})); return; }
    const c = r.cliente;
    const t = tipoRecebido(p.tipo || 'extrato');
    if (!t) { problemas.push({ item: i + 1, pedido: rotuloCliente(c), problema: 'documento desconhecido: ' + p.tipo + ' (extrato, comprovante ou aplicação)' }); return; }
    const competencia = p.competencia ? String(p.competencia).trim() : competenciaAtual(agora);
    if (!competenciaValida(competencia)) { problemas.push({ item: i + 1, pedido: rotuloCliente(c), problema: 'mês inválido (use AAAA-MM): ' + competencia }); return; }
    const d = docs[c.id + '_' + competencia] || {};
    const doCliente = Array.isArray(c.bancos) ? c.bancos : [];
    const chegaram = (d.bancosPorTipo && Array.isArray(d.bancosPorTipo[t.chave])) ? d.bancosPorTipo[t.chave]
      : (t.chave === 'extrato' && Array.isArray(d.bancosRecebidos) ? d.bancosRecebidos : []);
    let banco = null;
    if (p.banco) {
      banco = acharBanco(bancos, p.banco, doCliente);
      if (!banco) { problemas.push({ item: i + 1, pedido: rotuloCliente(c), problema: 'banco "' + p.banco + '" não é um dos bancos do cliente' + (doCliente.length ? ' (' + doCliente.map(nomeBanco).join(', ') + ')' : '') }); return; }
    }
    const avisos = [];
    const faltam = doCliente.filter(b => chegaram.indexOf(b) === -1 && (!banco || b !== banco.id));
    if (banco && chegaram.indexOf(banco.id) !== -1) avisos.push('já estava marcado para ' + banco.nome);
    else if (!banco && d[t.chave]) avisos.push('já estava marcado como recebido');
    if (!banco && chegaram.length && faltam.length) {
      problemas.push({ item: i + 1, pedido: rotuloCliente(c), problema: 'já chegou de ' + chegaram.map(nomeBanco).join(', ') + '; faltam ' + faltam.map(nomeBanco).join(', ') + ': diga de qual banco', bancosQueFaltam: faltam.map(nomeBanco) });
      return;
    }
    if (d.semMovimento) avisos.push('o mês está marcado como sem movimento');
    marcacoes.push({
      clienteId: c.id, clienteNome: rotuloCliente(c), clienteNomeCadastro: c.nome || '', competencia,
      tipo: t.chave, tipoNome: t.rotulo, bancoId: banco ? banco.id : '', bancoNome: banco ? banco.nome : '', avisos,
    });
  });
  if (!marcacoes.length) return { erro: 'não deu pra preparar nenhuma marcação', problemas };
  return {
    acao: 'documento',
    titulo: marcacoes.length === 1 ? 'Marcar como recebido: ' + marcacoes[0].clienteNome : 'Marcar ' + marcacoes.length + ' documentos como recebidos',
    marcacoes, problemas,
    aviso_para_a_ia: 'NADA foi gravado ainda. Diga em uma frase o que preparou (e os problemas, se houver) e que a pessoa confirma no cartão logo abaixo da resposta. Não diga que já marcou.',
  };
}

// ---------- tarefa (módulo Tarefas) ----------
const PRIORIDADES = ['urgente', 'alta', 'normal', 'baixa'];
function acharPessoa(equipe, texto) {
  const alvo = normalizar(texto);
  if (!alvo) return null;
  const exatos = equipe.filter(p => normalizar(p.nome) === alvo);
  if (exatos.length === 1) return exatos[0];
  const parecidos = equipe.filter(p => normalizar(p.nome).indexOf(alvo) === 0 || normalizar(p.nome).split(/[\s.]+/).indexOf(alvo) !== -1);
  return parecidos.length === 1 ? parecidos[0] : null;
}
// equipe = [{uid, nome}] (usuarios com papel e ativos). Os campos são os do
// criar() do tarefas.html; o que fica em branco a tela completa ao confirmar.
function prepararTarefa(clientes, equipe, args, agora) {
  const pedidos = Array.isArray(args && args.tarefas) ? args.tarefas.slice(0, 20) : [];
  if (!pedidos.length) return { erro: 'diga o que é a tarefa' };
  const tarefas = [], problemas = [];
  const d0 = agora ? new Date(agora) : new Date();
  const hoje = competenciaAtual(d0) + '-' + String(d0.getDate()).padStart(2, '0');
  pedidos.forEach((p, i) => {
    const titulo = String((p && p.titulo) || '').trim().slice(0, 300);
    if (!titulo) { problemas.push({ item: i + 1, pedido: '', problema: 'faltou o título' }); return; }
    let c = null;
    if (p.cliente) {
      const r = acharCliente(clientes, p.cliente);
      if (r.erro) { problemas.push(Object.assign({ item: i + 1, pedido: titulo, problema: 'empresa: ' + r.erro }, r.candidatos ? { candidatos: r.candidatos } : {})); return; }
      c = r.cliente;
    }
    const avisos = [];
    let resp = null;
    if (p.responsavel) {
      resp = acharPessoa(equipe, p.responsavel);
      if (!resp) { problemas.push({ item: i + 1, pedido: titulo, problema: 'responsável "' + p.responsavel + '" não achado na equipe', equipe: equipe.map(x => x.nome) }); return; }
    } else if (c && c.responsavelUid) {
      resp = equipe.find(x => x.uid === c.responsavelUid) || { uid: c.responsavelUid, nome: c.responsavelNome || '' };
    }
    const prazo = dataIso(p.prazo);
    if (prazo && prazo < hoje) avisos.push('prazo já passou');
    const prio = normalizar(p.prioridade);
    tarefas.push({
      titulo, tipo: normalizar(p.tipo).indexOf('requis') === 0 ? 'requisicao' : 'tarefa',
      prioridade: PRIORIDADES.indexOf(prio) !== -1 ? prio : 'normal', prazo,
      clienteId: c ? c.id : null, clienteNome: c ? rotuloCliente(c) : '',
      responsavelUid: resp ? resp.uid : '', responsavelNome: resp ? resp.nome : '',
      descricao: String(p.descricao || '').slice(0, 5000), solicitante: String(p.solicitante || '').slice(0, 200), avisos,
    });
  });
  if (!tarefas.length) return { erro: 'não deu pra preparar nenhuma tarefa', problemas };
  const t0 = tarefas[0];
  return {
    acao: 'tarefa',
    titulo: tarefas.length === 1 ? 'Criar ' + (t0.tipo === 'requisicao' ? 'requisição' : 'tarefa') + ': ' + t0.titulo : 'Criar ' + tarefas.length + ' tarefas',
    tarefas, problemas,
    aviso_para_a_ia: 'NADA foi gravado ainda. Diga em uma frase o que preparou (e os problemas, se houver) e que a pessoa confirma no cartão logo abaixo da resposta. Sem responsável, fica com quem confirmar. Não diga que já criou.',
  };
}

// ---------- alterar o cadastro do cliente ----------
// Os campos que a IA pode mudar, com o nome do campo no banco (os mesmos da
// ficha do cliente no Entregas). soAdmin: pelas regras do banco, só o admin
// grava; o cartão avisa, e pra quem não é admin a gravação é recusada.
const CAMPOS_CLIENTE = {
  email: { rotulo: 'E-mail principal' },
  adicionar_email: { rotulo: 'Outro e-mail', campo: 'emails' },
  zona: { rotulo: 'Região da rota' },
  pontoReferencia: { rotulo: 'Ponto de referência' },
  telefone: { rotulo: 'Telefone', soAdmin: true },
  endereco: { rotulo: 'Endereço', soAdmin: true },
  nomeFantasia: { rotulo: 'Nome fantasia', soAdmin: true },
  observacao: { rotulo: 'Observação', soAdmin: true },
  responsavel: { rotulo: 'Responsável', soAdmin: true },
};
function ehEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }

// clientes ativos; equipe = [{uid, nome}]
function prepararAlteracao(clientes, equipe, args) {
  const pedidos = Array.isArray(args && args.alteracoes) ? args.alteracoes.slice(0, 20) : [];
  if (!pedidos.length) return { erro: 'diga o cliente, o campo e o valor novo' };
  const alteracoes = [], problemas = [];
  pedidos.forEach((p, i) => {
    const r = acharCliente(clientes, p && p.cliente);
    if (r.erro) { problemas.push(Object.assign({ item: i + 1, pedido: String((p && p.cliente) || ''), problema: r.erro }, r.candidatos ? { candidatos: r.candidatos } : {})); return; }
    const c = r.cliente;
    const chave = String(p.campo || '').trim();
    const def = CAMPOS_CLIENTE[chave];
    if (!def) { problemas.push({ item: i + 1, pedido: rotuloCliente(c), problema: 'campo que eu não mudo: ' + chave + ' (mudo: ' + Object.keys(CAMPOS_CLIENTE).join(', ') + ')' }); return; }
    let valor = String(p.valor == null ? '' : p.valor).trim();
    const alt = { clienteId: c.id, clienteNome: rotuloCliente(c), campo: chave, rotulo: def.rotulo, soAdmin: !!def.soAdmin, avisos: [] };
    if (chave === 'email' || chave === 'adicionar_email') {
      valor = valor.toLowerCase();
      if (!ehEmail(valor)) { problemas.push({ item: i + 1, pedido: rotuloCliente(c), problema: 'e-mail inválido: ' + valor }); return; }
      const todos = [c.email].concat(Array.isArray(c.emails) ? c.emails : []).filter(Boolean).map(e => String(e).toLowerCase());
      if (todos.indexOf(valor) !== -1) alt.avisos.push('esse e-mail já está no cadastro');
      if (chave === 'email') { alt.de = c.email || ''; alt.para = valor; alt.gravar = { email: valor }; }
      else { alt.de = todos.join(', '); alt.para = valor; alt.uniao = { campo: 'emails', valor }; }
    } else if (chave === 'zona') {
      const z = normalizar(valor);
      const zona = ZONAS[z] ? z : (Object.keys(ZONAS).find(k => z && normalizar(ZONAS[k]).indexOf(z) !== -1) || '');
      if (!zona) { problemas.push({ item: i + 1, pedido: rotuloCliente(c), problema: 'região inválida: ' + valor + ' (superior, central ou inferior)' }); return; }
      alt.de = ZONAS[c.zona] || ''; alt.para = ZONAS[zona]; alt.gravar = { zona };
    } else if (chave === 'responsavel') {
      const pessoa = acharPessoa(equipe, valor);
      if (!pessoa) { problemas.push({ item: i + 1, pedido: rotuloCliente(c), problema: 'responsável "' + valor + '" não achado na equipe', equipe: equipe.map(x => x.nome) }); return; }
      alt.de = c.responsavelNome || ''; alt.para = pessoa.nome; alt.gravar = { responsavelUid: pessoa.uid, responsavelNome: pessoa.nome };
    } else {
      const limite = chave === 'observacao' ? 280 : (chave === 'telefone' ? 20 : 300);
      if (!valor) { problemas.push({ item: i + 1, pedido: rotuloCliente(c), problema: 'faltou o valor novo de ' + def.rotulo.toLowerCase() }); return; }
      valor = valor.slice(0, limite);
      alt.de = c[chave] || ''; alt.para = valor; alt.gravar = {}; alt.gravar[chave] = valor;
    }
    if (alt.de && alt.de === alt.para) alt.avisos.push('já está assim');
    alteracoes.push(alt);
  });
  if (!alteracoes.length) return { erro: 'não deu pra preparar nenhuma alteração', problemas };
  return {
    acao: 'cliente',
    titulo: alteracoes.length === 1 ? 'Alterar ' + alteracoes[0].rotulo.toLowerCase() + ': ' + alteracoes[0].clienteNome : 'Alterar o cadastro (' + alteracoes.length + ' mudanças)',
    alteracoes, problemas,
    aviso_para_a_ia: 'NADA foi gravado ainda. Diga em uma frase o que preparou (de → para) e que a pessoa confirma no cartão logo abaixo. Telefone, endereço, nome fantasia, observação e responsável só o admin consegue gravar. Não diga que já mudou.',
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
              vencimento: { type: 'string', description: 'Vencimento da guia, AAAA-MM-DD. Se a pessoa disse ou se a guia anexada mostra o vencimento, SEMPRE passe (o entregador precisa dele).' },
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
FERRAMENTAS_ACOES.push(
  {
    name: 'preparar_documento_recebido',
    description: 'Prepara a marcação de extrato bancário, comprovantes de pagamento ou extrato de aplicação como RECEBIDO na Pendências. NÃO grava: a pessoa confirma num cartão na tela. Use quando disserem que o cliente mandou/entregou o extrato (ou comprovante/aplicação) ou pedirem para marcar como recebido. Se o cliente tem vários bancos e parte já chegou, a resposta pede o banco: pergunte qual.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        marcacoes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cliente: { type: 'string', description: 'Nome, código do escritório ou id do cliente.' },
              tipo: { type: 'string', description: 'extrato, comprovante ou aplicacao. Sem isso, extrato.' },
              competencia: { type: 'string', description: 'Mês AAAA-MM do documento. Sem isso, o mês atual.' },
              banco: { type: 'string', description: 'Banco (ex.: Sicoob, Banco do Brasil, BB, Caixa), se a pessoa disse.' },
            },
            required: ['cliente'],
          },
        },
      },
      required: ['marcacoes'],
    },
  },
  {
    name: 'preparar_tarefa',
    description: 'Prepara a criação de TAREFA (ou requisição de cliente) no módulo Tarefas. NÃO grava: a pessoa confirma num cartão na tela. Use quando pedirem para criar/anotar uma tarefa, um lembrete de trabalho ou um pedido de cliente. Sem responsável, fica o responsável da empresa; sem empresa, quem confirmar.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        tarefas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              titulo: { type: 'string', description: 'O que fazer, curto (até 300 letras).' },
              tipo: { type: 'string', description: 'tarefa (padrão) ou requisicao (pedido que veio do cliente).' },
              cliente: { type: 'string', description: 'Empresa (nome, código ou id), se for de uma.' },
              responsavel: { type: 'string', description: 'Nome de quem da equipe faz.' },
              prazo: { type: 'string', description: 'AAAA-MM-DD.' },
              prioridade: { type: 'string', description: 'urgente, alta, normal (padrão) ou baixa.' },
              descricao: { type: 'string' },
              solicitante: { type: 'string', description: 'Quem pediu (em requisição).' },
            },
            required: ['titulo'],
          },
        },
      },
      required: ['tarefas'],
    },
  }
);
FERRAMENTAS_ACOES.push({
  name: 'preparar_alteracao_cliente',
  description: 'Prepara a alteração do CADASTRO de um cliente. NÃO grava: a pessoa confirma num cartão na tela. Campos: email (principal), adicionar_email (mais um e-mail), zona (região da rota: superior, central, inferior), pontoReferencia, telefone, endereco, nomeFantasia, observacao, responsavel (nome de alguém da equipe). Telefone, endereço, nome fantasia, observação e responsável só o admin grava. Não muda nome, CNPJ, código nem honorário.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      alteracoes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            cliente: { type: 'string', description: 'Nome, código ou id do cliente.' },
            campo: { type: 'string', enum: Object.keys(CAMPOS_CLIENTE) },
            valor: { type: 'string', description: 'O valor novo.' },
          },
          required: ['cliente', 'campo', 'valor'],
        },
      },
    },
    required: ['alteracoes'],
  },
});
const NOMES_ACOES = new Set(FERRAMENTAS_ACOES.map(f => f.name));

async function equipeAtiva(db) {
  const snapUsu = await db.collection('usuarios').get();
  return snapUsu.docs.map(d => {
    const x = d.data() || {};
    const roles = Array.isArray(x.roles) ? x.roles : (x.role ? [x.role] : []);
    return { uid: d.id, nome: x.nome || String(x.email || '').split('@')[0], ativo: x.ativo !== false, roles };
  }).filter(p => p.roles.length && p.ativo).map(p => ({ uid: p.uid, nome: p.nome }));
}

async function clientesAtivos(db) {
  const snap = await db.collection('clientes').where('ativo', '==', true).get();
  return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
}

async function executarAcao(db, nome, args, agora) {
  if (nome === 'preparar_documento_recebido') {
    const clientes = await clientesAtivos(db);
    const comps = Array.from(new Set(((args && args.marcacoes) || []).map(m => (m && m.competencia) || competenciaAtual(agora)).filter(competenciaValida))).slice(0, 10);
    const docs = {};
    if (comps.length) {
      const snap = await db.collection('documentosMensal').where('competencia', 'in', comps).get();
      snap.docs.forEach(d => { docs[d.id] = d.data(); });
    }
    return prepararDocumento(clientes, docs, require('./bancos').BANCOS, args || {}, agora);
  }
  if (nome === 'preparar_tarefa') {
    const [clientes, equipe] = await Promise.all([clientesAtivos(db), equipeAtiva(db)]);
    return prepararTarefa(clientes, equipe, args || {}, agora);
  }
  if (nome === 'preparar_alteracao_cliente') {
    const [clientes, equipe] = await Promise.all([clientesAtivos(db), equipeAtiva(db)]);
    return prepararAlteracao(clientes, equipe, args || {});
  }
  if (nome !== 'preparar_rota') return { erro: 'ação desconhecida: ' + nome };
  const [snapClientes, snapRota] = await Promise.all([
    db.collection('clientes').where('ativo', '==', true).get(),
    db.collection('entregas').where('status', '==', 'pendente').get(),
  ]);
  const clientes = snapClientes.docs.map(d => Object.assign({ id: d.id }, d.data()));
  const naRota = snapRota.docs.map(d => d.data());
  return prepararRota(clientes, naRota, args || {}, agora);
}

module.exports = {
  FERRAMENTAS_ACOES, NOMES_ACOES, executarAcao, prepararRota, prepararDocumento, prepararTarefa, prepararAlteracao,
  acharCliente, acharBanco, acharPessoa, tipoDoDocumento, tipoRecebido, valorEmReais, DOC_TIPOS,
};
