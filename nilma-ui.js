// Aparência comum das telas menores (LCDPR, Conciliadorzinho, Cheque
// especial). O Entregas guarda o que a pessoa escolheu em duas camadas:
// no aparelho (localStorage nilma_*) e na conta (documento usuarios/{uid}).
// Aqui se aplica as duas, nesta ordem, e se acompanha a troca feita em
// outra aba.
//
// Carregue no <head>, ANTES da folha de estilo e sem defer: os atributos
// precisam estar no <html> antes da primeira pintura, senão a tela pisca
// no tema errado.
(function (janela) {
  var PADROES = { tema: 'auto', paleta: 'padrao', texto: 'normal', densidade: 'confortavel', animacao: 'completa' };
  var raiz = document.documentElement;

  function ler(chave) {
    try { return localStorage.getItem('nilma_' + chave) || ''; } catch (e) { return ''; }
  }
  function aplicar(chave, valor) {
    valor = valor || PADROES[chave];
    if (chave === 'tema') {
      if (valor === 'claro') raiz.dataset.theme = 'light';
      else if (valor === 'escuro') raiz.dataset.theme = 'dark';
      else delete raiz.dataset.theme;
      avisar(chave, valor);
      return;
    }
    if (!PADROES.hasOwnProperty(chave)) return;
    if (valor && valor !== PADROES[chave]) raiz.dataset[chave] = valor;
    else delete raiz.dataset[chave];
    avisar(chave, valor);
  }
  // A tela pode ter um controle próprio (o Conciliadorzinho tem os três
  // botões de tema): NilmaUI.aoAplicar avisa pra ele se marcar de novo.
  function avisar(chave, valor) {
    if (janela.NilmaUI && typeof janela.NilmaUI.aoAplicar === 'function') janela.NilmaUI.aoAplicar(chave, valor);
  }
  function aplicarTudo(origem) {
    Object.keys(PADROES).forEach(function (chave) {
      var v = origem ? origem[chave] : ler(chave);
      if (origem && !v) return;             // conta sem o campo: fica o do aparelho
      aplicar(chave, v);
      if (origem) { try { localStorage.setItem('nilma_' + chave, v); } catch (e) {} }
    });
  }

  aplicarTudo();
  janela.addEventListener('storage', function (ev) {
    if (!ev.key || ev.key.indexOf('nilma_') !== 0) return;
    var chave = ev.key.slice(6);
    if (PADROES.hasOwnProperty(chave)) aplicar(chave, ev.newValue);
  });

  // Depois do login: NilmaUI.daConta(doc.data()) — a conta vale mesmo num
  // aparelho onde o Entregas nunca foi aberto.
  janela.NilmaUI = { aplicar: aplicar, daConta: function (dados) { aplicarTudo(dados || {}); } };
})(window);

// ---------- janela de Aparência ----------
// As mesmas opções da engrenagem do Entregas e do "Aparência" do Pendências.
// A tela que quiser oferecer isso chama NilmaUI.abrirAparencia() num botão; e,
// se quiser guardar na conta também, define NilmaUI.aoSalvar = function (campo,
// valor) { ... } depois do login.
(function (janela) {
  var PALETAS = [
    ['padrao', 'Padrão', '#9A2B24'], ['azul', 'Azul', '#1A3D63'], ['ardosia', 'Ardósia', '#57707A'],
    ['nogueira', 'Nogueira', '#5E4B43'], ['verde', 'Verde', '#235347'], ['vermelho', 'Vermelho', '#DF2531'],
    ['laranja', 'Laranja', '#804012']
  ];
  var GRUPOS = [
    { campo: 'tema', rotulo: 'Tema', padrao: 'auto', opcoes: [['claro', 'Claro'], ['escuro', 'Escuro'], ['auto', 'Como o sistema']] },
    { campo: 'texto', rotulo: 'Tamanho do texto', padrao: 'normal', opcoes: [['normal', 'Padrão'], ['grande', 'Grande'], ['maior', 'Maior']] },
    { campo: 'densidade', rotulo: 'Espaçamento', padrao: 'confortavel', dica: 'Compacto mostra mais linhas por tela.', opcoes: [['confortavel', 'Confortável'], ['compacto', 'Compacto']] },
    { campo: 'animacao', rotulo: 'Animações', padrao: 'completa', opcoes: [['completa', 'Normais'], ['reduzida', 'Reduzidas']] }
  ];
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var caixa = null;

  function valorAtual(campo, padrao) {
    if (campo === 'tema') {
      var t = document.documentElement.dataset.theme;
      return t === 'light' ? 'claro' : (t === 'dark' ? 'escuro' : 'auto');
    }
    return document.documentElement.dataset[campo] || padrao;
  }
  function guardar(campo, valor) {
    try { localStorage.setItem('nilma_' + campo, valor); } catch (e) {}
    if (typeof janela.NilmaUI.aoSalvar === 'function') janela.NilmaUI.aoSalvar(campo, valor);
  }
  function desenhar() {
    var paletaAtual = document.documentElement.dataset.paleta || 'padrao';
    caixa.querySelector('.ap-corpo').innerHTML =
      '<div class="ap-grupo"><div class="ap-rotulo">Cor</div><div class="ap-cores" role="group" aria-label="Cor">' +
        PALETAS.map(function (p) {
          return '<button type="button" data-paleta="' + p[0] + '" title="' + esc(p[1]) + '" aria-label="' + esc(p[1]) + '"' +
            ' aria-pressed="' + (p[0] === paletaAtual) + '" style="background:' + p[2] + '"></button>';
        }).join('') + '</div></div>' +
      GRUPOS.map(function (g) {
        var atual = valorAtual(g.campo, g.padrao);
        return '<div class="ap-grupo"><div class="ap-rotulo">' + esc(g.rotulo) + '</div>' +
          (g.dica ? '<div class="ap-dica">' + esc(g.dica) + '</div>' : '') +
          '<div class="ap-opcoes" role="group" aria-label="' + esc(g.rotulo) + '">' +
            g.opcoes.map(function (o) {
              return '<button type="button" data-campo="' + g.campo + '" data-valor="' + o[0] + '" aria-pressed="' + (o[0] === atual) + '">' + esc(o[1]) + '</button>';
            }).join('') + '</div></div>';
      }).join('');
    caixa.querySelectorAll('[data-paleta]').forEach(function (b) {
      b.addEventListener('click', function () { janela.NilmaUI.aplicar('paleta', b.dataset.paleta); guardar('paleta', b.dataset.paleta); desenhar(); });
    });
    caixa.querySelectorAll('[data-campo]').forEach(function (b) {
      b.addEventListener('click', function () { janela.NilmaUI.aplicar(b.dataset.campo, b.dataset.valor); guardar(b.dataset.campo, b.dataset.valor); desenhar(); });
    });
  }
  janela.NilmaUI.abrirAparencia = function () {
    if (!caixa) {
      caixa = document.createElement('dialog');
      caixa.className = 'ap-janela';
      caixa.innerHTML =
        '<div class="ap-cab"><div><h2>Aparência</h2><div class="ap-dica">Vale em todas as telas da Nilma, em qualquer aparelho seu.</div></div>' +
        '<button type="button" class="ap-fechar" aria-label="Fechar"><i class="ph ph-x" aria-hidden="true"></i></button></div>' +
        '<div class="ap-corpo"></div>';
      document.body.appendChild(caixa);
      caixa.querySelector('.ap-fechar').addEventListener('click', function () { caixa.close(); });
      caixa.addEventListener('click', function (ev) { if (ev.target === caixa) caixa.close(); });
    }
    desenhar();
    caixa.showModal();
  };
  janela.addEventListener('storage', function () { if (caixa && caixa.open) desenhar(); });
})(window);
