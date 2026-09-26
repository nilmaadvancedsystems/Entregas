/* ==========================================================================
   Nilma — Solicitações numa janela por cima da tela (Entregas, Pendências e
   Fiscal)

   Mesmo desenho da janela de Configurações (nilma-config.js): tópicos numa
   barra lateral com busca no alto e o conteúdo em cartões à direita. Abre
   pelo menu da foto, de qualquer tela, sem sair de onde a pessoa está.

   Tópicos:
     Nova solicitação   o formulário (entregar, buscar, atestado, outro)
     Pendentes          o que ainda não foi feito (urgentes primeiro)
     Concluídas         as últimas 30 feitas

   Quem vê o quê é o mesmo do Entregas (e das regras do banco): o office boy
   vê a fila da equipe inteira; o resto, só o que pediu.

   Leituras: as pendentes só são ouvidas com a janela aberta (param ao
   fechar), e as concluídas só são lidas ao abrir aquele tópico. Nada é
   gravado sem a pessoa tocar em Enviar ou Concluir.

   Não precisa ligar à parte: NilmaConfig.ligar(...) repassa db, auth, cargos,
   usuário e toast pra cá. Opcional: clientes: () => Promise<[{ id, nome,
   codigoOrigem, documento }]> (sem isso, lê a lista uma vez ao buscar a
   empresa de um atestado).
     NilmaSolicitacoes.abrir('pendentes' | 'concluidas' | 'nova');
   ========================================================================== */
(function (janela, doc) {
  'use strict';
  var o = {};
  var caixa = null;
  var topico = 'pendentes';
  var busca = '';
  var pendentes = [];          // ouvidas com a janela aberta
  var carregando = true;
  var erroLista = '';
  var concluidas = null;       // null = ainda não lidas nesta abertura
  var pararDeOuvir = null;
  var clientesLidos = null;    // cache da lista de clientes (atestado)
  var empresaEscolhida = null;

  var TOPICOS = [
    { id: 'nova', rotulo: 'Nova solicitação', icone: 'ph-plus', titulo: 'Nova solicitação', sub: 'Peça pra equipe entregar, buscar ou resolver algo na rua.' },
    { id: 'pendentes', grupo: 'Lista', rotulo: 'Pendentes', icone: 'ph-hourglass-medium', titulo: 'Pendentes' },
    { id: 'concluidas', grupo: 'Lista', rotulo: 'Concluídas', icone: 'ph-check-circle', titulo: 'Concluídas' }
  ];
  var TIPOS = [
    ['entregar', 'Entregar documento'],
    ['buscar', 'Buscar documento'],
    ['atestado', 'Buscar atestado (clínica)'],
    ['outro', 'Outro']
  ];
  var CLINICAS = [['Assegi', 'Assegi'], ['Preventive', 'Preventive'], ['Outra', 'Outra clínica']];

  function $(id) { return doc.getElementById(id); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function semAcento(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function avisar(msg, tipo) {
    if (typeof o.toast === 'function') { o.toast(msg, tipo); return; }
    var t = doc.createElement('div');
    t.className = 'ncfg-toast' + (tipo === 'error' ? ' erro' : '');
    t.setAttribute('role', 'status');
    t.textContent = msg;
    doc.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }
  function erroDe(err, padrao) {
    if (err && err.code === 'permission-denied') return 'Sem permissão pra isso.';
    return (err && (err.message || err.code)) || padrao;
  }
  function conta() { return o.auth && o.auth.currentUser; }
  function email() { var u = conta(); return (u && u.email) || ''; }
  function cargos() { return typeof o.cargos === 'function' ? (o.cargos() || []) : []; }
  // igual ao Entregas: o office boy cuida da fila da equipe toda
  function veTudo() { return cargos().indexOf('office_boy') !== -1; }
  function podeConcluir(s) { return veTudo() || (s.criadoPor && s.criadoPor === email()); }
  function nomeDaPessoa() { var u = typeof o.usuario === 'function' ? (o.usuario() || {}) : {}; return u.nome || ''; }
  function tipoRotulo(t) {
    if (t === 'entregar') return 'Entregar documento';
    if (t === 'buscar') return 'Buscar documento';
    if (t === 'atestado') return 'Buscar atestado';
    return 'Outro';
  }
  function quando(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    var hoje = new Date(), ontem = new Date(Date.now() - 864e5);
    var hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === hoje.toDateString()) return 'hoje ' + hora;
    if (d.toDateString() === ontem.toDateString()) return 'ontem ' + hora;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
  }
  function rotuloCliente(c) { return (c.codigoOrigem ? c.codigoOrigem + ' - ' : '') + (c.nome || c.nomeFantasia || ''); }

  // ------------------------------------------------------------ montagem
  var CSS =
    '.nsol .ncfg-item .nsol-num{margin-left:auto;flex:none;min-width:20px;height:20px;padding:0 6px;border-radius:10px;display:inline-grid;place-items:center;' +
      'background:var(--surface-3);color:var(--ink-muted);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}' +
    '.nsol .ncfg-item .nsol-num.urgente{background:var(--accent);color:#FFFFFF}' +
    '.nsol .ncfg-item.nsol-nova{margin-bottom:6px;border:1px solid var(--border);background:var(--surface);font-weight:500}' +
    '.nsol .ncfg-item.nsol-nova:hover{background:var(--hover-bg)}' +
    '.nsol .ncfg-item.nsol-nova[aria-current="page"]{border-color:var(--accent)}' +
    '.nsol .ncfg-item.nsol-nova .ph{color:var(--accent)}' +
    '.nsol-pedido .rot{overflow-wrap:anywhere}' +
    '.nsol-pedido .desc .quem{color:var(--ink)}' +
    '.nsol-selo{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:2em;font-size:12px;font-weight:500;white-space:nowrap;' +
      'border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);color:var(--accent)}' +
    '.nsol-selo.ok{border-color:color-mix(in srgb,var(--success) 45%,transparent);color:var(--success)}' +
    '.nsol .ncfg-botao.pequeno{min-height:28px;padding:3px 10px;font-size:13px}' +
    '.nsol-campo{position:relative;width:min(340px,100%)}' +
    '.nsol .nsol-campo input,.nsol .nsol-campo select,.nsol textarea.nsol-texto{width:100%;min-height:32px;padding:5px 10px;border:1px solid var(--border);border-radius:6px;' +
      'background:var(--surface);color:var(--ink);font:inherit;font-size:14px;box-sizing:border-box}' +
    '.nsol textarea.nsol-texto{min-height:88px;resize:vertical;line-height:20px}' +
    '.nsol .nsol-campo input:focus,.nsol .nsol-campo select:focus,.nsol textarea.nsol-texto:focus{outline:none;border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}' +
    '.nsol .nsol-invalido{border-color:var(--destructive)!important}' +
    '.nsol-sugestoes{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:2;max-height:240px;overflow-y:auto;padding:4px;border:1px solid var(--border);' +
      'border-radius:6px;background:var(--surface);box-shadow:var(--shadow-md)}' +
    '.nsol-sugestoes:empty{display:none}' +
    '.nsol-sugestoes button{display:block;width:100%;padding:6px 10px;border:0;border-radius:4px;background:none;color:var(--ink);font:inherit;font-size:13px;text-align:left;cursor:pointer}' +
    '.nsol-sugestoes button:hover,.nsol-sugestoes button:focus-visible{background:var(--hover-bg)}' +
    '.nsol-sugestoes small{display:block;color:var(--ink-muted);font-size:12px}' +
    '.nsol-rodape{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border);background:var(--surface-2)}' +
    '.nsol-erro{flex:1;font-size:12px;color:var(--destructive)}' +
    '.nsol-vazio{display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px 16px;text-align:center;color:var(--ink-muted);font-size:14px}' +
    '.nsol-vazio .ph{font-size:28px}' +
    '@media (max-width:700px){#nsolTopicos{display:contents}.nsol .ncfg-item.nsol-nova{margin:0}.nsol-campo{width:100%}}';

  function montar() {
    if (caixa) return caixa;
    if (janela.NilmaConfig && janela.NilmaConfig.estilo) janela.NilmaConfig.estilo();
    if (!$('nsolEstilo')) {
      var s = doc.createElement('style');
      s.id = 'nsolEstilo'; s.textContent = CSS;
      doc.head.appendChild(s);
    }
    caixa = doc.createElement('dialog');
    caixa.className = 'ncfg nsol';
    caixa.id = 'nilmaSolicitacoes';
    caixa.setAttribute('aria-label', 'Solicitações');
    caixa.innerHTML =
      '<nav class="ncfg-lado" aria-label="Solicitações">' +
        '<label class="ncfg-busca"><i class="ph ph-magnifying-glass" aria-hidden="true"></i>' +
          '<input type="search" id="nsolBusca" placeholder="Buscar solicitações" aria-label="Buscar solicitações" autocomplete="off"></label>' +
        '<div id="nsolTopicos"></div>' +
      '</nav>' +
      '<div class="ncfg-conteudo" id="nsolConteudo">' +
        '<button type="button" class="ncfg-fechar" id="nsolFechar" aria-label="Fechar"><i class="ph ph-x" aria-hidden="true"></i></button>' +
        '<div class="ncfg-pagina" id="nsolPagina"></div>' +
      '</div>';
    doc.body.appendChild(caixa);
    $('nsolFechar').addEventListener('click', fechar);
    caixa.addEventListener('click', function (ev) { if (ev.target === caixa) fechar(); });
    caixa.addEventListener('close', aoFechar);
    $('nsolBusca').addEventListener('input', function () {
      busca = semAcento(this.value.trim());
      if (busca) {
        // vai pro tópico que tem o que foi buscado (como a busca das Configurações)
        var naFila = pendentes.some(combina);
        var nasFeitas = Array.isArray(concluidas) && concluidas.some(combina);
        if (topico === 'nova') topico = 'pendentes';
        if (topico === 'pendentes' && !naFila && nasFeitas) topico = 'concluidas';
        else if (topico === 'concluidas' && !nasFeitas && naFila) topico = 'pendentes';
      }
      desenhar();
    });
    $('nsolTopicos').addEventListener('click', function (ev) {
      var b = ev.target.closest('.ncfg-item');
      if (!b) return;
      irPara(b.dataset.topico);
    });
    return caixa;
  }

  function irPara(id) {
    topico = id;
    if (id === 'concluidas' && concluidas === null) lerConcluidas();
    desenhar();
    $('nsolConteudo').scrollTop = 0;
    if (id === 'nova') { var d = $('nsolDescricao'); if (d && !(janela.matchMedia && matchMedia('(hover: none)').matches)) d.focus(); }
  }

  // ------------------------------------------------------------ dados
  function ouvirPendentes() {
    if (pararDeOuvir || !o.db || !conta()) return;
    carregando = true; erroLista = '';
    var col = o.db.collection('solicitacoes');
    var q = veTudo() ? col.where('status', '==', 'pendente')
      : col.where('criadoPor', '==', email()).where('status', '==', 'pendente');
    pararDeOuvir = q.limit(300).onSnapshot(function (snap) {
      pendentes = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      carregando = false; erroLista = '';
      pintarContador();
      desenhar(true);
    }, function (err) {
      carregando = false; erroLista = erroDe(err, 'Não foi possível carregar as solicitações.');
      desenhar(true);
    });
  }
  function lerConcluidas() {
    if (!o.db || !conta()) return;
    var col = o.db.collection('solicitacoes');
    // sem índice composto: a fila recente (office boy) ou tudo o que a
    // pessoa pediu, e o filtro de concluídas fica aqui
    var q = veTudo() ? col.orderBy('criadoEm', 'desc').limit(120) : col.where('criadoPor', '==', email()).limit(300);
    q.get().then(function (snap) {
      concluidas = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); })
        .filter(function (s) { return s.status === 'concluida'; })
        .sort(function (a, b) { return String(b.concluidoEm || b.criadoEm || '').localeCompare(String(a.concluidoEm || a.criadoEm || '')); })
        .slice(0, 30);
      desenhar(true);
    }).catch(function (err) {
      concluidas = { erro: erroDe(err, 'Não foi possível carregar as concluídas.') };
      desenhar(true);
    });
  }
  // o número de pendentes também no menu da foto (o Entregas já pinta o dele)
  function pintarContador() {
    var b = $('menuSolicitacoesBadge');
    if (!b || janela.NILMA_SOLICITACOES_NO_ENTREGAS) return;
    b.textContent = String(pendentes.length);
    b.hidden = pendentes.length === 0;
  }

  // ------------------------------------------------------------ desenho
  function combina(s) {
    if (!busca) return true;
    return semAcento([s.descricao, s.local, s.criadoPorNome, s.criadoPor, tipoRotulo(s.tipo), s.concluidoPorNome].join(' ')).indexOf(busca) !== -1;
  }
  function desenhar(soDados) {
    var urgentes = pendentes.filter(function (s) { return s.urgente; }).length;
    var html = '', grupo = '';
    TOPICOS.forEach(function (t) {
      if (t.grupo && t.grupo !== grupo) { grupo = t.grupo; html += '<div class="ncfg-grupo">' + esc(grupo) + '</div>'; }
      var num = '';
      if (t.id === 'pendentes' && !carregando && pendentes.length) num = '<span class="nsol-num' + (urgentes ? ' urgente' : '') + '">' + pendentes.length + '</span>';
      html += '<button type="button" class="ncfg-item' + (t.id === 'nova' ? ' nsol-nova' : '') + '" data-topico="' + t.id + '"' +
        (t.id === topico ? ' aria-current="page"' : '') + '><i class="ph ' + t.icone + '" aria-hidden="true"></i><span class="rot">' + esc(t.rotulo) + '</span>' + num + '</button>';
    });
    $('nsolTopicos').innerHTML = html;
    // chegou dado novo com o formulário aberto: não apaga o que a pessoa digitou
    if (soDados && topico === 'nova') return;
    var pag = $('nsolPagina');
    if (topico === 'nova') { pag.innerHTML = paginaNova(); ligarNova(); return; }
    pag.innerHTML = topico === 'concluidas' ? paginaConcluidas() : paginaPendentes();
    pag.querySelectorAll('[data-concluir]').forEach(function (b) {
      b.addEventListener('click', function () { concluir(b.dataset.concluir, b); });
    });
    var nova = pag.querySelector('[data-ir="nova"]');
    if (nova) nova.addEventListener('click', function () { irPara('nova'); });
  }

  function cabecalho(t, sub) {
    return '<h1>' + esc(t.titulo) + '</h1><p class="ncfg-sub">' + esc(sub || t.sub || '') + '</p>';
  }
  function vazio(icone, texto, comBotao) {
    return '<section class="ncfg-cartao"><div class="nsol-vazio"><i class="ph ' + icone + '" aria-hidden="true"></i><div>' + esc(texto) + '</div>' +
      (comBotao ? '<button type="button" class="ncfg-botao" data-ir="nova"><i class="ph ph-plus" aria-hidden="true"></i>Nova solicitação</button>' : '') + '</div></section>';
  }
  function linhaPedido(s, i) {
    var quem = s.criadoPor === email() ? 'você' : (s.criadoPorNome || s.criadoPor || 'alguém da equipe');
    var partes = [tipoRotulo(s.tipo)];
    if (s.local) partes.push(s.local);
    var desc = esc(partes.join(' · ')) + ' · pedido por <span class="quem">' + esc(quem) + '</span> · ' + esc(quando(s.criadoEm));
    var ctl = '';
    if (s.status === 'concluida') {
      desc += '<br>concluída' + (s.concluidoPorNome ? ' por <span class="quem">' + esc(s.concluidoPorNome) + '</span>' : '') + (s.concluidoEm ? ' · ' + esc(quando(s.concluidoEm)) : '');
      ctl = '<span class="nsol-selo ok">Concluída</span>';
    } else if (podeConcluir(s)) {
      ctl = '<button type="button" class="ncfg-botao pequeno" data-concluir="' + esc(s.id) + '"><i class="ph ph-check" aria-hidden="true"></i>Concluir</button>';
    }
    return '<div class="ncfg-linha nsol-pedido"><div class="txt"><div class="rot">' + esc(s.descricao || '(sem descrição)') + '</div>' +
      '<div class="desc">' + desc + '</div></div>' + (ctl ? '<div class="ctl">' + ctl + '</div>' : '') + '</div>';
  }
  function cartaoDe(titulo, lista, selo) {
    if (!lista.length) return '';
    return '<section class="ncfg-cartao"><div class="ncfg-cartao-cab"><h2>' + esc(titulo) + '</h2>' + (selo || '') + '</div>' + lista.map(linhaPedido).join('') + '</section>';
  }

  function paginaPendentes() {
    var t = TOPICOS[1];
    var sub = veTudo() ? 'Pedidos da equipe que ainda não foram feitos.' : 'O que você pediu e ainda não foi feito.';
    if (carregando) return cabecalho(t, sub) + '<div class="ncfg-nada" style="margin:0">Carregando…</div>';
    if (erroLista) return cabecalho(t, sub) + vazio('ph-warning-circle', erroLista);
    var lista = pendentes.filter(combina).sort(function (a, b) { return String(a.criadoEm || '').localeCompare(String(b.criadoEm || '')); });
    if (!lista.length) return cabecalho(t, sub) + (busca ? vazio('ph-magnifying-glass', 'Nada encontrado nas pendentes.') : vazio('ph-check-circle', 'Nenhuma solicitação pendente.', true));
    var urg = lista.filter(function (s) { return s.urgente; });
    var resto = lista.filter(function (s) { return !s.urgente; });
    return cabecalho(t, sub) +
      cartaoDe('Urgentes', urg, '<span class="nsol-selo">' + urg.length + '</span>') +
      cartaoDe(urg.length ? 'As outras' : 'Na fila, das mais antigas', resto);
  }

  function paginaConcluidas() {
    var t = TOPICOS[2];
    var sub = veTudo() ? 'As últimas feitas pela equipe.' : 'As últimas que você pediu e já foram feitas.';
    if (concluidas === null) return cabecalho(t, sub) + '<div class="ncfg-nada" style="margin:0">Carregando…</div>';
    if (concluidas.erro) return cabecalho(t, sub) + vazio('ph-warning-circle', concluidas.erro);
    var lista = concluidas.filter(combina);
    if (!lista.length) return cabecalho(t, sub) + vazio(busca ? 'ph-magnifying-glass' : 'ph-tray', busca ? 'Nada encontrado nas concluídas.' : 'Nenhuma solicitação concluída ainda.');
    return cabecalho(t, sub) + cartaoDe('Últimas ' + lista.length, lista);
  }

  // ---------------- Nova solicitação
  function opcoes(lista, atual) {
    return lista.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === atual ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('');
  }
  function campo(rotulo, desc, controle, id, coluna) {
    return '<div class="ncfg-linha' + (coluna ? ' coluna' : '') + '"' + (id ? ' id="' + id + '"' : '') + '><div class="txt"><div class="rot">' + esc(rotulo) + '</div>' +
      (desc ? '<div class="desc">' + esc(desc) + '</div>' : '') + '</div><div class="ctl"' + (coluna ? ' style="justify-content:stretch"' : '') + '>' + controle + '</div></div>';
  }
  function paginaNova() {
    var t = TOPICOS[0];
    return cabecalho(t) +
      '<form id="nsolForm" novalidate><section class="ncfg-cartao"><div class="ncfg-cartao-cab"><h2>O pedido</h2></div>' +
        campo('Tipo', 'O que precisa ser feito.', '<div class="nsol-campo"><select id="nsolTipo" aria-label="Tipo">' + opcoes(TIPOS, 'entregar') + '</select></div>') +
        campo('Clínica', 'Onde o atestado vai ser buscado.', '<div class="nsol-campo"><select id="nsolClinica" aria-label="Clínica">' + opcoes(CLINICAS, 'Assegi') + '</select></div>', 'nsolLinhaClinica') +
        campo('Funcionário', 'Nome de quem fez o exame.', '<div class="nsol-campo"><input type="text" id="nsolFuncionario" placeholder="Nome do funcionário" autocomplete="off"></div>', 'nsolLinhaFuncionario') +
        campo('Empresa cliente', 'A empresa do funcionário.', '<div class="nsol-campo"><input type="text" id="nsolEmpresa" placeholder="Buscar por nome, código ou CNPJ" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="nsolSugestoes">' +
          '<div class="nsol-sugestoes" id="nsolSugestoes" role="listbox" aria-label="Clientes encontrados"></div></div>', 'nsolLinhaEmpresa') +
        campo('Cliente ou local', 'Opcional. Ex.: Cartório, Prefeitura, nome do cliente.', '<div class="nsol-campo"><input type="text" id="nsolLocal" placeholder="Cliente ou local" autocomplete="off"></div>', 'nsolLinhaLocal') +
        campo('Descrição', '', '<textarea class="nsol-texto" id="nsolDescricao" rows="3" placeholder="O que precisa ser feito"></textarea>', 'nsolLinhaDescricao', true) +
        campo('Prioridade', 'Urgente aparece em cima da fila.', '<div class="ncfg-seg" role="group" id="nsolPrioridade">' +
          '<button type="button" data-valor="normal" aria-pressed="true">Normal</button>' +
          '<button type="button" data-valor="urgente" aria-pressed="false"><i class="ph ph-lightning" aria-hidden="true"></i>Urgente</button></div>') +
        '<div class="nsol-rodape"><span class="nsol-erro" id="nsolErro" role="alert"></span>' +
          '<button type="submit" class="ncfg-botao primario" id="nsolEnviar"><i class="ph ph-paper-plane-tilt" aria-hidden="true"></i>Enviar solicitação</button></div>' +
      '</section></form>';
  }
  function ehAtestado() { return $('nsolTipo').value === 'atestado'; }
  function mostrarCampos() {
    var a = ehAtestado();
    $('nsolLinhaClinica').hidden = !a;
    $('nsolLinhaFuncionario').hidden = !a;
    $('nsolLinhaEmpresa').hidden = !a;
    $('nsolLinhaLocal').hidden = a;
    $('nsolLinhaDescricao').hidden = a;
    $('nsolErro').textContent = '';
  }
  function carregarClientes() {
    if (clientesLidos) return Promise.resolve(clientesLidos);
    var p = typeof o.clientes === 'function' ? Promise.resolve(o.clientes())
      : (o.db ? o.db.collection('clientes').get().then(function (snap) { return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); }) : Promise.resolve([]));
    return p.then(function (lista) {
      clientesLidos = (lista || []).filter(function (c) { return c && c.ativo !== false; });
      return clientesLidos;
    }).catch(function () { return []; });
  }
  function sugerir() {
    var el = $('nsolSugestoes'), inp = $('nsolEmpresa');
    if (!el) return;
    var q = semAcento(inp.value.trim());
    var dig = inp.value.replace(/\D/g, '');
    el.innerHTML = '';
    if (!q || !clientesLidos) { inp.setAttribute('aria-expanded', 'false'); return; }
    clientesLidos.filter(function (c) {
      return semAcento(rotuloCliente(c) + ' ' + (c.nomeFantasia || '')).indexOf(q) !== -1 ||
        (dig.length >= 3 && String(c.documento || '').replace(/\D/g, '').indexOf(dig) !== -1);
    }).slice(0, 8).forEach(function (c) {
      var b = doc.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'option');
      b.innerHTML = esc(rotuloCliente(c)) + (c.documento ? '<small>' + esc(c.documento) + '</small>' : '');
      b.addEventListener('click', function () {
        empresaEscolhida = c;
        inp.value = rotuloCliente(c);
        inp.classList.remove('nsol-invalido');
        el.innerHTML = '';
        inp.setAttribute('aria-expanded', 'false');
      });
      el.appendChild(b);
    });
    inp.setAttribute('aria-expanded', String(el.children.length > 0));
  }
  function ligarNova() {
    empresaEscolhida = null;
    $('nsolTipo').addEventListener('change', mostrarCampos);
    mostrarCampos();
    $('nsolPrioridade').addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      this.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
    var emp = $('nsolEmpresa');
    emp.addEventListener('focus', function () { carregarClientes().then(sugerir); });
    emp.addEventListener('input', function () { empresaEscolhida = null; carregarClientes().then(sugerir); });
    emp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && $('nsolSugestoes').children.length) { ev.preventDefault(); ev.stopPropagation(); $('nsolSugestoes').innerHTML = ''; }
    });
    $('nsolForm').addEventListener('click', function (ev) {
      if (!ev.target.closest('.nsol-campo')) { var s = $('nsolSugestoes'); if (s) s.innerHTML = ''; }
    });
    ['nsolDescricao', 'nsolFuncionario'].forEach(function (id) {
      $(id).addEventListener('input', function () { this.classList.remove('nsol-invalido'); $('nsolErro').textContent = ''; });
    });
    $('nsolForm').addEventListener('submit', enviar);
  }

  function enviar(ev) {
    ev.preventDefault();
    var u = conta();
    var erro = $('nsolErro');
    if (!u || !o.db) { erro.textContent = 'Sem conexão com a conta agora.'; return; }
    var atestado = ehAtestado();
    var descricao = $('nsolDescricao').value.trim();
    var funcionario = $('nsolFuncionario').value.trim();
    var clinica = $('nsolClinica').value;
    if (atestado) {
      var falta = [];
      if (!funcionario) { $('nsolFuncionario').classList.add('nsol-invalido'); falta.push('o nome do funcionário'); }
      if (!empresaEscolhida) { $('nsolEmpresa').classList.add('nsol-invalido'); falta.push('a empresa (escolha da lista)'); }
      if (falta.length) { erro.textContent = 'Falta ' + falta.join(' e ') + '.'; return; }
    } else if (!descricao) {
      $('nsolDescricao').classList.add('nsol-invalido');
      erro.textContent = 'Descreva o que precisa ser feito.';
      $('nsolDescricao').focus();
      return;
    }
    var dados = {
      tipo: $('nsolTipo').value,
      local: atestado ? clinica : $('nsolLocal').value.trim(),
      descricao: atestado ? ('Buscar atestado de ' + funcionario + ' — ' + rotuloCliente(empresaEscolhida) + ' (clínica ' + clinica + ')') : descricao,
      urgente: $('nsolPrioridade').querySelector('[aria-pressed="true"]').dataset.valor === 'urgente',
      status: 'pendente',
      criadoPor: u.email || '',
      criadoPorNome: nomeDaPessoa(),
      criadoEm: new Date().toISOString()
    };
    if (atestado) {
      dados.atestadoClinica = clinica;
      dados.atestadoFuncionario = funcionario;
      dados.atestadoEmpresa = rotuloCliente(empresaEscolhida);
      dados.atestadoEmpresaId = empresaEscolhida.id;
    }
    var botao = $('nsolEnviar');
    botao.disabled = true;
    // Sem internet o Firestore guarda e manda depois: não prende a tela.
    var gravou = o.db.collection('solicitacoes').add(dados);
    var espera = new Promise(function (ok) { setTimeout(function () { ok('depois'); }, 5000); });
    Promise.race([gravou.then(function () { return 'ok'; }), espera]).then(function (r) {
      avisar(r === 'ok' ? 'Solicitação enviada.' : 'Solicitação salva; vai subir quando a internet voltar.');
      irPara('pendentes');
    }).catch(function (err) {
      botao.disabled = false;
      erro.textContent = erroDe(err, 'Não foi possível enviar.');
    });
  }

  function concluir(id, botao) {
    if (!o.db || !conta()) return;
    botao.disabled = true;
    o.db.collection('solicitacoes').doc(id).update({
      status: 'concluida', concluidoEm: new Date().toISOString(),
      concluidoPor: email(), concluidoPorNome: nomeDaPessoa()
    }).then(function () {
      avisar('Solicitação concluída.');
      concluidas = null;   // relê ao abrir Concluídas
    }).catch(function (err) {
      botao.disabled = false;
      avisar(erroDe(err, 'Não foi possível concluir.'), 'error');
    });
  }

  // ------------------------------------------------------------ abrir e fechar
  function abrir(qual) {
    if (!conta()) { avisar('Entre na sua conta pra ver as solicitações.', 'error'); return; }
    montar();
    if (qual && TOPICOS.some(function (t) { return t.id === qual; })) topico = qual;
    else if (!caixa.open) topico = 'pendentes';
    busca = '';
    $('nsolBusca').value = '';
    concluidas = null;
    ouvirPendentes();
    if (topico === 'concluidas') lerConcluidas();
    desenhar();
    $('nsolConteudo').scrollTop = 0;
    if (!caixa.open) caixa.showModal();
    if (topico === 'nova') irPara('nova');
    else if (!(janela.matchMedia && matchMedia('(hover: none)').matches)) $('nsolBusca').focus();
    else caixa.focus();
  }
  function aoFechar() {
    if (pararDeOuvir) { pararDeOuvir(); pararDeOuvir = null; }
    busca = '';
  }
  function fechar() { if (caixa && caixa.open) caixa.close(); }
  function ligar(opcoes) { o = Object.assign(o, opcoes || {}); }

  janela.NilmaSolicitacoes = { ligar: ligar, abrir: abrir, fechar: fechar };
})(window, document);
