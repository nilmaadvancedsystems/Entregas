/* ==========================================================================
   Nilma — Conta e "Perguntar à IA" para as telas que não são o Entregas

   O Entregas tem os dois embutidos. As outras telas (Pendências, Fiscal)
   usam este arquivo para ficar com o MESMO desenho:

   - Conta: a janela de Configurações comum (nilma-config.js, carregado
     antes deste arquivo) recebe as mesmas opções e abre em "Minha conta".
   - Perguntar à IA: o painel abre ancorado na caixa da barra de cima
     (#topoBusca, da casca nilma-shell.js), como uma pesquisa aberta. A
     pergunta vai pelo mesmo caminho do Entregas: conversasIA/{id}/mensagens,
     respondida pelo atendente que roda no PC do escritório
     (scripts/ia-atendente.js). O navegador nunca fala com o Gemini.
     A página pode passar um "responder" próprio (resposta rápida, sem IA).

   Visual da Conferência (design-n1). O painel (.cq-*) vem de nilma-ui.css
   (parte 5).

   Uso:
     NilmaExtras.ligar({ db, auth, firebase, usuario: () => ({nome, foto}),
                         aoMudarFoto: dataUrl => ..., responder: pergunta => Promise<html>,
                         exemplos: [...], exemplosIA: [...] });
     NilmaShell.ao('busca', NilmaExtras.abrirIA);
     NilmaShell.ao('conta', NilmaExtras.abrirConta);
   ========================================================================== */
(function () {
  'use strict';
  var janela = window;
  var doc = document;
  var o = {};
  function $(id) { return doc.getElementById(id); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function msgErro(err, padrao) { return (err && (err.message || err.code)) || padrao; }

  // Visual no desenho da Conferência (design-n1). O painel da IA (.cq-*),
  // o seletor de modo (.mode-toggle) e o botão de ícone (.icon-btn) vêm do
  // nilma-ui.css; aqui só dois acertos do painel.
  var CSS =
    '.cq-painel textarea.cq-campo{box-shadow:none}' +
    '.cq-painel .cq-enviar{display:inline-flex;align-items:center;justify-content:center}';

  // ---------------------------------------------------------------- conta
  // Foto, senha e o resto: a janela de Configurações (nilma-config.js).
  function abrirConta() {
    if (janela.NilmaConfig) janela.NilmaConfig.abrir('conta');
  }

  // ---------------------------------------------------------------- IA
  var historico = [];
  var ocupado = false, geracao = 0;
  var iaLigada = false, vigiaLigado = false, iaClaude = false;
  var soltarRobo = null, soltarMensagens = null, conversaId = null;
  var CHAVE_MODO = 'nilma_cq_modo';
  var modoPreferido = 'rapida';
  try { if (localStorage.getItem(CHAVE_MODO) === 'ia') modoPreferido = 'ia'; } catch (e) {}

  function temRapida() { return typeof o.responder === 'function'; }
  function iaDisponivel() { return iaLigada && (iaClaude || vigiaLigado); }
  function modoAtual() {
    if (!temRapida()) return 'ia';
    return modoPreferido === 'ia' && iaDisponivel() ? 'ia' : 'rapida';
  }

  function montarPainel() {
    if ($('cqPainel')) return;
    var p = doc.createElement('div');
    p.className = 'cq-painel'; p.id = 'cqPainel'; p.hidden = true;
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'false'); p.setAttribute('aria-label', 'Perguntar à IA');
    p.innerHTML =
      '<div class="cq-barra">' +
        '<span class="cq-ico"><i class="ph ph-chats-circle" aria-hidden="true"></i></span>' +
        '<textarea class="cq-campo" id="cqCampo" rows="1" aria-label="Sua pergunta"></textarea>' +
        '<button type="button" class="btn btn-primary cq-enviar" id="cqEnviar" title="Perguntar" aria-label="Perguntar"><i class="ph ph-arrow-up" aria-hidden="true"></i></button>' +
        '<button type="button" class="icon-btn" id="cqFechar" title="Fechar (Esc)" aria-label="Fechar"><i class="ph ph-x" aria-hidden="true"></i></button>' +
      '</div>' +
      '<div class="cq-opcoes">' +
        '<div class="mode-toggle cq-modo" id="cqModo" role="group" aria-label="Tipo de resposta" hidden>' +
          '<button type="button" class="mode-btn active" data-modo="rapida" aria-pressed="true"><i class="ph ph-lightning" aria-hidden="true"></i> Rápida</button>' +
          '<button type="button" class="mode-btn" data-modo="ia" aria-pressed="false"><i class="ph ph-sparkle" aria-hidden="true"></i> Com IA</button>' +
        '</div>' +
        '<span class="cq-nota" id="cqEstadoIa" style="margin:0"></span>' +
        '<button type="button" class="btn-chip cq-limpar" id="cqLimpar" title="Limpar a conversa"><i class="ph ph-trash" aria-hidden="true"></i> Limpar</button>' +
      '</div>' +
      '<div class="cq-conversa" id="cqConversa" aria-live="polite"></div>';
    doc.body.appendChild(p);

    $('cqFechar').addEventListener('click', fecharIA);
    $('cqLimpar').addEventListener('click', function () { historico = []; soltarConversa(); render(); $('cqCampo').focus(); });
    $('cqEnviar').addEventListener('click', perguntar);
    $('cqCampo').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); perguntar(); }
    });
    $('cqCampo').addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    $('cqModo').addEventListener('click', function (e) {
      var b = e.target.closest('.mode-btn');
      if (!b) return;
      modoPreferido = b.dataset.modo === 'ia' ? 'ia' : 'rapida';
      try { localStorage.setItem(CHAVE_MODO, modoPreferido); } catch (err) {}
      renderModo();
      $('cqCampo').focus();
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('cqPainel').hidden) fecharIA();
    });
    doc.addEventListener('pointerdown', function (ev) {
      var painel = $('cqPainel');
      if (!painel || painel.hidden) return;
      if (painel.contains(ev.target) || ev.target.closest('#topoBusca') || ev.target.closest('dialog')) return;
      fecharIA();
    });
    window.addEventListener('resize', function () { if (!$('cqPainel').hidden) posicionar(); });
  }

  function escutarRobo() {
    if (soltarRobo || !o.db) return;
    // Mesmo sinal do Entregas: robo/estado diz se o vigia do PC está vivo e
    // se a IA está ligada. Quem não pode ler o documento fica sem a IA.
    soltarRobo = o.db.doc('robo/estado').onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : {};
      var em = d.vigia && d.vigia.em ? Date.parse(d.vigia.em) : 0;
      vigiaLigado = !!em && (Date.now() - em) < 3 * 60 * 1000;
      // O Claude roda no PC do escritório: não depende do robô da nuvem, e
      // conta como ligado só com ponto de menos de 5 minutos.
      iaClaude = !!(d.ia && d.ia.motor === 'claude');
      var emIa = d.ia && d.ia.em ? Date.parse(d.ia.em) : 0;
      iaLigada = !!(d.ia && d.ia.ligado) && (!iaClaude || (!!emIa && (Date.now() - emIa) < 5 * 60 * 1000));
      renderModo();
    }, function () { iaLigada = false; vigiaLigado = false; renderModo(); });
  }

  function soltarConversa() {
    if (soltarMensagens) { soltarMensagens(); soltarMensagens = null; }
    conversaId = null;
    geracao++;
    ocupado = false;
  }

  function markdown(texto) {
    var html = '', lista = false;
    String(texto == null ? '' : texto).split('\n').forEach(function (linha) {
      var t = linha.trim();
      var item = t.match(/^[-*]\s+(.*)$/);
      if (item) {
        if (!lista) { html += '<ul style="margin:0 0 var(--esp-2);padding-left:18px">'; lista = true; }
        html += '<li>' + inline(item[1]) + '</li>';
        return;
      }
      if (lista) { html += '</ul>'; lista = false; }
      if (t) html += '<p style="margin:0 0 var(--esp-2)">' + inline(t) + '</p>';
    });
    if (lista) html += '</ul>';
    return html;
  }
  function inline(t) {
    return esc(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>');
  }

  function perguntarIA(pergunta, indice) {
    var email = (o.auth && o.auth.currentUser && o.auth.currentUser.email) || '';
    if (!email || ocupado || !o.db) return;
    ocupado = true;
    var minha = geracao, ordem = Date.now(), terminou = false;
    function liberar() {
      if (terminou) return;
      terminou = true;
      clearTimeout(relogio);
      if (minha === geracao) ocupado = false;
    }
    var relogio = setTimeout(function () {
      if (terminou || minha !== geracao) return;
      historico[indice] = { eu: false, html: '<div class="cq-erro">A IA não respondeu a tempo — o PC do escritório pode ter desligado. Tente de novo daqui a pouco.</div>' };
      liberar(); render();
    }, 120000);
    historico[indice] = { eu: false, html: '<div class="cq-nota" style="margin:0">perguntando à IA…</div>' };
    render();

    var criar = conversaId
      ? Promise.resolve(o.db.collection('conversasIA').doc(conversaId))
      : o.db.collection('conversasIA').add({
          criadoPor: email, criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(),
          titulo: pergunta.slice(0, 60), estado: 'ocioso', origem: o.origem || ''
        }).then(function (ref) { conversaId = ref.id; return ref; });

    criar.then(function (ref) {
      if (minha !== geracao) return null;
      if (soltarMensagens) soltarMensagens();
      soltarMensagens = ref.collection('mensagens').orderBy('ordem', 'asc').limit(200).onSnapshot(function (snap) {
        if (minha !== geracao) return;
        var ultima = null;
        snap.docs.forEach(function (d) { var m = d.data(); if (m.papel === 'model' && (m.ordem || 0) > ordem) ultima = m; });
        if (!ultima) return;
        if (ultima.estado === 'erro') {
          historico[indice] = { eu: false, html: '<div class="cq-erro">' + esc(ultima.erro || 'A IA não conseguiu responder.') + '</div>' };
          liberar();
        } else {
          if (ultima.estado === 'pronta') liberar();
          var corpo = ultima.texto ? markdown(ultima.texto) : '';
          if (ultima.estado === 'gerando') {
            corpo += '<div class="cq-nota" style="margin:0">' + (ultima.consultando
              ? 'consultando ' + esc(String(ultima.consultando).replace(/_/g, ' ')) + '…' : 'pensando…') + '</div>';
          } else {
            corpo += '<div class="cq-nota">IA' + (ultima.ferramentas && ultima.ferramentas.length
              ? ' · ' + esc(ultima.ferramentas.map(function (f) { return f.nome.replace(/_/g, ' '); }).join(' · ')) : '') + '</div>';
          }
          historico[indice] = { eu: false, html: corpo };
        }
        render();
      }, function (err) {
        if (minha !== geracao) return;
        historico[indice] = { eu: false, html: '<div class="cq-erro">' + esc(msgErro(err, 'Não foi possível acompanhar a resposta.')) + '</div>' };
        liberar(); render();
      });
      return ref.collection('mensagens').add({ papel: 'user', texto: pergunta, ordem: ordem, criadoEm: new Date().toISOString() })
        .then(function () { return ref.update({ estado: 'pendente', atualizadoEm: new Date().toISOString() }); });
    }).catch(function (err) {
      if (minha !== geracao) return;
      historico[indice] = { eu: false, html: '<div class="cq-erro">' + esc(msgErro(err, 'Não foi possível mandar a pergunta pra IA.')) + '</div>' };
      liberar(); render();
    });
  }

  function comEscapeIA(html) {
    if (!iaDisponivel()) return html;
    return html + '<button type="button" class="cq-exemplo cq-tentar-ia" style="margin-top:var(--esp-3)">' +
      '<i class="ph ph-sparkle" aria-hidden="true"></i> Não é isso? Tentar com a IA</button>';
  }

  function perguntar() {
    var campo = $('cqCampo');
    var pergunta = campo.value.trim();
    if (!pergunta || ocupado) return;
    campo.value = ''; campo.style.height = 'auto';
    historico.push({ eu: true, texto: pergunta });

    if (modoAtual() === 'ia') {
      if (!iaDisponivel()) {
        historico.push({ eu: false, html: '<div class="cq-erro">A IA está fora do ar agora: ela responde quando o PC do escritório está ligado.</div>' });
        render();
        return;
      }
      historico.push({ eu: false, html: '' });
      perguntarIA(pergunta, historico.length - 1);
      return;
    }
    ocupado = true;
    var minha = geracao, indice = historico.length;
    historico.push({ eu: false, html: '<div class="cq-nota" style="margin:0">consultando…</div>' });
    render();
    Promise.resolve().then(function () { return o.responder(pergunta); }).then(function (html) {
      if (minha !== geracao) return;
      historico[indice] = { eu: false, html: comEscapeIA(html) };
    }).catch(function (err) {
      if (minha !== geracao) return;
      historico[indice] = { eu: false, html: '<div class="cq-erro">Deu erro ao consultar: ' + esc(msgErro(err, 'erro desconhecido')) + '</div>' };
    }).then(function () {
      if (minha !== geracao) return;
      ocupado = false; render();
    });
  }

  function renderModo() {
    var box = $('cqModo');
    if (!box) return;
    box.hidden = !(temRapida() && iaDisponivel());
    var modo = modoAtual();
    Array.prototype.forEach.call(box.querySelectorAll('.mode-btn'), function (b) {
      var ativo = b.dataset.modo === modo;
      b.classList.toggle('active', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
    var estado = $('cqEstadoIa');
    estado.textContent = !temRapida() ? (iaDisponivel() ? 'IA ligada' : 'IA fora do ar') : '';
    $('cqCampo').placeholder = modo === 'ia' ? 'Pergunte do seu jeito — a IA consulta o sistema…' : (o.dica || 'Pergunte algo');
    if (!historico.length) render();
  }

  function render() {
    var el = $('cqConversa');
    if (!el) return;
    if (!historico.length) {
      var ia = modoAtual() === 'ia';
      var exemplos = (ia ? o.exemplosIA : o.exemplos) || [];
      el.innerHTML = '<div class="cq-vazio">' +
        (ia ? '<h3>Converse com a IA</h3>' : '<h3>Pergunte sobre o que está no sistema</h3>') +
        (exemplos.length ? '<div class="cq-exemplos">' + exemplos.map(function (p) {
          return '<button type="button" class="cq-exemplo">' + esc(p) + '</button>';
        }).join('') + '</div>' : '') + '</div>';
      Array.prototype.forEach.call(el.querySelectorAll('.cq-exemplo'), function (b) {
        b.addEventListener('click', function () { $('cqCampo').value = b.textContent; perguntar(); });
      });
      return;
    }
    el.innerHTML = historico.map(function (m, i) {
      return m.eu ? '<div class="cq-msg cq-msg-eu">' + esc(m.texto) + '</div>'
        : '<div class="cq-msg cq-msg-resp" data-i="' + i + '">' + m.html + '</div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.cq-tentar-ia'), function (b) {
      b.addEventListener('click', function () {
        var i = parseInt(b.closest('.cq-msg-resp').dataset.i, 10);
        var pergunta = historico[i - 1] && historico[i - 1].texto;
        if (pergunta) perguntarIA(pergunta, i);
      });
    });
    el.scrollTop = el.scrollHeight;
  }

  // No PC o painel cobre a caixa "Perguntar à IA" da barra de cima, com a
  // mesma borda direita; no celular ocupa a tela (CSS).
  function posicionar() {
    var painel = $('cqPainel'), caixa = $('topoBusca');
    if (!painel || !caixa) return;
    if (!matchMedia('(min-width: 900px)').matches) { painel.style.left = painel.style.right = painel.style.top = painel.style.width = ''; return; }
    var r = caixa.getBoundingClientRect();
    painel.style.width = Math.min(Math.max(r.width, 560), window.innerWidth - 32) + 'px';
    painel.style.right = Math.max(16, window.innerWidth - r.right) + 'px';
    painel.style.left = 'auto';
    painel.style.top = Math.max(8, r.top) + 'px';
  }
  function abrirIA() {
    montarPainel();
    escutarRobo();
    posicionar();
    $('cqPainel').hidden = false;
    if ($('topoBusca')) $('topoBusca').setAttribute('aria-expanded', 'true');
    renderModo();
    render();
    if (!matchMedia('(hover: none)').matches) $('cqCampo').focus();
  }
  function fecharIA() {
    var p = $('cqPainel');
    if (!p || p.hidden) return;
    p.hidden = true;
    var b = $('topoBusca');
    if (b) { b.setAttribute('aria-expanded', 'false'); if (!matchMedia('(hover: none)').matches) b.focus(); }
  }

  function ligar(opcoes) {
    o = opcoes || {};
    if (!$('nxEstilo')) {
      var s = doc.createElement('style');
      s.id = 'nxEstilo'; s.textContent = CSS;
      doc.head.appendChild(s);
    }
    // Configurações: as mesmas opções (db, auth, usuário, foto, aviso).
    if (janela.NilmaConfig) janela.NilmaConfig.ligar(o);
    if (typeof NilmaShell !== 'undefined') {
      NilmaShell.ao('busca', abrirIA);
      NilmaShell.ao('conta', abrirConta);
      var bc = $('menuContaBtn'); if (bc) bc.hidden = false;
    }
  }
  function sair() {
    if (soltarRobo) { soltarRobo(); soltarRobo = null; }
    historico = [];
    soltarConversa();
    fecharIA();
    if (janela.NilmaConfig) janela.NilmaConfig.fechar();
  }

  window.NilmaExtras = { ligar: ligar, abrirIA: abrirIA, fecharIA: fecharIA, abrirConta: abrirConta, sair: sair };
})();
