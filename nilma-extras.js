/* ==========================================================================
   Nilma — Conta e "Perguntar à IA" para as telas que não são o Entregas

   O Entregas tem os dois embutidos. As outras telas (Pendências, Fiscal)
   usam este arquivo para ficar com o MESMO desenho:

   - Conta: janela com foto de perfil e troca de senha. Grava no mesmo lugar
     que o Entregas (usuarios/{uid}.fotoPerfil e a senha do Firebase Auth).
   - Perguntar à IA: o painel abre ancorado na caixa da barra de cima
     (#topoBusca, da casca nilma-shell.js), como uma pesquisa aberta. A
     pergunta vai pelo mesmo caminho do Entregas: conversasIA/{id}/mensagens,
     respondida pelo atendente que roda no PC do escritório
     (scripts/ia-atendente.js). O navegador nunca fala com o Gemini.
     A página pode passar um "responder" próprio (resposta rápida, sem IA).

   O visual do painel (.cq-*) vem de nilma-ui.css, recortado do entregas.html
   por scripts/monta-folha.js. Aqui só vão os poucos componentes que a folha
   comum não tem (seletor de modo, botão de ícone, janela da conta).

   Uso:
     NilmaExtras.ligar({ db, auth, firebase, usuario: () => ({nome, foto}),
                         aoMudarFoto: dataUrl => ..., responder: pergunta => Promise<html>,
                         exemplos: [...], exemplosIA: [...] });
     NilmaShell.ao('busca', NilmaExtras.abrirIA);
     NilmaShell.ao('conta', NilmaExtras.abrirConta);
   ========================================================================== */
(function () {
  'use strict';
  var doc = document;
  var o = {};
  function $(id) { return doc.getElementById(id); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function msgErro(err, padrao) { return (err && (err.message || err.code)) || padrao; }
  function avisar(texto, tipo) {
    if (typeof o.toast === 'function') { o.toast(texto, tipo); return; }
    var t = doc.createElement('div');
    t.className = 'nx-toast' + (tipo === 'error' ? ' nx-toast-erro' : '');
    t.textContent = texto;
    doc.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }

  var CSS =
    '.cq-painel .mode-toggle{display:flex;gap:3px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-sm);padding:3px}' +
    '.cq-painel .mode-btn{flex:1;border:none;background:transparent;border-radius:var(--r-xs);font-weight:400;font-size:var(--t-base);color:var(--ink-soft);cursor:pointer;font-family:inherit}' +
    '.cq-painel .mode-btn:hover{color:var(--ink)}' +
    '.cq-painel .mode-btn.active{background:var(--surface);color:var(--accent-forte);font-weight:600;box-shadow:inset 0 0 0 1px var(--border-forte)}' +
    '.cq-painel .icon-btn{border:1px solid var(--border);background:var(--surface);color:var(--ink-soft);font-size:.95rem;cursor:pointer;line-height:1;border-radius:var(--r-sm);display:inline-flex;align-items:center;justify-content:center;flex:none}' +
    '.cq-painel .icon-btn:hover{background:var(--surface-2);color:var(--ink);border-color:var(--border-forte)}' +
    '.cq-painel textarea.cq-campo{box-shadow:none}' +
    '.cq-painel .cq-enviar{display:inline-flex;align-items:center;justify-content:center}' +
    /* janela da conta */
    'dialog.nx-conta{border:1px solid var(--border-forte);border-radius:var(--r-md);padding:0;width:min(440px,calc(100vw - 32px));background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}' +
    'dialog.nx-conta::backdrop{background:rgba(0,0,0,.35)}' +
    '.nx-conta-cab{display:flex;align-items:center;gap:var(--esp-2);padding:var(--esp-3) var(--esp-4);border-bottom:1px solid var(--border);background:var(--surface-2)}' +
    '.nx-conta-cab h2{margin:0 auto 0 0;font-size:var(--t-md);font-weight:600}' +
    '.nx-conta-cab button{width:32px;height:32px;border:0;background:none;border-radius:var(--r-sm);color:var(--ink-soft);cursor:pointer;font-size:1.05rem}' +
    '.nx-conta-cab button:hover{background:var(--surface);color:var(--ink)}' +
    '.nx-conta-corpo{padding:var(--esp-4)}' +
    '.nx-conta-sec+.nx-conta-sec{margin-top:var(--esp-5)}' +
    '.nx-conta-sec h3{margin:0 0 var(--esp-3);padding-bottom:var(--esp-2);border-bottom:1px solid var(--border);font-size:var(--t-base);font-weight:600}' +
    '.nx-foto-linha{display:flex;align-items:center;gap:var(--esp-3);flex-wrap:wrap}' +
    '.nx-foto{width:64px;height:64px;border-radius:50%;flex:none;display:grid;place-items:center;background:var(--accent-soft,var(--surface-2)) center/cover no-repeat;color:var(--accent-forte);font-weight:600;font-size:1.2rem;border:1px solid var(--border)}' +
    '.nx-conta label.nx-rot{display:block;font-size:var(--t-base);font-weight:600;color:var(--ink);margin:0 0 4px}' +
    '.nx-conta input[type=password]{width:100%;height:38px;padding:0 10px;margin-bottom:var(--esp-3);border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface);color:var(--ink);font:inherit}' +
    '.nx-conta .nx-botao{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface);color:var(--ink);font-family:inherit;font-size:var(--t-base);font-weight:600;line-height:1;cursor:pointer}' +
    '.nx-conta .nx-botao:hover{background:var(--surface-2);border-color:var(--border-forte)}' +
    '.nx-conta .nx-botao.primario{background:var(--accent);border-color:transparent;color:var(--accent-ink)}' +
    '.nx-conta .nx-botao.leve{border-color:transparent;background:none;color:var(--ink-soft)}' +
    '.nx-conta .nx-erro{color:var(--danger-forte,var(--danger));font-size:var(--t-sm);margin:-4px 0 var(--esp-2);min-height:0}' +
    '.nx-conta .nx-arquivo{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}' +
    '.nx-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:var(--ink);color:var(--surface);padding:10px 16px;border-radius:var(--r-sm);font-size:var(--t-sm)}' +
    '.nx-toast-erro{background:var(--danger-forte,#94231C);color:#fff}';

  // ---------------------------------------------------------------- conta
  function iniciais(nome) {
    var p = String(nome || '').trim().split(/[\s.@]+/).filter(Boolean);
    return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '';
  }
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
  function montarConta() {
    if ($('nxConta')) return $('nxConta');
    var d = doc.createElement('dialog');
    d.className = 'nx-conta'; d.id = 'nxConta';
    d.setAttribute('aria-labelledby', 'nxContaTitulo');
    d.innerHTML =
      '<div class="nx-conta-cab"><h2 id="nxContaTitulo">Conta</h2>' +
        '<button type="button" id="nxContaFechar" aria-label="Fechar"><i class="ph ph-x" aria-hidden="true"></i></button></div>' +
      '<div class="nx-conta-corpo">' +
        '<section class="nx-conta-sec"><h3>Foto de perfil</h3>' +
          '<div class="nx-foto-linha"><span class="nx-foto" id="nxFoto"></span>' +
            '<input type="file" accept="image/*" id="nxFotoArquivo" class="nx-arquivo">' +
            '<label class="nx-botao" for="nxFotoArquivo"><i class="ph ph-camera" aria-hidden="true"></i> Escolher foto</label>' +
            '<button type="button" class="nx-botao leve" id="nxFotoRemover" hidden>Remover</button></div>' +
        '</section>' +
        '<form class="nx-conta-sec" id="nxSenhaForm" novalidate><h3>Trocar senha</h3>' +
          '<label class="nx-rot" for="nxSenhaAtual">Senha atual</label>' +
          '<input id="nxSenhaAtual" type="password" autocomplete="current-password" required>' +
          '<label class="nx-rot" for="nxSenhaNova">Nova senha</label>' +
          '<input id="nxSenhaNova" type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres" required>' +
          '<div class="nx-erro" id="nxSenhaErro"></div>' +
          '<button type="submit" class="nx-botao primario">Salvar nova senha</button>' +
        '</form>' +
      '</div>';
    doc.body.appendChild(d);
    $('nxContaFechar').addEventListener('click', function () { d.close(); });
    d.addEventListener('click', function (ev) { if (ev.target === d) d.close(); });
    $('nxFotoArquivo').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      reduzirImagem(f, 256, 0.82).then(salvarFoto).catch(function () { avisar('Não foi possível processar a foto.', 'error'); });
    });
    $('nxFotoRemover').addEventListener('click', function () { salvarFoto(''); });
    $('nxSenhaForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var atual = $('nxSenhaAtual').value, nova = $('nxSenhaNova').value, erro = $('nxSenhaErro');
      erro.textContent = '';
      if (nova.length < 6) { erro.textContent = 'A nova senha precisa ter ao menos 6 caracteres.'; return; }
      var u = o.auth && o.auth.currentUser;
      if (!u || !o.firebase) { erro.textContent = 'Sem conexão com a conta agora.'; return; }
      var botao = ev.target.querySelector('button[type=submit]');
      botao.disabled = true;
      var cred = o.firebase.auth.EmailAuthProvider.credential(u.email, atual);
      u.reauthenticateWithCredential(cred)
        .then(function () { return u.updatePassword(nova); })
        .then(function () { avisar('Senha alterada.'); d.close(); })
        .catch(function (err) { erro.textContent = err && err.code === 'auth/wrong-password' ? 'Senha atual incorreta.' : msgErro(err, 'Não foi possível trocar a senha.'); })
        .then(function () { botao.disabled = false; });
    });
    return d;
  }
  var fotoAtual = '';
  function pintarFoto() {
    var el = $('nxFoto');
    if (!el) return;
    var u = typeof o.usuario === 'function' ? (o.usuario() || {}) : {};
    el.style.backgroundImage = fotoAtual ? 'url("' + fotoAtual + '")' : '';
    el.textContent = fotoAtual ? '' : iniciais(u.nome);
    $('nxFotoRemover').hidden = !fotoAtual;
  }
  function salvarFoto(dataUrl) {
    var u = o.auth && o.auth.currentUser;
    if (!u || !o.db) return;
    fotoAtual = dataUrl || '';
    pintarFoto();
    if (typeof o.aoMudarFoto === 'function') o.aoMudarFoto(fotoAtual);
    o.db.collection('usuarios').doc(u.uid).update({ fotoPerfil: fotoAtual })
      .then(function () { avisar(dataUrl ? 'Foto de perfil atualizada.' : 'Foto de perfil removida.'); })
      .catch(function (err) { avisar(msgErro(err, 'Não foi possível salvar a foto.'), 'error'); });
  }
  function abrirConta() {
    var d = montarConta();
    var u = typeof o.usuario === 'function' ? (o.usuario() || {}) : {};
    fotoAtual = u.foto || '';
    $('nxSenhaAtual').value = ''; $('nxSenhaNova').value = ''; $('nxSenhaErro').textContent = '';
    pintarFoto();
    if (!d.open) d.showModal();
  }

  // ---------------------------------------------------------------- IA
  var historico = [];
  var ocupado = false, geracao = 0;
  var iaLigada = false, vigiaLigado = false;
  var soltarRobo = null, soltarMensagens = null, conversaId = null;
  var CHAVE_MODO = 'nilma_cq_modo';
  var modoPreferido = 'rapida';
  try { if (localStorage.getItem(CHAVE_MODO) === 'ia') modoPreferido = 'ia'; } catch (e) {}

  function temRapida() { return typeof o.responder === 'function'; }
  function iaDisponivel() { return iaLigada && vigiaLigado; }
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
      iaLigada = !!(d.ia && d.ia.ligado);
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
    var d = $('nxConta'); if (d && d.open) d.close();
  }

  window.NilmaExtras = { ligar: ligar, abrirIA: abrirIA, fecharIA: fecharIA, abrirConta: abrirConta, sair: sair };
})();
