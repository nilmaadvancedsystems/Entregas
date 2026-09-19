// Testes das funções puras do app (entregas.html), tiradas do próprio arquivo.
// Não abre navegador nem banco.  Uso:  node scripts/teste-app.js
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'entregas.html'), 'utf8');
// pega "  function nome(...) { ... }" até a chave de fechamento alinhada em dois espaços
const pega = nome => {
  const ini = s.indexOf('  function ' + nome + '(');
  const fim = s.indexOf('\n  }\n', ini);
  if (ini < 0 || fim < 0) throw new Error('nao achei ' + nome);
  return s.slice(ini, fim + 5);
};
let falhas = 0, total = 0;
const igual = (nome, a, b) => { total++; if (JSON.stringify(a) !== JSON.stringify(b)) { falhas++; console.log('FALHOU', nome, '\n  obtido:  ', JSON.stringify(a), '\n  esperado:', JSON.stringify(b)); } };

// ---------- ler guia com a câmera: linha digitável -> 44 dígitos das barras ----------
const barras = new Function(pega('barrasDaLinha_') + '; return barrasDaLinha_;')();
igual('linha de arrecadação vira as 44 barras', barras('85800000012-3 34560328261-2 23071234567-1 89012345678-1'), '85800000012' + '34560328261' + '23071234567' + '89012345678');
igual('linha de boleto de banco vira as 44 barras', barras('00190.50095 40144.816069 06809.350314 3 37370000000100'), '0019' + '3' + '37370000000100' + '05009' + '4014481606' + '0680935031');
igual('texto que não é linha digitável devolve vazio', barras('12345'), '');

// ---------- o que o histórico ensina sobre o cliente ----------
const dica = new Function(pega('dicaDoCliente_') + '; return dicaDoCliente_;')();
const em = (h, status) => ({ status, confirmadoEm: new Date(2026, 8, 10, h, 15).toISOString() });
igual('menos de três entregas: não fala nada', dica([em(9, 'confirmada'), em(10, 'confirmada')]), '');
igual('faixa de recebimento pelo miolo do histórico', dica([em(9, 'confirmada'), em(9, 'confirmada'), em(10, 'confirmada'), em(10, 'confirmada'), em(16, 'confirmada')]), 'Costuma receber entre 9h e 11h');
igual('duas falhas na mesma hora viram aviso', dica([em(12, 'falha'), em(12, 'falha'), em(9, 'confirmada'), em(9, 'confirmada'), em(10, 'confirmada')]), 'Costuma receber entre 9h e 11h · 2 tentativas sem sucesso por volta das 12h');

// ---------- motivo de não entrega ----------
const listaDeMotivos = s.match(/var MOTIVOS_DE_FALHA_ = (\[[^\]]+\]);/)[1];
const motivo = new Function('var MOTIVOS_DE_FALHA_ = ' + listaDeMotivos + ';' + pega('motivoPadrao_') + '; return motivoPadrao_;')();
igual('motivo de botão com complemento conta como o botão', motivo('Estabelecimento fechado. Volto amanhã cedo'), 'Estabelecimento fechado');
igual('texto livre conta como outro motivo', motivo('portão quebrado'), 'Outro motivo');
igual('sem motivo não conta', motivo(''), '');

// ---------- números do mês ----------
const numeros = new Function('motivoPadrao_', pega('numerosDoMes_') + '; return numerosDoMes_;')(motivo);
const n = numeros([{ status: 'confirmada', entregadoPorNome: 'João', temAssinatura: true }, { status: 'confirmada', entregadoPorNome: 'João', temFoto: true },
  { status: 'confirmada', entregadoPorNome: 'Link do cliente', recebidoPeloLink: true }, { status: 'falha', clienteNome: 'PADARIA', motivoFalha: 'Cliente ausente' },
  { status: 'falha', clienteNome: 'PADARIA', motivoFalha: 'Cliente ausente. De novo' }, { status: 'link' }]);
igual('números do mês', [n.feitas, n.falhas, n.noLink, n.comAssinatura, n.soFoto, n.peloLink, n.porPessoa[0], n.porMotivo[0], n.quemMaisFalha[0]],
  [3, 2, 1, 1, 1, 1, { nome: 'João', n: 2 }, { nome: 'Cliente ausente', n: 2 }, { nome: 'PADARIA', n: 2 }]);

// ---------- bancos do cliente no cadastro ----------
const ficam = new Function(pega('bancosQueFicam_') + '; return bancosQueFicam_;')();
igual('desmarcar banco que o robô aprendeu vira recusado', ficam({ bancos: ['bb', 'itau'], bancosPeloRobo: ['itau'] }, ['bb']), { bancos: ['bb'], bancosRecusados: ['itau'] });
igual('desmarcar banco posto à mão não vira recusado', ficam({ bancos: ['bb', 'itau'], bancosPeloRobo: [] }, ['bb']), { bancos: ['bb'], bancosRecusados: [] });
igual('marcar de novo tira da lista de recusados', ficam({ bancos: [], bancosRecusados: ['itau'] }, ['itau']), { bancos: ['itau'], bancosRecusados: [] });

console.log(falhas ? falhas + ' de ' + total + ' FALHARAM' : total + ' testes, todos passaram');
process.exit(falhas ? 1 : 0);
