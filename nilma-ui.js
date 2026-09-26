// Aparência comum das telas menores (LCDPR, Conciliadorzinho, Cheque
// especial). O Entregas guarda o que a pessoa escolheu em duas camadas:
// no aparelho (localStorage nilma_*) e na conta (documento usuarios/{uid}).
// Aqui se aplica as duas, nesta ordem, e se acompanha a troca feita em
// outra aba.
//
// Carregue no <head>, ANTES da folha de estilo e sem defer: os atributos
// precisam estar no <html> antes da primeira pintura, senão a tela pisca
// no tema errado.
//
// Visual da Conferência (design-n1): só o TEMA muda a aparência (claro,
// escuro ou o do sistema, em data-theme). Paleta, tamanho de texto,
// espaçamento e animação continuam sendo lidos, gravados e aplicados como
// atributos (data-paleta, data-texto...), mas o nilma-ui.css não reage a
// eles: a aparência é fixa, igual à da Conferência.
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
