/* ==========================================================================
   Nilma — Configurações do usuário (uma janela só para Entregas, Pendências
   e Fiscal)

   Desenho do Notion: uma janela grande por cima da tela, com os tópicos numa
   barra lateral à esquerda (com busca no alto) e as opções à direita. Dentro,
   o mesmo desenho da ficha do cliente: título da página e cartões com
   cabeçalho, uma opção por linha (rótulo e explicação à esquerda, controle
   à direita).

   Tópicos:
     Conta         Minha conta (foto, nome, e-mail, cargos, senha, sair)
                   Notificações (ligar, testar e desligar neste aparelho)
     Preferências  Aparência (tema, barra lateral)
                   Telas e listas (onde Entregas e Pendências abrem, lista ou
                   cartões, como abrir PDF)
                   Consulta rápida (resposta padrão: rápida ou com IA)
     Aplicativo    Instalar, versão, baixar a versão mais nova, atalhos
     Escritório    Integrações (só admin: robô, Gmail, IA, backup, uso do
                   banco) — só leitura aqui

   Gravação: só quando a pessoa toca em algo, e só se o valor mudou. Guarda
   no aparelho (localStorage nilma_*) e na conta (usuarios/{uid}), nos mesmos
   campos que as telas já liam. Nada é gravado sozinho, nem ao abrir.

   Uso (pode chamar ligar mais de uma vez: as opções se somam):
     NilmaConfig.ligar({
       db, auth, firebase,
       usuario: () => ({ nome, foto }),     // o que a tela já sabe da pessoa
       cargos: () => ['admin', ...],
       aoMudarFoto: foto => ...,            // pinta o avatar da barra
       aoMudarNome: nome => ...,            // idem, com o nome novo
       aplicar: (campo, valor) => ...,      // a tela aplica tema etc. na hora
       salvar: (campo, valor) => bool,      // opcional: true = a tela gravou
       toast: (msg, tipo) => ...,
       notificacoes: { ativar: () => ... }, // opcional: sem isto, registra aqui
       instalar: { pode: () => bool, fazer: () => ... },
       versao: '2.346', sair: () => ...
     });
     NilmaConfig.abrir('conta' | 'notificacoes' | 'aparencia' | 'telas' | 'consulta' | 'aplicativo' | 'integracoes');
   Link direto: qualquer tela com ?config=notificacoes abre ali depois do login.
   ========================================================================== */
(function (janela, doc) {
  'use strict';
  var o = {};
  var caixa = null;
  var secaoAtual = 'conta';
  var busca = '';
  var fotoAtual = '';
  var trocandoSenha = false;

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
    t.textContent = msg;
    doc.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }
  function erroDe(err, padrao) { return (err && (err.message || err.code)) || padrao; }
  function usuario() { return typeof o.usuario === 'function' ? (o.usuario() || {}) : {}; }
  function contaFirebase() { return o.auth && o.auth.currentUser; }
  function cargos() { return typeof o.cargos === 'function' ? (o.cargos() || []) : []; }
  function ehAdmin() { return cargos().indexOf('admin') !== -1; }
  function iniciais(nome) {
    var p = String(nome || '').trim().split(/[\s.@]+/).filter(Boolean);
    return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '';
  }
  var NOME_CARGO = { admin: 'Admin', contabil: 'Contábil', fiscal: 'Fiscal', office_boy: 'Office boy', staff: 'Equipe' };

  // ------------------------------------------------------------ preferências
  var CHAVE_LOCAL = {
    abaInicial: 'nilma_aba_inicial', pendInicio: 'nilma_pend_inicio', lateral: 'nilma_lateral',
    visaoPendencias: 'nilma_cobranca_visao', consultaModo: 'nilma_cq_modo'
  };
  // Jeito de trabalhar de cada aparelho (tela pequena x monitor): fica só nele.
  var SO_APARELHO = { lateral: true, visaoPendencias: true, consultaModo: true };
  function lerLocal(campo, padrao) {
    try { return localStorage.getItem(CHAVE_LOCAL[campo] || 'nilma_' + campo) || padrao; } catch (e) { return padrao; }
  }
  function valorTema() {
    var t = doc.documentElement.dataset.theme;
    return t === 'light' ? 'claro' : t === 'dark' ? 'escuro' : 'auto';
  }
  function aplicarPadrao(campo, valor) {
    if (campo === 'lateral' && janela.NilmaShell && typeof janela.NilmaShell.recolherLateral === 'function') {
      janela.NilmaShell.recolherLateral(valor === 'recolhida');
      return;
    }
    if (campo !== 'tema') return;
    if (janela.NilmaUI && typeof janela.NilmaUI.aplicar === 'function') { janela.NilmaUI.aplicar('tema', valor); return; }
    var r = doc.documentElement;
    if (valor === 'claro') r.dataset.theme = 'light';
    else if (valor === 'escuro') r.dataset.theme = 'dark';
    else delete r.dataset.theme;
  }
  // Freio: grava só se mudou. A tela pode assumir a gravação (o Entregas tem
  // as suas funções de salvar); senão, aparelho + conta.
  function salvarPreferencia(campo, valor, atual) {
    if (valor === atual) return;
    if (typeof o.salvar === 'function' && o.salvar(campo, valor) === true) return;
    try { localStorage.setItem(CHAVE_LOCAL[campo] || 'nilma_' + campo, valor); } catch (e) {}
    aplicarPadrao(campo, valor);
    if (typeof o.aplicar === 'function') o.aplicar(campo, valor);
    var u = contaFirebase();
    if (u && o.db && !SO_APARELHO[campo]) {
      var dados = {}; dados[campo] = valor;
      o.db.collection('usuarios').doc(u.uid).update(dados).catch(function () {});
    }
  }

  // ------------------------------------------------------------ tópicos
  var SECOES = [
    { id: 'conta', grupo: 'Conta', rotulo: 'Minha conta', icone: 'ph-user-circle',
      titulo: 'Minha conta', sub: 'Seu perfil, o login e a senha', busca: 'perfil foto nome email e-mail cargo senha sair login' },
    { id: 'notificacoes', grupo: 'Conta', rotulo: 'Notificações', icone: 'ph-bell',
      titulo: 'Notificações', sub: 'Avisos neste aparelho', busca: 'notificacao aviso celular push alerta teste desativar' },
    { id: 'aparencia', grupo: 'Preferências', rotulo: 'Aparência', icone: 'ph-paint-brush',
      titulo: 'Aparência', sub: 'Cores e o jeito da tela', busca: 'tema claro escuro sistema aparencia barra lateral recolher' },
    { id: 'telas', grupo: 'Preferências', rotulo: 'Telas e listas', icone: 'ph-squares-four',
      titulo: 'Telas e listas', sub: 'Onde cada tela abre e como as listas aparecem', busca: 'abrir inicial aba entregas pendencias cartoes lista pdf drive leitor navegador' },
    { id: 'consulta', grupo: 'Preferências', rotulo: 'Consulta rápida', icone: 'ph-chats-circle',
      titulo: 'Consulta rápida', sub: 'A caixa "Perguntar à IA" da barra de cima', busca: 'ia consulta rapida pergunta claude resposta' },
    { id: 'aplicativo', grupo: 'Aplicativo', rotulo: 'Instalação e versão', icone: 'ph-device-mobile',
      titulo: 'Instalação e versão', sub: 'O app neste aparelho e os atalhos de teclado', busca: 'instalar tela inicial versao atualizar cache atalho teclado' },
    { id: 'integracoes', grupo: 'Escritório', rotulo: 'Integrações', icone: 'ph-plugs-connected', soAdmin: true,
      titulo: 'Integrações', sub: 'O que o sistema usa por trás: robô, Gmail, IA, backup e banco', busca: 'robo gmail ia claude gemini integracao drive backup banco leituras' }
  ];
  function secoesVisiveis() { return SECOES.filter(function (s) { return !s.soAdmin || ehAdmin(); }); }

  // ------------------------------------------------------------ montagem
  var CSS =
    'dialog.ncfg{position:fixed;inset:0;margin:auto;padding:0;border:1px solid var(--border);border-radius:12px;' +
      'width:min(1080px,calc(100vw - 48px));height:min(720px,calc(100vh - 48px));max-width:none;max-height:none;' +
      'background:var(--surface);color:var(--ink);box-shadow:var(--shadow-lg);overflow:hidden}' +
    'dialog.ncfg[open]{display:flex;animation:popIn .16s ease-out both}' +
    'dialog.ncfg::backdrop{background:#1F232866}' +
    ':root[data-theme="dark"] dialog.ncfg::backdrop{background:#01040999}' +
    '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) dialog.ncfg::backdrop{background:#01040999}}' +
    /* barra lateral */
    '.ncfg-lado{flex:none;width:248px;display:flex;flex-direction:column;gap:4px;padding:12px 8px;border-right:1px solid var(--border);background:var(--surface-2);overflow-y:auto}' +
    '.ncfg-busca{display:flex;align-items:center;gap:8px;margin:0 4px 8px;padding:0 10px;height:32px;border:1px solid var(--border);border-radius:6px;background:var(--surface)}' +
    '.ncfg-busca:focus-within{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}' +
    '.ncfg-busca .ph{flex:none;font-size:16px;color:var(--ink-muted)}' +
    /* a folha da página desenha todo input: aqui a caixa é a .ncfg-busca */
    '.ncfg .ncfg-busca input{flex:1;min-width:0;height:auto;min-height:0;margin:0;padding:0;border:0;border-radius:0;outline:0;box-shadow:none;background:none;' +
      'color:var(--ink);font:inherit;font-size:14px;-webkit-appearance:none;appearance:none}' +
    '.ncfg .ncfg-busca input::-webkit-search-cancel-button{-webkit-appearance:none;display:none}' +
    '.ncfg-grupo{margin:10px 12px 4px;font-size:12px;font-weight:600;color:var(--ink-muted)}' +
    '.ncfg-item{display:flex;align-items:center;gap:10px;width:100%;min-height:32px;padding:6px 12px;border:0;border-radius:6px;background:none;' +
      'color:var(--ink);font:inherit;font-size:14px;text-align:left;cursor:pointer}' +
    '.ncfg-item:hover{background:var(--hover-bg)}' +
    '.ncfg-item[aria-current="page"]{background:var(--hover-bg);font-weight:600}' +
    '.ncfg-item .ph{flex:none;font-size:16px;color:var(--ink-muted)}' +
    '.ncfg-item .ncfg-mini{flex:none;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:600;' +
      'background:var(--surface-3) center/cover no-repeat;border:1px solid var(--border)}' +
    '.ncfg-item span.rot{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.ncfg-nada{margin:8px 12px;font-size:13px;color:var(--ink-muted)}' +
    /* conteúdo */
    '.ncfg-conteudo{flex:1;min-width:0;overflow-y:auto;position:relative}' +
    '.ncfg-fechar{position:absolute;top:10px;right:10px;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;' +
      'border:0;border-radius:6px;background:none;color:var(--ink-muted);cursor:pointer;font-size:16px;z-index:1}' +
    '.ncfg-fechar:hover{background:var(--hover-bg);color:var(--ink)}' +
    '.ncfg-pagina{max-width:720px;margin:0 auto;padding:32px 32px 48px}' +
    '.ncfg-pagina h1{margin:0;font-size:20px;font-weight:600;line-height:28px}' +
    '.ncfg-pagina .ncfg-sub{margin:4px 0 24px;font-size:14px;color:var(--ink-muted)}' +
    /* cartões no desenho da ficha do cliente */
    '.ncfg-cartao{margin-bottom:16px;border:1px solid var(--border);border-radius:6px;background:var(--surface);overflow:hidden}' +
    '.ncfg-cartao-cab{display:flex;align-items:center;gap:8px;min-height:44px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--surface-2)}' +
    '.ncfg-cartao-cab h2{margin:0;font-size:14px;font-weight:600;line-height:20px}' +
    '.ncfg-linha{display:flex;align-items:center;gap:16px;padding:12px 16px}' +
    '.ncfg-linha+.ncfg-linha{border-top:1px solid var(--border-muted,var(--border))}' +
    '.ncfg-linha .txt{flex:1;min-width:0}' +
    '.ncfg-linha .rot{font-size:14px;font-weight:500;color:var(--ink)}' +
    '.ncfg-linha .desc{margin-top:2px;font-size:12px;line-height:16px;color:var(--ink-muted);overflow-wrap:anywhere}' +
    '.ncfg-linha .ctl{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}' +
    '.ncfg-linha.coluna{flex-direction:column;align-items:stretch}' +
    '.ncfg-valor{font-size:14px;color:var(--ink);text-align:right;overflow-wrap:anywhere}' +
    '.ncfg-foto{width:56px;height:56px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--surface-3) center/cover no-repeat;' +
      'border:1px solid var(--border);font-size:18px;font-weight:600;color:var(--ink)}' +
    '.ncfg-arquivo{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}' +
    /* controles */
    '.ncfg-botao{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 12px;border:1px solid var(--btn-border);' +
      'border-radius:6px;background:var(--btn-bg);color:var(--ink);font:inherit;font-size:14px;font-weight:500;line-height:20px;cursor:pointer;white-space:nowrap;box-shadow:var(--shadow-xs)}' +
    'a.ncfg-botao,a.ncfg-botao:hover{text-decoration:none}' +
    '.ncfg-botao:hover:not(:disabled){background:var(--btn-hover)}' +
    '.ncfg-botao:disabled{opacity:.55;cursor:not-allowed}' +
    '.ncfg-botao .ph{font-size:16px;color:var(--ink-muted)}' +
    '.ncfg-botao.primario{background:var(--btn-primary);border-color:var(--btn-primary-border);color:#FFFFFF}' +
    '.ncfg-botao.primario .ph{color:inherit}' +
    '.ncfg-botao.primario:hover:not(:disabled){background:var(--btn-primary-hover)}' +
    '.ncfg-botao.perigo{color:var(--destructive)}' +
    '.ncfg-botao.perigo .ph{color:inherit}' +
    '.ncfg-botao.leve{border-color:transparent;background:none;box-shadow:none;color:var(--ink-muted)}' +
    '.ncfg-botao.leve:hover:not(:disabled){background:var(--hover-bg);color:var(--ink)}' +
    '.ncfg-seg{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:6px;background:var(--surface-3)}' +
    '.ncfg-seg button{display:inline-flex;align-items:center;gap:6px;min-height:28px;margin:-1px;padding:3px 10px;border:1px solid transparent;border-radius:6px;' +
      'background:transparent;color:var(--ink-muted);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}' +
    '.ncfg-seg button:hover{color:var(--ink)}' +
    '.ncfg-seg button[aria-pressed="true"]{background:var(--surface);border-color:var(--border-strong);color:var(--ink);font-weight:500}' +
    '.ncfg-seg .ph{font-size:15px}' +
    '.ncfg select,.ncfg input[type=password]{min-height:32px;padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink);font:inherit;font-size:14px}' +
    '.ncfg select:focus,.ncfg input[type=password]:focus{outline:none;border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}' +
    '.ncfg input.ncfg-texto{width:220px;min-height:32px;padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink);font:inherit;font-size:14px}' +
    '.ncfg input.ncfg-texto:focus{outline:none;border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}' +
    '.ncfg-tecla{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:24px;padding:0 6px;border:1px solid var(--border);' +
      'border-bottom-width:2px;border-radius:5px;background:var(--surface-2);color:var(--ink);font:inherit;font-size:12px;font-weight:600}' +
    '.ncfg-senha{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}' +
    '.ncfg-senha label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600;color:var(--ink-muted)}' +
    '.ncfg-senha .acoes{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end}' +
    '.ncfg-erro{grid-column:1/-1;font-size:12px;color:var(--destructive)}' +
    '.ncfg-erro:empty{display:none}' +
    '.ncfg-selo{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:2em;border:1px solid var(--border);font-size:12px;font-weight:500;white-space:nowrap;color:var(--ink-muted)}' +
    '.ncfg-selo::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}' +
    '.ncfg-selo.ok{color:var(--success);border-color:color-mix(in srgb,var(--success) 40%,transparent)}' +
    '.ncfg-selo.ruim{color:var(--destructive);border-color:color-mix(in srgb,var(--destructive) 40%,transparent)}' +
    '.ncfg-toast{position:fixed;left:16px;bottom:16px;z-index:9999;max-width:min(420px,calc(100% - 32px));background:var(--surface);color:var(--ink);border:1px solid var(--border);' +
      'border-left:4px solid var(--accent);border-radius:6px;padding:12px 16px;font-size:14px;box-shadow:var(--shadow-lg)}' +
    '.ncfg-toast.erro{border-left-color:var(--destructive)}' +
    /* celular: a janela ocupa a tela; os tópicos viram uma faixa rolável em cima */
    '@media (max-width:700px){' +
      'dialog.ncfg{width:100vw;height:100dvh;border:0;border-radius:0}' +
      'dialog.ncfg[open]{flex-direction:column}' +
      '.ncfg-lado{width:auto;flex-direction:row;align-items:center;gap:4px;padding:8px 52px 8px 8px;border-right:0;border-bottom:1px solid var(--border);overflow-x:auto;overflow-y:hidden}' +
      '.ncfg-busca{flex:none;width:150px;margin:0 4px 0 0}' +
      '#ncfgTopicos{display:contents}' +
      '.ncfg-nada{flex:none;white-space:nowrap}' +
      '.ncfg-grupo{display:none}' +
      '.ncfg-item{width:auto;flex:none}' +
      '.ncfg-fechar{position:fixed;top:8px;right:8px;background:var(--surface-2)}' +
      '.ncfg-pagina{padding:20px 16px 40px}' +
      '.ncfg-linha{flex-wrap:wrap;gap:10px 16px}' +
      '.ncfg-linha .txt{flex-basis:100%}' +
      '.ncfg-linha .ctl{justify-content:flex-start}' +
      '.ncfg-senha{grid-template-columns:1fr}' +
    '}';

  function montar() {
    if (caixa) return caixa;
    if (!$('ncfgEstilo')) {
      var s = doc.createElement('style');
      s.id = 'ncfgEstilo'; s.textContent = CSS;
      doc.head.appendChild(s);
    }
    caixa = doc.createElement('dialog');
    caixa.className = 'ncfg';
    caixa.id = 'nilmaConfig';
    caixa.setAttribute('aria-label', 'Configurações');
    caixa.innerHTML =
      '<nav class="ncfg-lado" aria-label="Tópicos das configurações">' +
        '<label class="ncfg-busca"><i class="ph ph-magnifying-glass" aria-hidden="true"></i>' +
          '<input type="search" id="ncfgBusca" placeholder="Buscar nas configurações" aria-label="Buscar nas configurações" autocomplete="off"></label>' +
        '<div id="ncfgTopicos"></div>' +
      '</nav>' +
      '<div class="ncfg-conteudo" id="ncfgConteudo">' +
        '<button type="button" class="ncfg-fechar" id="ncfgFechar" aria-label="Fechar"><i class="ph ph-x" aria-hidden="true"></i></button>' +
        '<div class="ncfg-pagina" id="ncfgPagina"></div>' +
      '</div>';
    doc.body.appendChild(caixa);
    $('ncfgFechar').addEventListener('click', fechar);
    caixa.addEventListener('click', function (ev) { if (ev.target === caixa) fechar(); });
    caixa.addEventListener('close', function () { busca = ''; trocandoSenha = false; });
    $('ncfgBusca').addEventListener('input', function () {
      busca = semAcento(this.value.trim());
      var achadas = secoesComBusca();
      if (achadas.length && achadas.indexOf(secaoAtual) === -1) secaoAtual = achadas[0];
      desenhar();
    });
    $('ncfgTopicos').addEventListener('click', function (ev) {
      var b = ev.target.closest('.ncfg-item');
      if (!b) return;
      secaoAtual = b.dataset.secao;
      trocandoSenha = false;
      desenhar();
      $('ncfgConteudo').scrollTop = 0;
    });
    // outra aba mudou o tema: a janela acompanha
    janela.addEventListener('storage', function (ev) { if (caixa.open && ev.key && ev.key.indexOf('nilma_') === 0) desenharPagina(); });
    return caixa;
  }

  // ------------------------------------------------------------ busca
  // A busca olha o nome do tópico, as palavras dele e o texto de cada linha.
  function secoesComBusca() {
    return secoesVisiveis().filter(function (s) {
      if (!busca) return true;
      return semAcento(s.rotulo + ' ' + s.titulo + ' ' + s.busca).indexOf(busca) !== -1 ||
        linhasDe(s.id).some(function (l) { return semAcento(l).indexOf(busca) !== -1; });
    }).map(function (s) { return s.id; });
  }
  // texto pesquisável de cada linha, por tópico (o mesmo que aparece na tela)
  function linhasDe(id) {
    return {
      conta: ['Foto de perfil', 'Nome', 'E-mail', 'Cargos', 'Senha', 'Sair da conta'],
      notificacoes: ['Avisos neste aparelho', 'Aviso de teste', 'Desativar'],
      aparencia: ['Tema claro escuro sistema', 'Barra lateral aberta recolhida'],
      telas: ['Abrir o Entregas em', 'Abrir a Pendências em', 'Clientes da Pendências lista cartões', 'Abrir PDFs do Drive leitor do computador navegador'],
      consulta: ['Resposta padrão rápida com IA'],
      aplicativo: ['Instalar na tela inicial', 'Versão', 'Buscar a versão mais nova', 'Atalhos de teclado'],
      integracoes: ['Robô da nuvem', 'Gmail', 'IA da Consulta rápida', 'Backup', 'Uso do banco hoje']
    }[id] || [];
  }
  function combina(texto) { return !busca || semAcento(texto).indexOf(busca) !== -1; }

  // ------------------------------------------------------------ desenho
  function desenhar() {
    var visiveis = secoesVisiveis();
    if (!visiveis.some(function (s) { return s.id === secaoAtual; })) secaoAtual = 'conta';
    var achadas = secoesComBusca();
    var u = usuario();
    var html = '', grupo = '';
    visiveis.forEach(function (s) {
      if (achadas.indexOf(s.id) === -1) return;
      if (s.grupo !== grupo) { grupo = s.grupo; html += '<div class="ncfg-grupo">' + esc(grupo) + '</div>'; }
      // Minha conta vem com a foto e o nome da pessoa, como no Notion.
      var icone = s.id === 'conta'
        ? '<span class="ncfg-mini" style="' + (fotoAtual || u.foto ? 'background-image:url(&quot;' + esc(fotoAtual || u.foto) + '&quot;)' : '') + '">' + (fotoAtual || u.foto ? '' : esc(iniciais(u.nome))) + '</span>'
        : '<i class="ph ' + s.icone + '" aria-hidden="true"></i>';
      var rotulo = s.id === 'conta' && u.nome ? u.nome : s.rotulo;
      html += '<button type="button" class="ncfg-item" data-secao="' + s.id + '"' + (s.id === secaoAtual ? ' aria-current="page"' : '') + ' title="' + esc(s.rotulo) + '">' +
        icone + '<span class="rot">' + esc(rotulo) + '</span></button>';
    });
    if (!achadas.length) html = '<div class="ncfg-nada">Nada encontrado.</div>';
    $('ncfgTopicos').innerHTML = html;
    desenharPagina();
  }

  function secao(id) { return SECOES.filter(function (s) { return s.id === id; })[0]; }
  function cartao(titulo, linhas) {
    linhas = linhas.filter(Boolean);
    if (!linhas.length) return '';
    return '<section class="ncfg-cartao"><div class="ncfg-cartao-cab"><h2>' + esc(titulo) + '</h2></div>' + linhas.join('') + '</section>';
  }
  // linha: some da tela quando a busca não bate com o texto dela
  function linha(rotulo, desc, controle, extra) {
    if (!combina(rotulo + ' ' + (desc || '') + ' ' + ((extra && extra.busca) || ''))) return '';
    return '<div class="ncfg-linha' + (extra && extra.coluna ? ' coluna' : '') + '"' + (extra && extra.id ? ' id="' + extra.id + '"' : '') + '>' +
      '<div class="txt"><div class="rot">' + esc(rotulo) + '</div>' + (desc ? '<div class="desc">' + esc(desc) + '</div>' : '') + '</div>' +
      (controle ? '<div class="ctl">' + controle + '</div>' : '') + (extra && extra.depois ? extra.depois : '') + '</div>';
  }
  function seg(campo, atual, opcoes) {
    return '<div class="ncfg-seg" role="group" data-campo="' + campo + '">' + opcoes.map(function (op) {
      return '<button type="button" data-valor="' + op[0] + '" aria-pressed="' + (op[0] === atual) + '">' +
        (op[2] ? '<i class="ph ' + op[2] + '" aria-hidden="true"></i>' : '') + esc(op[1]) + '</button>';
    }).join('') + '</div>';
  }

  function desenharPagina() {
    var s = secao(secaoAtual);
    var pag = $('ncfgPagina');
    var corpo = ({ conta: paginaConta, notificacoes: paginaNotificacoes, aparencia: paginaAparencia, telas: paginaTelas,
      consulta: paginaConsulta, aplicativo: paginaAplicativo, integracoes: paginaIntegracoes })[s.id]();
    pag.innerHTML = '<h1>' + esc(s.titulo) + '</h1><p class="ncfg-sub">' + esc(s.sub) + '</p>' +
      (corpo || '<div class="ncfg-nada" style="margin:0">Nada encontrado neste tópico.</div>');
    ligarPagina(s.id);
  }

  // ---------------- Minha conta
  function paginaConta() {
    var u = usuario();
    var conta = contaFirebase();
    var foto = fotoAtual || u.foto || '';
    var fotoHtml = '<span class="ncfg-foto" id="ncfgFoto" style="' + (foto ? 'background-image:url(&quot;' + esc(foto) + '&quot;)' : '') + '">' + (foto ? '' : esc(iniciais(u.nome))) + '</span>';
    var nomesCargos = cargos().map(function (c) { return NOME_CARGO[c] || c; }).join(', ');
    return cartao('Perfil', [
      linha('Foto de perfil', 'Aparece no canto de cima e nas entregas que você registra.',
        fotoHtml + '<input type="file" accept="image/*" id="ncfgFotoArquivo" class="ncfg-arquivo">' +
        '<label class="ncfg-botao" for="ncfgFotoArquivo"><i class="ph ph-camera" aria-hidden="true"></i> Escolher foto</label>' +
        (foto ? '<button type="button" class="ncfg-botao leve" id="ncfgFotoRemover">Remover</button>' : '')),
      linha('Nome', 'Como você aparece pra equipe: nas entregas, cobranças e solicitações.',
        '<input type="text" id="ncfgNome" class="ncfg-texto" maxlength="60" autocomplete="name" value="' + esc(u.nome || '') + '" aria-label="Nome">' +
        '<button type="button" class="ncfg-botao" id="ncfgNomeSalvar" hidden>Salvar</button>'),
      linha('E-mail', 'Usado para entrar.', '<span class="ncfg-valor">' + esc((conta && conta.email) || '—') + '</span>'),
      nomesCargos ? linha('Cargos', 'Quem muda é um admin, em Clientes e ajustes.', '<span class="ncfg-valor">' + esc(nomesCargos) + '</span>') : ''
    ]) + cartao('Segurança', [
      linha('Senha', 'Troque a senha que você usa para entrar.',
        trocandoSenha ? '' : '<button type="button" class="ncfg-botao" id="ncfgSenhaAbrir"><i class="ph ph-key" aria-hidden="true"></i> Trocar senha</button>',
        { coluna: trocandoSenha, depois: trocandoSenha ?
          '<form class="ncfg-senha" id="ncfgSenhaForm" novalidate>' +
            '<label>Senha atual<input type="password" id="ncfgSenhaAtual" autocomplete="current-password" required></label>' +
            '<label>Nova senha<input type="password" id="ncfgSenhaNova" autocomplete="new-password" placeholder="Mínimo 6 caracteres" required></label>' +
            '<div class="ncfg-erro" id="ncfgSenhaErro" role="alert"></div>' +
            '<div class="acoes"><button type="button" class="ncfg-botao leve" id="ncfgSenhaCancelar">Cancelar</button>' +
              '<button type="submit" class="ncfg-botao primario">Salvar nova senha</button></div>' +
          '</form>' : '' }),
      typeof o.sair === 'function' ? linha('Sair da conta', 'Sai neste aparelho.',
        '<button type="button" class="ncfg-botao perigo" id="ncfgSair"><i class="ph ph-sign-out" aria-hidden="true"></i> Sair</button>') : ''
    ]);
  }

  // ---------------- Aparência
  function paginaAparencia() {
    return cartao('Cores', [
      linha('Tema', 'Vale em todas as telas, em qualquer aparelho seu.',
        seg('tema', valorTema(), [['claro', 'Claro', 'ph-sun'], ['escuro', 'Escuro', 'ph-moon'], ['auto', 'Sistema', 'ph-desktop']]),
        { busca: 'claro escuro sistema aparencia' })
    ]) + cartao('Barra lateral', [
      linha('Barra lateral', 'Recolhida, fica só com os ícones e a tela usa a largura toda. Neste aparelho (no computador).',
        seg('lateral', lerLocal('lateral', 'aberta'), [['aberta', 'Aberta', 'ph-caret-left'], ['recolhida', 'Recolhida', 'ph-caret-right']]),
        { busca: 'recolher icones largura' })
    ]);
  }

  // ---------------- Telas e listas
  function opcoesSelect(id, rotulo, atual, opcoes) {
    return '<select id="' + id + '" aria-label="' + esc(rotulo) + '">' + opcoes.map(function (a) {
      return '<option value="' + a[0] + '"' + (a[0] === atual ? ' selected' : '') + '>' + esc(a[1]) + '</option>';
    }).join('') + '</select>';
  }
  function paginaTelas() {
    var abas = [['nova', 'Nova entrega'], ['rota', 'Rota'], ['painel', 'Painel'], ['solicitacoes', 'Solicitações'], ['clientes', 'Clientes e ajustes']]
      .concat(ehAdmin() || cargos().indexOf('office_boy') !== -1 ? [['honorarios', 'Honorários']] : []);
    var pend = [['hoje', 'Hoje'], ['clientes', 'Clientes'], ['robo', 'Robô do Gmail'], ['cobrancas', 'Cobranças']]
      .concat(ehAdmin() || cargos().indexOf('contabil') !== -1 ? [['arquivo', 'Arquivo']] : []);
    return cartao('Ao abrir', [
      linha('Abrir o Entregas em', 'A tela que aparece primeiro quando você abre o Entregas.',
        opcoesSelect('ncfgAbaInicial', 'Abrir o Entregas em', lerLocal('abaInicial', 'nova'), abas), { busca: 'app inicial aba' }),
      linha('Abrir a Pendências em', 'A tela que aparece primeiro quando você abre a Pendências.',
        opcoesSelect('ncfgPendInicio', 'Abrir a Pendências em', lerLocal('pendInicio', 'hoje'), pend), { busca: 'inicial cobranca' })
    ]) + cartao('Listas e arquivos', [
      linha('Clientes da Pendências', 'Em lista (uma linha por cliente) ou em cartões, com o gráfico dos últimos meses. Neste aparelho.',
        seg('visaoPendencias', lerLocal('visaoPendencias', 'lista'), [['lista', 'Lista', 'ph-list-bullets'], ['cartoes', 'Cartões', 'ph-squares-four']]),
        { busca: 'cartoes lista grafico' }),
      linha('Abrir PDFs do Drive', 'No leitor do computador, o PDF é baixado e abre no seu programa de PDF.',
        seg('abrirPdf', lerLocal('abrirPdf', 'navegador'), [['navegador', 'No navegador'], ['leitor', 'No leitor do computador']]),
        { busca: 'arquivo pasta pdf drive' })
    ]);
  }

  // ---------------- Consulta rápida
  function paginaConsulta() {
    return cartao('Resposta', [
      linha('Resposta padrão', 'Rápida busca na hora, no próprio aparelho. Com IA entende perguntas abertas, mas depende do PC do escritório ligado. Neste aparelho.',
        seg('consultaModo', lerLocal('consultaModo', 'rapida'), [['rapida', 'Rápida', 'ph-lightning'], ['ia', 'Com IA', 'ph-sparkle']]),
        { busca: 'rapida ia claude' })
    ]);
  }

  // ---------------- Notificações
  function estadoNotificacao() {
    if (!('Notification' in janela)) return 'sem';
    return Notification.permission;   // granted | denied | default
  }
  var CHAVE_AVISOS_DESLIGADOS = 'nilma_avisos_desligados';
  function avisosDesligadosAqui() { try { return localStorage.getItem(CHAVE_AVISOS_DESLIGADOS) === '1'; } catch (e) { return false; } }
  function paginaNotificacoes() {
    var est = estadoNotificacao();
    var ligados = est === 'granted' && !avisosDesligadosAqui();
    var selo = ligados ? '<span class="ncfg-selo ok">Ligados</span>'
      : est === 'denied' ? '<span class="ncfg-selo ruim">Bloqueados</span>'
      : est === 'sem' ? '<span class="ncfg-selo">Sem suporte</span>' : '<span class="ncfg-selo">Desligados</span>';
    var botao = est === 'sem' || est === 'denied' ? ''
      : '<button type="button" class="ncfg-botao" id="ncfgNotifAtivar"><i class="ph ph-bell-simple-ringing" aria-hidden="true"></i> ' + (ligados ? 'Reativar' : 'Ativar') + '</button>';
    var desc = est === 'denied' ? 'O navegador bloqueou. Libere nas permissões do site (cadeado ao lado do endereço) e volte aqui.'
      : est === 'sem' ? 'Este navegador não recebe avisos. No iPhone, instale o app na tela inicial primeiro.'
      : 'Paradas novas, entrega não realizada, lembretes e documentos vencendo, conforme o seu cargo.';
    return cartao('Neste aparelho', [
      linha('Avisos', desc, selo + botao, { busca: 'notificacao push celular' }),
      ligados ? linha('Aviso de teste', 'Mostra um aviso agora, pra conferir se aparece neste aparelho.',
        '<button type="button" class="ncfg-botao" id="ncfgNotifTeste"><i class="ph ph-bell" aria-hidden="true"></i> Enviar teste</button>') : '',
      ligados ? linha('Desativar neste aparelho', 'Os avisos param de chegar aqui; nos seus outros aparelhos continuam.',
        '<button type="button" class="ncfg-botao perigo" id="ncfgNotifDesligar"><i class="ph ph-bell-slash" aria-hidden="true"></i> Desativar</button>') : ''
    ]);
  }

  // ---------------- Aplicativo
  function instalado() { return (janela.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function paginaAplicativo() {
    var podeInstalar = o.instalar && typeof o.instalar.pode === 'function' && o.instalar.pode();
    return cartao('Neste aparelho', [
      instalado() ? linha('Instalar na tela inicial', '', '<span class="ncfg-selo ok">Instalado</span>')
        : podeInstalar ? linha('Instalar na tela inicial', 'Abre como aplicativo, sem a barra do navegador.',
          '<button type="button" class="ncfg-botao" id="ncfgInstalar"><i class="ph ph-download-simple" aria-hidden="true"></i> Instalar</button>') : '',
      linha('Versão', '', '<span class="ncfg-valor">' + esc(o.versao || '—') + '</span>'),
      linha('Buscar a versão mais nova', 'Apaga os arquivos guardados pelo navegador e abre de novo. Resolve tela velha ou barra sumida.',
        '<button type="button" class="ncfg-botao" id="ncfgAtualizar"><i class="ph ph-arrows-clockwise" aria-hidden="true"></i> Atualizar</button>',
        { busca: 'cache recarregar' })
    ]) + cartao('Atalhos de teclado', [
      linha('Perguntar à IA', 'Abre a caixa da barra de cima.', '<kbd class="ncfg-tecla">/</kbd>', { busca: 'atalho teclado' }),
      linha('Busca', 'Procura cliente, entrega ou tela (no Entregas).', '<kbd class="ncfg-tecla">Ctrl</kbd><kbd class="ncfg-tecla">K</kbd>', { busca: 'atalho teclado' }),
      linha('Fechar', 'Fecha a janela, o painel ou o menu aberto.', '<kbd class="ncfg-tecla">Esc</kbd>', { busca: 'atalho teclado' })
    ]);
  }

  // ---------------- Integrações (admin, só leitura)
  var roboLido = null, lendoRobo = false;
  function tempo(iso) {
    var ms = Date.parse(iso || '');
    if (!ms) return '';
    var min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 48) return 'há ' + h + ' h';
    return 'há ' + Math.round(h / 24) + ' dias';
  }
  function paginaIntegracoes() {
    if (!roboLido) {
      // Uma leitura só, ao abrir o tópico (sem ouvinte ligado).
      if (!lendoRobo && o.db) {
        lendoRobo = true;
        Promise.all([o.db.collection('robo').doc('estado').get(), o.db.collection('robo').doc('uso').get().catch(function () { return null; })])
          .then(function (r) { roboLido = r[0].exists ? r[0].data() : {}; roboLido.usoDoBanco = r[1] && r[1].exists ? r[1].data() : null; })
          .catch(function () { roboLido = { erro: true }; })
          .then(function () { lendoRobo = false; if (caixa && caixa.open && secaoAtual === 'integracoes') desenharPagina(); });
      }
      return cartao('Serviços', [linha('Carregando…', '', '')]);
    }
    var r = roboLido;
    if (r.erro) return cartao('Serviços', [linha('Não consegui ler o estado do robô', 'Tente abrir de novo daqui a pouco.', '')]);
    var vigiaEm = r.vigia && r.vigia.em;
    var vivo = vigiaEm && (Date.now() - Date.parse(vigiaEm)) < 3 * 60 * 1000;
    var ia = r.ia || {};
    var iaEm = ia.em && (Date.now() - Date.parse(ia.em)) < 5 * 60 * 1000;
    var iaOk = !!ia.ligado && (ia.motor !== 'claude' || iaEm);
    return cartao('Serviços', [
      linha('Robô da nuvem', vigiaEm ? 'Último sinal ' + tempo(vigiaEm) + '.' : 'Nenhum sinal registrado.',
        vivo ? '<span class="ncfg-selo ok">Online</span>' : '<span class="ncfg-selo ruim">Sem sinal</span>'),
      linha('Gmail', r.ultimaExecucao ? 'Última leitura ' + tempo(r.ultimaExecucao) + '.' : 'Nenhuma leitura registrada.',
        r.ultimaExecucao ? '<span class="ncfg-selo ok">Lendo</span>' : '<span class="ncfg-selo">Sem registro</span>'),
      linha('IA da Consulta rápida', ia.motor === 'claude' ? 'Claude, no PC do escritório.' : ia.motor ? 'Gemini, na nuvem.' : 'Motor não informado.',
        iaOk ? '<span class="ncfg-selo ok">Ligada</span>' : '<span class="ncfg-selo ruim">' + (ia.motor === 'claude' ? 'PC desligado' : 'Desligada') + '</span>')
    ]) + cartao('Dados', [
      (function () {
        var b = r.backup || {};
        var dias = b.em ? Math.floor((Date.now() - Date.parse(b.em)) / 864e5) : null;
        var ok = b.ok !== false && dias !== null && dias <= 3;
        return linha('Backup', b.ok === false ? 'O último backup falhou.' : b.em ? 'Último ' + tempo(b.em) + (b.resumo ? ' · ' + b.resumo : '') + '.' : 'Nenhum backup registrado.',
          ok ? '<span class="ncfg-selo ok">Em dia</span>' : '<span class="ncfg-selo ruim">Ver</span>');
      })(),
      (function () {
        var u = r.usoDoBanco;
        if (!u || u.erro || typeof u.leituras !== 'number') return linha('Uso do banco hoje', 'O robô ainda não trouxe os números do Google.', '<span class="ncfg-selo">Sem dado</span>');
        var pct = Math.round(u.leituras / 50000 * 100);
        return linha('Uso do banco hoje', u.leituras.toLocaleString('pt-BR') + ' de 50.000 leituras (' + pct + '%) · ' + (u.gravacoes || 0).toLocaleString('pt-BR') + ' gravações · ' + tempo(u.em) + '.',
          pct >= 80 ? '<span class="ncfg-selo ruim">Perto do limite</span>' : '<span class="ncfg-selo ok">Folgado</span>');
      })()
    ]) + cartao('Editar', [
      linha('Integrações do escritório', 'Motor da IA, serviço de contas e o resto ficam em Clientes e ajustes.',
        '<a class="ncfg-botao" href="entregas.html#clientes"><i class="ph ph-arrow-square-out" aria-hidden="true"></i> Abrir Ajustes</a>')
    ]);
  }

  // ------------------------------------------------------------ eventos da página
  function ligarPagina(id) {
    var pag = $('ncfgPagina');
    pag.querySelectorAll('.ncfg-seg').forEach(function (g) {
      g.addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-valor]');
        if (!b) return;
        var campo = g.dataset.campo;
        var atual = campo === 'tema' ? valorTema() : lerLocal(campo, '');
        salvarPreferencia(campo, b.dataset.valor, atual);
        g.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      });
    });
    var sel = $('ncfgAbaInicial');
    if (sel) sel.addEventListener('change', function () { salvarPreferencia('abaInicial', sel.value, lerLocal('abaInicial', 'nova')); });
    var selP = $('ncfgPendInicio');
    if (selP) selP.addEventListener('change', function () { salvarPreferencia('pendInicio', selP.value, lerLocal('pendInicio', 'hoje')); });

    if (id === 'conta') {
      var arq = $('ncfgFotoArquivo');
      if (arq) arq.addEventListener('change', function (ev) {
        var f = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!f) return;
        reduzirImagem(f, 256, 0.82).then(salvarFoto).catch(function () { avisar('Não foi possível processar a foto.', 'error'); });
      });
      var rem = $('ncfgFotoRemover');
      if (rem) rem.addEventListener('click', function () { salvarFoto(''); });
      var abrirSenha = $('ncfgSenhaAbrir');
      if (abrirSenha) abrirSenha.addEventListener('click', function () { trocandoSenha = true; desenharPagina(); $('ncfgSenhaAtual').focus(); });
      var cancelar = $('ncfgSenhaCancelar');
      if (cancelar) cancelar.addEventListener('click', function () { trocandoSenha = false; desenharPagina(); });
      var form = $('ncfgSenhaForm');
      if (form) form.addEventListener('submit', trocarSenha);
      var nome = $('ncfgNome'), nomeSalvar = $('ncfgNomeSalvar');
      if (nome) {
        var original = nome.value;
        nome.addEventListener('input', function () { nomeSalvar.hidden = nome.value.trim() === original.trim(); });
        nome.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); if (!nomeSalvar.hidden) nomeSalvar.click(); } });
        nomeSalvar.addEventListener('click', function () { salvarNome(nome.value, nomeSalvar); });
      }
      var sair = $('ncfgSair');
      if (sair) sair.addEventListener('click', function () { fechar(); o.sair(); });
    }
    if (id === 'notificacoes') {
      var at = $('ncfgNotifAtivar');
      if (at) at.addEventListener('click', function () {
        at.disabled = true;
        var ativar = o.notificacoes && typeof o.notificacoes.ativar === 'function' ? o.notificacoes.ativar : ativarAvisos;
        try { localStorage.removeItem(CHAVE_AVISOS_DESLIGADOS); } catch (e) {}
        Promise.resolve(ativar()).catch(function () {}).then(function () {
          // a permissão responde depois do clique: redesenha quando chegar
          setTimeout(function () { if (caixa.open && secaoAtual === 'notificacoes') desenharPagina(); }, 1500);
        });
      });
    }
    var teste = $('ncfgNotifTeste');
    if (teste) teste.addEventListener('click', avisoDeTeste);
    var desligar = $('ncfgNotifDesligar');
    if (desligar) desligar.addEventListener('click', function () {
      desligar.disabled = true;
      desativarAvisos().then(function () { if (caixa.open && secaoAtual === 'notificacoes') desenharPagina(); });
    });
    if (id === 'aplicativo') {
      var inst = $('ncfgInstalar');
      if (inst) inst.addEventListener('click', function () { o.instalar.fazer(); });
      var atu = $('ncfgAtualizar');
      if (atu) atu.addEventListener('click', function () {
        atu.disabled = true;
        var limpar = janela.caches && caches.keys ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }) : Promise.resolve();
        limpar.catch(function () {}).then(function () { location.reload(); });
      });
    }
  }

  // ------------------------------------------------------------ avisos
  // O mesmo registro do Entregas, para as telas que não têm o dele: pede a
  // permissão, pega o endereço de aviso deste aparelho e guarda na conta
  // (usuarios/{uid}.fcmTokens), de onde o robô manda os avisos. O pedaço do
  // Firebase que faz isso só é baixado aqui, no clique.
  var FCM_VAPID_KEY = 'BPSiqKKKrLipFLe-AwrGaCrNLqANd2YcA1wk-sniuxxA2mUCdSRTzKdEaxkpMzf6I8mdE6ucfVJyurGwgKZ_inQ';
  var SDK_MENSAGENS = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js';
  function carregarMensagens() {
    if (o.firebase && typeof o.firebase.messaging === 'function') return Promise.resolve();
    return new Promise(function (ok, falha) {
      var sc = doc.createElement('script');
      sc.src = SDK_MENSAGENS;
      sc.onload = function () { ok(); };
      sc.onerror = function () { falha(new Error('não consegui baixar o módulo de avisos')); };
      doc.head.appendChild(sc);
    });
  }
  function ativarAvisos() {
    var u = contaFirebase();
    if (!u || !o.db || !o.firebase || !('serviceWorker' in navigator) || !('Notification' in janela)) {
      avisar('Este navegador não recebe avisos.', 'error');
      return Promise.resolve();
    }
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { avisar('Permissão de notificação negada.', 'error'); return; }
      return carregarMensagens()
        .then(function () { return navigator.serviceWorker.register('firebase-messaging-sw.js'); })
        .then(function (registro) {
          var m = o.firebase.messaging();
          // token velho guardado no navegador pode estar morto: pede um novo
          return m.deleteToken().catch(function () {}).then(function () {
            return m.getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: registro });
          });
        })
        .then(function (token) {
          if (!token) throw new Error('o navegador não devolveu o endereço de aviso');
          return o.db.collection('usuarios').doc(u.uid).update({ fcmTokens: o.firebase.firestore.FieldValue.arrayUnion(token) });
        })
        .then(function () { avisar('Avisos ligados: chegam mesmo com o app fechado.'); })
        .catch(function (err) { avisar('Não foi possível ligar os avisos: ' + erroDe(err, 'erro'), 'error'); });
    });
  }

  function avisoDeTeste() {
    var titulo = 'Nilma', corpo = 'Aviso de teste: os avisos estão chegando neste aparelho.';
    var mostrar = 'serviceWorker' in navigator && navigator.serviceWorker.getRegistration
      ? navigator.serviceWorker.getRegistration().then(function (reg) {
          if (reg && reg.showNotification) return reg.showNotification(titulo, { body: corpo, tag: 'nilma-teste' });
          new Notification(titulo, { body: corpo, tag: 'nilma-teste' });
        })
      : Promise.resolve().then(function () { new Notification(titulo, { body: corpo, tag: 'nilma-teste' }); });
    mostrar.then(function () { avisar('Aviso de teste enviado.'); })
      .catch(function (err) { avisar('O aviso de teste não saiu: ' + erroDe(err, 'erro'), 'error'); });
  }
  // Tira o endereço de aviso deste aparelho da conta (o robô para de mandar
  // pra cá) e apaga ele do navegador. A permissão do site continua.
  function desativarAvisos() {
    var u = contaFirebase();
    var marcar = function () { try { localStorage.setItem(CHAVE_AVISOS_DESLIGADOS, '1'); } catch (e) {} };
    if (!u || !o.db || !o.firebase || !('serviceWorker' in navigator)) { marcar(); return Promise.resolve(); }
    return carregarMensagens()
      .then(function () { return navigator.serviceWorker.register('firebase-messaging-sw.js'); })
      .then(function (registro) {
        var m = o.firebase.messaging();
        return m.getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: registro }).then(function (token) {
          var tirar = token ? o.db.collection('usuarios').doc(u.uid).update({ fcmTokens: o.firebase.firestore.FieldValue.arrayRemove(token) }) : Promise.resolve();
          return tirar.then(function () { return m.deleteToken().catch(function () {}); });
        });
      })
      .then(function () { marcar(); avisar('Avisos desligados neste aparelho.'); })
      .catch(function (err) { avisar('Não foi possível desligar: ' + erroDe(err, 'erro'), 'error'); });
  }
  function salvarNome(valor, botao) {
    var nome = String(valor || '').replace(/\s+/g, ' ').trim();
    if (nome.length < 2) { avisar('Escreva o nome com pelo menos 2 letras.', 'error'); return; }
    var u = contaFirebase();
    if (!u || !o.db) return;
    botao.disabled = true;
    o.db.collection('usuarios').doc(u.uid).update({ nome: nome })
      .then(function () {
        if (typeof o.aoMudarNome === 'function') o.aoMudarNome(nome);
        avisar('Nome atualizado.');
        desenhar();
      })
      .catch(function (err) { botao.disabled = false; avisar(erroDe(err, 'Não foi possível salvar o nome.'), 'error'); });
  }

  // ------------------------------------------------------------ foto e senha
  function reduzirImagem(arquivo, lado, qualidade) {
    return new Promise(function (ok, falha) {
      var leitor = new FileReader();
      leitor.onerror = falha;
      leitor.onload = function () {
        var img = new Image();
        img.onerror = falha;
        img.onload = function () {
          var escala = Math.min(1, lado / Math.max(img.width, img.height));
          var c = doc.createElement('canvas');
          c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL('image/jpeg', qualidade));
        };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(arquivo);
    });
  }
  // Foto reduzida a 256px: documento do Firestore tem teto de 1 MB.
  function salvarFoto(dataUrl) {
    var u = contaFirebase();
    if (!u || !o.db) return;
    fotoAtual = dataUrl || '';
    if (typeof o.aoMudarFoto === 'function') o.aoMudarFoto(fotoAtual);
    desenhar();
    o.db.collection('usuarios').doc(u.uid).update({ fotoPerfil: fotoAtual })
      .then(function () { avisar(dataUrl ? 'Foto de perfil atualizada.' : 'Foto de perfil removida.'); })
      .catch(function (err) { avisar(erroDe(err, 'Não foi possível salvar a foto.'), 'error'); });
  }
  function trocarSenha(ev) {
    ev.preventDefault();
    var atual = $('ncfgSenhaAtual').value, nova = $('ncfgSenhaNova').value, erro = $('ncfgSenhaErro');
    erro.textContent = '';
    if (!atual) { erro.textContent = 'Digite a senha atual.'; return; }
    if (nova.length < 6) { erro.textContent = 'A nova senha precisa ter ao menos 6 caracteres.'; return; }
    var u = contaFirebase();
    if (!u || !o.firebase) { erro.textContent = 'Sem conexão com a conta agora.'; return; }
    var botao = ev.target.querySelector('button[type=submit]');
    botao.disabled = true;
    var cred = o.firebase.auth.EmailAuthProvider.credential(u.email, atual);
    u.reauthenticateWithCredential(cred)
      .then(function () { return u.updatePassword(nova); })
      .then(function () { avisar('Senha alterada.'); trocandoSenha = false; desenharPagina(); })
      .catch(function (err) {
        erro.textContent = err && (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') ? 'Senha atual incorreta.' : erroDe(err, 'Não foi possível trocar a senha.');
        botao.disabled = false;
      });
  }

  // ------------------------------------------------------------ abrir e fechar
  function abrir(qual) {
    montar();
    var u = usuario();
    fotoAtual = u.foto || '';
    if (qual === 'preferencias') qual = 'aparencia';
    if (qual && secao(qual)) secaoAtual = qual;
    if (qual === 'integracoes') roboLido = null;   // abre com o estado de agora
    busca = '';
    trocandoSenha = false;
    $('ncfgBusca').value = '';
    desenhar();
    $('ncfgConteudo').scrollTop = 0;
    if (!caixa.open) caixa.showModal();
    if (!(janela.matchMedia && matchMedia('(hover: none)').matches)) $('ncfgBusca').focus();
    else caixa.focus();
  }
  function fechar() { if (caixa && caixa.open) caixa.close(); }

  var linkPendente = false;
  function ligar(opcoes) {
    o = Object.assign(o, opcoes || {});
    // ?config=notificacoes (vindo de outra tela): abre depois do login
    if (!linkPendente && o.auth && /[?&]config=/.test(location.search)) {
      linkPendente = true;
      var qual = new URLSearchParams(location.search).get('config');
      var parar = o.auth.onAuthStateChanged(function (user) {
        if (!user) return;
        if (typeof parar === 'function') parar();
        setTimeout(function () {
          abrir(qual);
          try {
            var url = new URL(location.href);
            url.searchParams.delete('config');
            history.replaceState(null, '', url.pathname + url.search + url.hash);
          } catch (e) {}
        }, 600);
      });
    }
  }

  janela.NilmaConfig = { ligar: ligar, abrir: abrir, fechar: fechar };
})(window, document);
