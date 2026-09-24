/* ==========================================================================
   Nilma — diálogo de confirmação (design-n1)

   O "modal" do N1 pra ação que não dá pra desfazer: título em pergunta,
   uma frase com os números em negrito e, embaixo à direita, Voltar + a
   ação. Substitui o confirm()/prompt() do navegador (que ignora tema e
   paleta) e o "toque de novo pra confirmar" no próprio botão.

   Abre como <dialog> na camada de cima do navegador, POR CIMA da janela
   que estiver aberta (as janelas do entregas.html moram todas no
   #modalRoot; trocar o conteúdo dele pra perguntar apagaria a de baixo).

     NilmaDialogo.confirmar({
       titulo: 'Excluir esta entrega?',
       texto: 'A entrega sai do histórico do cliente.',   // opcional
       html: false,          // true: texto é HTML (só com valores já escapados)
       acao: 'Excluir',      // rótulo do botão (padrão "Confirmar")
       perigo: true,         // botão vermelho de apagar em vez do principal
       aoConfirmar: fn       // chamada DENTRO do clique (abre seletor de arquivo etc.)
     }).then(function (sim) { ... });

     NilmaDialogo.perguntar({ titulo, rotulo, valor, acao, multilinha })
       .then(function (texto) { ... });   // null = desistiu

   Fecha com Voltar, Esc ou clique fora (= não). O foco vai pro Voltar
   quando é de apagar (Enter à toa não apaga) e volta pro botão que abriu.
   O visual (.n1-dialogo*) está na camada design-n1 do entregas.html, que o
   monta-folha.js leva pro nilma-ui.css.
   ========================================================================== */
(function () {
  'use strict';
  var aberto = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function abrir(o, campoHtml, lerValor) {
    if (aberto) aberto.fechar(lerValor ? null : false);
    var antes = document.activeElement;
    // <dialog> com showModal(): entra na camada de cima do navegador, acima
    // até de outro <dialog> aberto (a janela de cobrança do Pendências é
    // um); o navegador já prende o Tab e trata o Esc.
    var caixa = document.createElement('dialog');
    caixa.className = 'n1-dialogo';
    caixa.setAttribute('role', 'alertdialog');
    caixa.setAttribute('aria-labelledby', 'n1DialogoTitulo');
    var corpo = o.texto ? '<p class="n1-dialogo-texto">' + (o.html ? o.texto : esc(o.texto)) + '</p>' : '';
    caixa.innerHTML =
      '<h3 id="n1DialogoTitulo">' + esc(o.titulo || 'Confirmar?') + '</h3>' + corpo + (campoHtml || '') +
      '<div class="n1-dialogo-acoes">' +
        '<button type="button" class="btn btn-secondary" data-n1="voltar">' + esc(o.voltar || 'Voltar') + '</button>' +
        '<button type="button" class="btn ' + (o.perigo ? 'btn-perigo' : 'btn-primary') + '" data-n1="ok">' + esc(o.acao || 'Confirmar') + '</button>' +
      '</div>';
    document.body.appendChild(caixa);
    var botaoOk = caixa.querySelector('[data-n1="ok"]');
    var botaoVoltar = caixa.querySelector('[data-n1="voltar"]');
    var campo = caixa.querySelector('.n1-dialogo-campo');
    var nao = lerValor ? null : false;

    return new Promise(function (resolve) {
      var feito = false;
      function fechar(resposta) {
        if (feito) return;
        feito = true;
        aberto = null;
        if (caixa.open && caixa.close) caixa.close();
        caixa.remove();
        if (antes && document.body.contains(antes) && antes.focus) antes.focus();
        resolve(resposta);
      }
      aberto = { fechar: fechar };
      // Esc: o navegador dispara "cancel"; fecha pelo mesmo caminho do Voltar
      caixa.addEventListener('cancel', function (e) { e.preventDefault(); fechar(nao); });
      // clique no véu (fora da caixa) cai no próprio <dialog>
      caixa.addEventListener('click', function (e) { if (e.target === caixa) fechar(nao); });
      caixa.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && campo && e.target === campo && !campo.matches('textarea')) { e.preventDefault(); botaoOk.click(); }
      });
      botaoVoltar.addEventListener('click', function () { fechar(nao); });
      botaoOk.addEventListener('click', function () {
        var resposta = lerValor ? lerValor(campo) : true;
        if (resposta === undefined) return; // campo obrigatório vazio: fica aberto
        fechar(resposta);
        // dentro do clique: quem abre seletor de arquivo depois de confirmar
        // precisa do gesto da pessoa, que uma promessa já não carrega
        if (o.aoConfirmar) o.aoConfirmar(resposta);
      });
      if (caixa.showModal) caixa.showModal(); else caixa.setAttribute('open', '');
      (campo || (o.perigo ? botaoVoltar : botaoOk)).focus();
    });
  }

  window.NilmaDialogo = {
    confirmar: function (o) { return abrir(o || {}); },
    perguntar: function (o) {
      o = o || {};
      var id = 'n1DialogoCampo';
      var campo = o.multilinha
        ? '<textarea class="input n1-dialogo-campo" id="' + id + '" rows="3">' + esc(o.valor) + '</textarea>'
        : '<input class="input n1-dialogo-campo" id="' + id + '" type="text" value="' + esc(o.valor) + '">';
      var html = '<div class="n1-dialogo-corpo">' +
        (o.rotulo ? '<label class="n1-dialogo-rotulo" for="' + id + '">' + esc(o.rotulo) + '</label>' : '') + campo + '</div>';
      return abrir(o, html, function (el) {
        var v = el.value.trim();
        if (!v && o.obrigatorio) { el.focus(); return undefined; }
        return v;
      });
    }
  };
})();
