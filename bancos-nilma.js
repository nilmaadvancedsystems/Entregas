// Os bancos que o escritório vê nos extratos dos clientes — a lista de
// verdade, num lugar só.
//
// Antes ela existia em dois: entregas.html (pro cadastro) e scripts/bancos.js
// (pro robô reconhecer o banco pelo cabeçalho do PDF). A tela de Pendências
// passou a precisar dela também, e três cópias é como a Caixa vira "CAIXA" num
// lugar e "Caixa Econômica" no outro.
//
// Aqui fica o que é fato do banco: id, nome, sigla, código COMPE e as cores do
// selo. O que é do robô (os padrões de texto que identificam o banco) continua
// em scripts/bancos.js, casado por id.
//
// Banco novo entra SÓ aqui. Se ele precisar ser reconhecido sozinho nos
// extratos, acrescente também o padrão em scripts/bancos.js.
//
// O logo de cada um fica em scripts/logos-bancos/<id>.png; sem o arquivo, o
// e-mail e o cadastro mostram um selo com a cor e a sigla.
(function (raiz) {
  var BANCOS = [
    { id: 'bb', nome: 'Banco do Brasil', sigla: 'BB', compe: '001', cor: '#FCF800', tinta: '#003DA5' },
    { id: 'caixa', nome: 'Caixa', sigla: 'CAIXA', compe: '104', cor: '#005CA9', tinta: '#FFFFFF' },
    { id: 'bnb', nome: 'Banco do Nordeste', sigla: 'BNB', compe: '004', cor: '#A6192E', tinta: '#FFFFFF' },
    { id: 'itau', nome: 'Itaú', sigla: 'itaú', compe: '341', cor: '#EC7000', tinta: '#FFFFFF' },
    { id: 'bradesco', nome: 'Bradesco', sigla: 'BRA', compe: '237', cor: '#CC092F', tinta: '#FFFFFF' },
    { id: 'santander', nome: 'Santander', sigla: 'SAN', compe: '033', cor: '#EC0000', tinta: '#FFFFFF' },
    { id: 'sicoob', nome: 'Sicoob', sigla: 'SICOOB', compe: '756', cor: '#003641', tinta: '#7DB61C' },
    { id: 'sicredi', nome: 'Sicredi', sigla: 'SICREDI', compe: '748', cor: '#3FA110', tinta: '#FFFFFF' },
    { id: 'cresol', nome: 'Cresol', sigla: 'CRESOL', compe: '133', cor: '#00843D', tinta: '#FFFFFF' },
    { id: 'nubank', nome: 'Nubank', sigla: 'nu', compe: '260', cor: '#820AD1', tinta: '#FFFFFF' },
    { id: 'inter', nome: 'Inter', sigla: 'inter', compe: '077', cor: '#FF7A00', tinta: '#FFFFFF' },
    { id: 'c6', nome: 'C6 Bank', sigla: 'C6', compe: '336', cor: '#242424', tinta: '#FFFFFF' },
    { id: 'mercadopago', nome: 'Mercado Pago', sigla: 'MP', compe: '323', cor: '#00B1EA', tinta: '#FFFFFF' },
    { id: 'pagbank', nome: 'PagBank', sigla: 'PAG', compe: '290', cor: '#1BB99A', tinta: '#FFFFFF' },
    { id: 'cora', nome: 'Cora', sigla: 'cora', compe: '403', cor: '#FE3E6D', tinta: '#FFFFFF' },
    { id: 'stone', nome: 'Stone', sigla: 'stone', compe: '197', cor: '#00A868', tinta: '#FFFFFF' },
    { id: 'btg', nome: 'BTG Pactual', sigla: 'BTG', compe: '208', cor: '#0B2A4A', tinta: '#FFFFFF' },
    { id: 'safra', nome: 'Safra', sigla: 'SAFRA', compe: '422', cor: '#1C2C4C', tinta: '#C9A96E' },
    { id: 'banrisul', nome: 'Banrisul', sigla: 'BANRI', compe: '041', cor: '#004B8D', tinta: '#FFFFFF' }
  ];

  var porId = {};
  BANCOS.forEach(function (b) { porId[b.id] = b; });

  // Nome de um banco pelo id. Banco que saiu da lista mas ficou no cadastro de
  // algum cliente devolve o próprio id, em vez de sumir da cobrança.
  function nomeDoBanco(id) {
    return (porId[id] && porId[id].nome) || String(id || '');
  }

  // "Sicoob, Itaú e Bradesco" — do jeito que se fala, pra entrar no meio de
  // uma frase de cobrança sem parecer lista de sistema.
  function nomesDosBancos(ids) {
    var nomes = (ids || []).map(nomeDoBanco);
    if (nomes.length <= 1) return nomes[0] || '';
    return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
  }

  var api = { BANCOS: BANCOS, porId: porId, nomeDoBanco: nomeDoBanco, nomesDosBancos: nomesDosBancos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.BancosNilma = api;
})(typeof window !== 'undefined' ? window : this);
