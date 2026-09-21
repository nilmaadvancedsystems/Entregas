// Testes das contas da tela de Pendências, tiradas do próprio arquivo.
// Não abre navegador nem banco.  Uso:  node scripts/teste-pendencias.js
const fs = require('fs');
const path = require('path');
const arquivo = process.argv[2] || path.join(__dirname, '..', 'Pendencias-e-envio-automatico-via-Gmail.html');
const s = fs.readFileSync(arquivo, 'utf8');
const pega = nome => {
  const ini = s.indexOf('  function ' + nome + '(');
  const fim = s.indexOf('\n  }\n', ini);
  if (ini < 0 || fim < 0) throw new Error('nao achei ' + nome);
  return s.slice(ini, fim + 5);
};
let falhas = 0, total = 0;
const igual = (nome, a, b) => {
  total++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    falhas++;
    console.log('FALHOU', nome, '\n  obtido:  ', JSON.stringify(a), '\n  esperado:', JSON.stringify(b));
  }
};

// ---------- o mundo de mentira: clientes, situação do mês e a lista de bancos ----------
const BancosNilma = require('../bancos-nilma');
function montar(clientes, status) {
  const clientesPorId = new Map(clientes.map(c => [c.id, c]));
  const statusPorId = new Map(Object.keys(status).map(k => [k, status[k]]));
  const TIPOS = [
    { chave: 'extrato', label: 'Extrato Bancário', curto: 'Extrato', icone: 'ph-bank' },
    { chave: 'comprovante', label: 'Comprovante', curto: 'Comprovante', icone: 'ph-receipt' },
    { chave: 'aplicacao', label: 'Aplicação', curto: 'Aplicação', icone: 'ph-chart-line-up' }
  ];
  const corpo =
    pega('bancosDoCliente') + pega('bancosRecebidos') + pega('bancosFaltando') +
    pega('nomesDeBancos') + pega('nomeDeBanco') + pega('extratoComBancos') +
    pega('tiposExigidos') + pega('faltandoDe') + pega('completoNoMes') +
    '; return { bancosFaltando: bancosFaltando, faltandoDe: faltandoDe, completoNoMes: completoNoMes };';
  return new Function('clientesPorId', 'statusCache', 'TIPOS', 'window',
    'function statusDoCliente(id) { return statusCache.get(id) || {}; }\n' + corpo
  )(clientesPorId, statusPorId, TIPOS, { BancosNilma: BancosNilma });
}

const clientes = [
  { id: 'tres', nome: 'PADARIA', bancos: ['sicoob', 'itau', 'bb'] },
  { id: 'um', nome: 'MERCEARIA', bancos: ['caixa'] },
  { id: 'nenhum', nome: 'SERRALHERIA' },
  { id: 'na', nome: 'OFICINA', bancos: ['bb'], documentosNaoAplicaveis: ['aplicacao'] }
];

// ---------- quais bancos ainda faltam no mês ----------
let app = montar(clientes, {
  tres: { extrato: true, bancosRecebidos: ['sicoob'] },
  um: { extrato: true, bancosRecebidos: ['caixa'] },
  nenhum: { extrato: true },
  na: { extrato: true, bancosRecebidos: [] }
});
igual('chegou de um banco, faltam os outros dois', app.bancosFaltando('tres'), ['itau', 'bb']);
igual('único banco entregue: não falta nada', app.bancosFaltando('um'), []);
igual('cliente sem banco no cadastro segue como antes', app.bancosFaltando('nenhum'), []);
igual('extrato marcado sem banco identificado não inventa pendência', app.bancosFaltando('na'), []);

// ---------- o que a cobrança vai pedir ----------
app = montar(clientes, {
  tres: { extrato: true, bancosRecebidos: ['sicoob'], comprovante: true, aplicacao: true }
});
const falta = app.faltandoDe('tres');
igual('extrato parcial continua na lista do que falta', falta.map(t => t.chave), ['extrato']);
igual('a cobrança nomeia os bancos que faltam', falta[0].label, 'Extrato Bancário (Itaú e Banco do Brasil)');
igual('o selo mostra quantos de quantos', falta[0].curto, 'Extrato 1/3');
// no WhatsApp a frase é minúscula, mas nome de banco é nome próprio
igual('no meio da frase o banco mantém a maiúscula',
  falta.map(t => t.frase || t.label.toLowerCase()).join(', '), 'extrato do Itaú e Banco do Brasil');

// ---------- mês completo só quando todo banco chegou ----------
app = montar(clientes, {});
igual('mês com um banco de três não está completo',
  app.completoNoMes('tres', { extrato: true, comprovante: true, aplicacao: true, bancosRecebidos: ['sicoob'] }), false);
igual('mês com os três bancos está completo',
  app.completoNoMes('tres', { extrato: true, comprovante: true, aplicacao: true, bancosRecebidos: ['sicoob', 'itau', 'bb'] }), true);
igual('mês antigo, sem banco registrado, continua completo',
  app.completoNoMes('tres', { extrato: true, comprovante: true, aplicacao: true }), true);
igual('sem movimento fecha o mês', app.completoNoMes('tres', { semMovimento: true }), true);
igual('o que não se aplica sai da conta',
  app.completoNoMes('na', { extrato: true, comprovante: true, bancosRecebidos: ['bb'] }), true);

// ---------- os nomes, do jeito que se fala ----------
igual('um banco só', BancosNilma.nomesDosBancos(['itau']), 'Itaú');
igual('dois bancos com e', BancosNilma.nomesDosBancos(['itau', 'bb']), 'Itaú e Banco do Brasil');
igual('três bancos com vírgula e e', BancosNilma.nomesDosBancos(['sicoob', 'itau', 'bb']), 'Sicoob, Itaú e Banco do Brasil');
igual('banco que saiu da lista devolve o próprio id', BancosNilma.nomeDoBanco('banco_que_nao_existe'), 'banco_que_nao_existe');

// ---------- escolher o banco na mão, sem o robô repor o que foi tirado ----------
const ficam = BancosNilma.bancosQueFicam;
igual('pôr banco à mão em cliente sem nenhum', ficam({}, ['sicoob', 'itau']), { bancos: ['sicoob', 'itau'], bancosRecusados: [] });
igual('tirar banco que o robô aprendeu manda pra recusados',
  ficam({ bancos: ['bb', 'itau'], bancosPeloRobo: ['itau'] }, ['bb']), { bancos: ['bb'], bancosRecusados: ['itau'] });
igual('tirar banco posto à mão só sai',
  ficam({ bancos: ['bb', 'itau'], bancosPeloRobo: [] }, ['bb']), { bancos: ['bb'], bancosRecusados: [] });
igual('pôr de volta tira da lista de recusados',
  ficam({ bancos: [], bancosRecusados: ['itau'] }, ['itau']), { bancos: ['itau'], bancosRecusados: [] });

console.log(falhas ? falhas + ' de ' + total + ' FALHARAM' : total + ' testes, todos passaram');
process.exit(falhas ? 1 : 0);
