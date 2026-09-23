// Casca comum de todas as telas, no estilo do GitHub: barra de cima fixa
// (☰ · marca / módulo · consulta rápida · anotações · avatar), gaveta de
// módulos e ferramentas à esquerda, gaveta da conta à direita, e — quando a
// tela pede — a barra de abas sublinhadas do módulo logo abaixo.
//
// A marcação nasce aqui, uma vez só, e cada página a liga nos próprios
// comandos por NilmaShell.ao(...). O visual mora no entregas.html (bloco
// "Casca GitHub") e sai pra nilma-ui.css por scripts/monta-folha.js.
//
// Carregue no começo do <body> (depois de nilma-ui.js, que precisa vir no
// <head>) e chame NilmaShell.montar({...}) em seguida, sem defer: os
// scripts da página procuram #notasBtn, #tabsNav etc. quando rodam.
(function (janela, doc) {
  'use strict';

  var MODULOS_PADRAO = [
    { id: 'entregas',   rotulo: 'Entregas',           icone: 'ph-truck',           href: 'entregas.html' },
    { id: 'clientes',   rotulo: 'Clientes e ajustes', icone: 'ph-users',           href: 'entregas.html#clientes' },
    // papel = cargo que precisa ter pra ver o item (mesmos data-cargo da
    // antiga tela de cartões); sem papel, todo mundo vê
    { id: 'contabil',   rotulo: 'Contábil',           icone: 'ph-calculator',           href: 'entregas.html#contabil', papel: 'contabil' },
    { id: 'fiscal',     rotulo: 'Fiscal',             icone: 'ph-file-text',            href: 'lcdpr.html', papel: 'fiscal' },
    { id: 'pendencias', rotulo: 'Pendências',         icone: 'ph-envelope-simple-open', href: 'Pendencias-e-envio-automatico-via-Gmail.html', papel: 'contabil' }
  ];

  var opcoes = {};
  var ganchos = {};
  var gavetaAberta = null;   // elemento .gaveta aberto agora
  var gatilho = null;        // quem abriu, pra devolver o foco
  var relogioSaida = null;

  function $(id) { return doc.getElementById(id); }
  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function movimentoLigado() {
    if (doc.documentElement.dataset.animacao === 'reduzida') return false;
    return !(janela.matchMedia && janela.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function chamar(nome) {
    var lista = ganchos[nome] || [];
    var args = [].slice.call(arguments, 1);
    var tratado = false;
    lista.forEach(function (fn) { try { if (fn.apply(null, args) === true) tratado = true; } catch (e) { console.error(e); } });
    return tratado;
  }
  function iniciaisDe(nome) {
    var partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '';
    var a = partes[0].charAt(0), b = partes.length > 1 ? partes[partes.length - 1].charAt(0) : '';
    return (a + b).toUpperCase();
  }

  // ---------- marcação ----------
  function htmlModulo(m) {
    return '<a class="gaveta-item" data-modulo="' + escapar(m.id) + '" href="' + escapar(m.href) + '"' +
      (m.papel ? ' data-papel="' + escapar(m.papel) + '"' : '') + '>' +
      '<i class="ph ' + escapar(m.icone) + '" aria-hidden="true"></i><span>' + escapar(m.rotulo) + '</span></a>';
  }
  function htmlAba(a) {
    return '<button type="button" class="tab" role="tab" data-tab="' + escapar(a.id) + '" id="tabbtn-' + escapar(a.id) + '"' +
      (a.painel ? ' aria-controls="' + escapar(a.painel) + '"' : '') + ' aria-selected="false" tabindex="-1"' + (a.oculta ? ' hidden' : '') + '>' +
      (a.icone ? '<span class="tab-ico"><i class="ph ' + escapar(a.icone) + '" aria-hidden="true"></i></span>' : '') +
      '<span class="tab-label">' + escapar(a.rotulo) + '</span>' +
      (a.badge ? '<span class="tab-badge" id="' + escapar(a.badge) + '" hidden>0</span>' : '') +
      '</button>';
  }
  function htmlCasca(o) {
    var modulos = (o.modulos || MODULOS_PADRAO).map(htmlModulo).join('');
    var marcaHref = o.marcaHref || 'entregas.html';
    return '' +
      '<header class="gh-topo" id="topo">' +
        (o.semMenu ? '' :
        '<button type="button" class="topo-btn" id="menuAppBtn" title="Menu" aria-label="Abrir o menu" aria-controls="menuApp" aria-expanded="false" aria-haspopup="dialog">' +
          '<i class="ph ph-list" aria-hidden="true"></i></button>') +
        '<a class="topo-marca" id="topoMarca" href="' + escapar(marcaHref) + '">' +
          '<img class="topo-logo" id="topoLogo" alt="" hidden><span class="topo-nome">' + escapar(o.marca || 'Nilma') + '</span></a>' +
        '<span class="topo-sep" aria-hidden="true">/</span>' +
        '<span class="topo-modulo" id="topoModulo">' + escapar(o.modulo || '') + '</span>' +
        (o.busca === false ? '<span class="topo-vao"></span>' :
        '<button type="button" class="topo-busca" id="topoBusca" title="' + escapar(o.buscaRotulo || 'Consulta rápida') + ' (/)" aria-label="' + escapar(o.buscaRotulo || 'Consulta rápida') + '">' +
          '<i class="ph ' + escapar(o.buscaIcone || 'ph-magnifying-glass') + '" aria-hidden="true"></i>' +
          '<span class="topo-busca-texto">' + escapar(o.buscaRotulo || 'Consulta rápida') + '</span>' +
          '<kbd class="topo-busca-tecla" aria-hidden="true">/</kbd></button>') +
        '<div class="topo-fim">' +
          (o.notas === false ? '' :
          '<button type="button" class="topo-btn" id="notasBtn" hidden title="Minhas anotações" aria-label="Minhas anotações">' +
            '<i class="ph ph-note" aria-hidden="true"></i><span class="tab-badge" id="notasBadge" hidden>0</span></button>') +
          (o.semLogin ?
          '<span class="topo-pessoa" id="topoPessoa">' + escapar(o.pessoa || '') + '</span>' :
          '<button type="button" class="topo-avatar" id="avatarBtn" title="Conta" aria-label="Abrir o menu da conta" aria-controls="menuPerfil" aria-expanded="false" aria-haspopup="dialog">' +
            '<span class="topo-avatar-ini" id="avatarIniciais" aria-hidden="true"></span></button>') +
        '</div>' +
      '</header>' +
      (o.abas ? '<nav class="tabs" id="tabsNav" role="tablist">' + o.abas.map(htmlAba).join('') + '</nav>' : '') +
      '<div class="gaveta-veu" id="gavetaVeu" hidden></div>' +
      (o.semMenu ? '' :
      '<aside class="gaveta" id="menuApp" hidden role="dialog" aria-modal="true" aria-labelledby="menuAppTitulo" tabindex="-1">' +
        '<div class="gaveta-cabeca">' +
          '<span class="gaveta-titulo" id="menuAppTitulo">' + escapar(o.marca || 'Nilma') + '</span>' +
          '<button type="button" class="topo-btn gaveta-fechar" aria-label="Fechar o menu"><i class="ph ph-x" aria-hidden="true"></i></button>' +
        '</div>' +
        '<nav class="gaveta-corpo" aria-label="Módulos e ferramentas">' +
          '<div class="gaveta-grupo" id="menuAppModulos"><div class="gaveta-grupo-titulo">Módulos</div>' + modulos + '</div>' +
          '<div class="gaveta-grupo" id="menuAppFerramentas"><div class="gaveta-grupo-titulo">Ferramentas</div>' +
            (o.notas === false ? '' : '<button type="button" class="gaveta-item" id="menuNotasBtn" hidden><i class="ph ph-note" aria-hidden="true"></i><span>Anotações</span></button>') +
            (o.buscaGlobal === false ? '' : '<button type="button" class="gaveta-item" id="menuBuscaBtn"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><span>Busca</span><kbd>Ctrl K</kbd></button>') +
            '<button type="button" class="gaveta-item" id="menuInstalarBtn" hidden><i class="ph ph-download-simple" aria-hidden="true"></i><span>Instalar app</span></button>' +
          '</div>' +
        '</nav>' +
        '<div class="gaveta-pe" id="menuAppVersao">' + escapar(o.versao ? 'versão ' + o.versao : '') + '</div>' +
      '</aside>') +
      (o.semLogin ? '' :
      '<aside class="gaveta gaveta-direita" id="menuPerfil" hidden role="dialog" aria-modal="true" aria-labelledby="menuPerfilNome" tabindex="-1">' +
        '<div class="gaveta-cabeca gaveta-perfil-cabeca">' +
          '<span class="topo-avatar-ini gaveta-avatar" id="menuPerfilAvatar" aria-hidden="true"></span>' +
          '<div class="gaveta-perfil-texto"><b class="gaveta-perfil-nome" id="menuPerfilNome">Conta</b><div class="gaveta-sub" id="menuPerfilCargos"></div></div>' +
          '<button type="button" class="topo-btn gaveta-fechar" aria-label="Fechar o menu da conta"><i class="ph ph-x" aria-hidden="true"></i></button>' +
        '</div>' +
        '<nav class="gaveta-corpo" aria-label="Conta">' +
          '<button type="button" class="gaveta-item" id="menuPerfilBtn" hidden><i class="ph ph-identification-badge" aria-hidden="true"></i><span>Meu perfil</span></button>' +
          '<button type="button" class="gaveta-item" id="menuAparenciaBtn"><i class="ph ph-paint-brush" aria-hidden="true"></i><span>Aparência</span></button>' +
          '<button type="button" class="gaveta-item" id="menuContaBtn"><i class="ph ph-user-circle" aria-hidden="true"></i><span>Conta</span></button>' +
          '<div class="gaveta-fio" role="separator"></div>' +
          '<button type="button" class="gaveta-item perigo" id="menuSairBtn"><i class="ph ph-sign-out" aria-hidden="true"></i><span>Sair da conta</span></button>' +
        '</nav>' +
      '</aside>');
  }

  // ---------- gavetas ----------
  function abrirGaveta(id, quemAbriu) {
    var g = $(id);
    if (!g) return;
    if (gavetaAberta && gavetaAberta !== g) fecharGaveta(true);
    if (relogioSaida) { clearTimeout(relogioSaida); relogioSaida = null; }
    var veu = $('gavetaVeu');
    g.classList.remove('gaveta-saindo');
    if (veu) { veu.classList.remove('gaveta-saindo'); veu.hidden = false; }
    g.hidden = false;
    gavetaAberta = g;
    gatilho = quemAbriu || doc.activeElement;
    [$('menuAppBtn'), $('avatarBtn')].forEach(function (b) {
      if (b) b.setAttribute('aria-expanded', b.getAttribute('aria-controls') === id ? 'true' : 'false');
    });
    var alvos = focaveis(g);
    (alvos.find(function (el) { return !el.classList.contains('gaveta-fechar'); }) || alvos[0] || g).focus();
    chamar('abriu', id);
  }
  function fecharGaveta(semDevolverFoco) {
    var g = gavetaAberta;
    if (!g) return;
    gavetaAberta = null;
    var veu = $('gavetaVeu');
    [$('menuAppBtn'), $('avatarBtn')].forEach(function (b) { if (b) b.setAttribute('aria-expanded', 'false'); });
    var terminar = function () {
      g.hidden = true;
      g.classList.remove('gaveta-saindo');
      if (veu && !gavetaAberta) { veu.hidden = true; veu.classList.remove('gaveta-saindo'); }
      relogioSaida = null;
    };
    // hidden é a verdade: a animação de saída roda ANTES de esconder,
    // mesmo caminho do closeModal() do entregas.html.
    if (!movimentoLigado()) terminar();
    else {
      g.classList.add('gaveta-saindo');
      if (veu) veu.classList.add('gaveta-saindo');
      relogioSaida = setTimeout(terminar, 180);
    }
    if (!semDevolverFoco && gatilho && doc.body.contains(gatilho)) { try { gatilho.focus(); } catch (e) {} }
    gatilho = null;
    chamar('fechou', g.id);
  }
  function focaveis(box) {
    return [].slice.call(box.querySelectorAll(
      'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return !el.disabled && !el.hidden && el.offsetParent !== null; });
  }
  function emCampo(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }
  function haJanelaAberta() {
    // modal do entregas.html, ou qualquer diálogo aberto de outra tela
    return !!doc.querySelector('#modalRoot .modal, .modal-overlay:not([hidden]), dialog[open], .busca-global:not([hidden])');
  }

  // ---------- ligação dos eventos ----------
  function ligar() {
    var menuBtn = $('menuAppBtn'), avatarBtn = $('avatarBtn'), veu = $('gavetaVeu');
    if (menuBtn) menuBtn.addEventListener('click', function () { gavetaAberta && gavetaAberta.id === 'menuApp' ? fecharGaveta() : abrirGaveta('menuApp', menuBtn); });
    if (avatarBtn) avatarBtn.addEventListener('click', function () { gavetaAberta && gavetaAberta.id === 'menuPerfil' ? fecharGaveta() : abrirGaveta('menuPerfil', avatarBtn); });
    if (veu) veu.addEventListener('click', function () { fecharGaveta(); });
    [].forEach.call(doc.querySelectorAll('.gaveta-fechar'), function (b) { b.addEventListener('click', function () { fecharGaveta(); }); });

    // itens da gaveta de módulos: a página decide se troca de módulo por
    // dentro (retorna true) ou se navega normalmente pelo href
    var modulosEl = $('menuAppModulos');
    if (modulosEl) modulosEl.addEventListener('click', function (ev) {
      var a = ev.target.closest('.gaveta-item[data-modulo]');
      if (!a) return;
      var id = a.dataset.modulo;
      if (chamar('modulo', id, ev)) { ev.preventDefault(); fecharGaveta(true); return; }
      fecharGaveta(true);
    });
    function botao(id, evento) {
      var b = $(id);
      if (!b) return;
      b.addEventListener('click', function (ev) { fecharGaveta(true); chamar(evento, ev); });
    }
    botao('menuNotasBtn', 'notas');
    botao('menuBuscaBtn', 'buscaGlobal');
    botao('menuInstalarBtn', 'instalar');
    botao('menuPerfilBtn', 'perfil');
    botao('menuAparenciaBtn', 'aparencia');
    botao('menuContaBtn', 'conta');
    botao('menuSairBtn', 'sair');
    var buscaBtn = $('topoBusca');
    if (buscaBtn) buscaBtn.addEventListener('click', function (ev) { chamar('busca', ev); });
    var notasBtn = $('notasBtn');
    if (notasBtn) notasBtn.addEventListener('click', function (ev) { chamar('notas', ev); });

    // abas geradas aqui (telas-satélite): a página escuta 'aba'
    var tabs = $('tabsNav');
    if (tabs && opcoes.abas) tabs.addEventListener('click', function (ev) {
      var b = ev.target.closest('.tab');
      if (!b) return;
      ativarAba(b.dataset.tab);
      chamar('aba', b.dataset.tab, ev);
    });

    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && gavetaAberta) { ev.preventDefault(); fecharGaveta(); return; }
      if (ev.key === 'Tab' && gavetaAberta) {
        var alvos = focaveis(gavetaAberta);
        if (!alvos.length) return;
        var primeiro = alvos[0], ultimo = alvos[alvos.length - 1];
        if (ev.shiftKey && (doc.activeElement === primeiro || !gavetaAberta.contains(doc.activeElement))) { ev.preventDefault(); ultimo.focus(); }
        else if (!ev.shiftKey && doc.activeElement === ultimo) { ev.preventDefault(); primeiro.focus(); }
        return;
      }
      // "/" abre a consulta rápida, como no GitHub — fora de campo, sem
      // modificador, sem janela aberta por cima
      if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !gavetaAberta && !emCampo(ev.target) && !haJanelaAberta() && $('topoBusca')) {
        if (chamar('busca', ev)) ev.preventDefault();
      }
    });

    // sombra só depois que a página rola (a barra é fixa)
    var topo = $('topo');
    if (topo) {
      var sombra = function () { topo.classList.toggle('rolado', janela.scrollY > 4); };
      janela.addEventListener('scroll', sombra, { passive: true });
      sombra();
    }
  }

  // ---------- abas (quando a casca as gera) ----------
  function ativarAba(id) {
    var tabs = $('tabsNav');
    if (!tabs) return;
    [].forEach.call(tabs.querySelectorAll('.tab'), function (b) {
      var ativo = b.dataset.tab === id;
      b.classList.toggle('active', ativo);
      b.setAttribute('aria-selected', ativo ? 'true' : 'false');
      b.tabIndex = ativo ? 0 : -1;
      if (ativo && b.scrollIntoView) { try { b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
    });
  }

  // ---------- estado ----------
  function pintarAvatar(el, foto, iniciais) {
    if (!el) return;
    if (foto) { el.style.backgroundImage = 'url("' + foto + '")'; el.textContent = ''; el.classList.add('com-foto'); }
    else { el.style.backgroundImage = ''; el.textContent = iniciais || ''; el.classList.remove('com-foto'); }
  }
  function definirUsuario(u) {
    u = u || {};
    var nome = u.nome || '';
    var ini = u.iniciais || iniciaisDe(nome);
    pintarAvatar($('avatarIniciais'), u.foto, ini);
    pintarAvatar($('menuPerfilAvatar'), u.foto, ini);
    var n = $('menuPerfilNome'); if (n) n.textContent = nome || 'Conta';
    var c = $('menuPerfilCargos'); if (c) c.textContent = u.cargos || '';
    var p = $('topoPessoa'); if (p && nome) p.textContent = nome;
    if (u.podeVer) filtrarModulos(u.podeVer);
  }
  function filtrarModulos(podeVer) {
    [].forEach.call(doc.querySelectorAll('#menuAppModulos .gaveta-item[data-modulo]'), function (a) {
      a.hidden = !podeVer(a.dataset.modulo, a.dataset.papel || '');
    });
  }
  function definirModulo(id, nome) {
    var m = $('topoModulo');
    if (m && nome != null) m.textContent = nome;
    [].forEach.call(doc.querySelectorAll('#menuAppModulos .gaveta-item[data-modulo]'), function (a) {
      if (a.dataset.modulo === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (nome != null && opcoes.titulo !== false) {
      var base = opcoes.tituloBase || 'Nilma';
      doc.title = nome ? nome + ' — ' + base : base;
    }
  }
  function definirLogo(src) {
    var img = $('topoLogo');
    if (!img) return;
    if (src) { img.src = src; img.hidden = false; } else { img.hidden = true; }
  }
  function mostrar(id, sim) { var el = $(id); if (el) el.hidden = !sim; }

  function montar(o) {
    opcoes = o || {};
    if (!doc.body) {
      doc.addEventListener('DOMContentLoaded', function () { montar(o); });
      return api;
    }
    if ($('topo')) return api;   // já montada
    doc.body.insertAdjacentHTML('afterbegin', htmlCasca(opcoes));
    doc.documentElement.classList.add('com-casca');
    ligar();
    if (opcoes.moduloId) definirModulo(opcoes.moduloId, opcoes.modulo);
    if (opcoes.logo) definirLogo(opcoes.logo);
    if (opcoes.usuario) definirUsuario(opcoes.usuario);
    if (opcoes.abas && opcoes.abaInicial) ativarAba(opcoes.abaInicial);
    return api;
  }

  var api = {
    montar: montar,
    ao: function (evento, fn) { (ganchos[evento] = ganchos[evento] || []).push(fn); return api; },
    abrirGaveta: abrirGaveta,
    fecharGaveta: function () { fecharGaveta(); },
    gavetaAberta: function () { return gavetaAberta ? gavetaAberta.id : ''; },
    definirUsuario: definirUsuario,
    definirModulo: definirModulo,
    definirLogo: definirLogo,
    filtrarModulos: filtrarModulos,
    ativarAba: ativarAba,
    mostrarNotas: function (sim) { mostrar('notasBtn', sim); mostrar('menuNotasBtn', sim); },
    mostrarInstalar: function (sim) { mostrar('menuInstalarBtn', sim); },
    mostrarPerfil: function (sim) { mostrar('menuPerfilBtn', sim); },
    versao: function (v) { var el = $('menuAppVersao'); if (el) el.textContent = v ? 'versão ' + v : ''; },
    MODULOS: MODULOS_PADRAO
  };
  janela.NilmaShell = api;
})(window, document);
