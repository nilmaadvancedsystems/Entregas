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
    pega('bancosDoCliente') + pega('bancosRecebidos') + pega('bancosFaltando') + pega('faltaPorBanco') +
    pega('nomesDeBancos') + pega('nomeDeBanco') + pega('tipoComBancos') +
    pega('tiposExigidos') + pega('naoSeAplica') + pega('faltandoDe') + pega('completoNoMes') +
    '; return { bancosFaltando: bancosFaltando, faltaPorBanco: faltaPorBanco, faltandoDe: faltandoDe, completoNoMes: completoNoMes };';
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

// ---------- quais bancos ainda faltam, POR TIPO de documento ----------
let app = montar(clientes, {
  tres: { extrato: true, comprovante: true, bancosPorTipo: { extrato: ['sicoob'], comprovante: ['sicoob', 'itau', 'bb'] } },
  um: { extrato: true, bancosPorTipo: { extrato: ['caixa'] } },
  nenhum: { extrato: true },
  na: { extrato: true, bancosPorTipo: { extrato: [] } }
});
igual('extrato: chegou de um banco, faltam os outros dois', app.bancosFaltando('tres', 'extrato'), ['itau', 'bb']);
igual('comprovante do mesmo cliente está completo', app.bancosFaltando('tres', 'comprovante'), []);
igual('aplicação não chegou de banco nenhum', app.bancosFaltando('tres', 'aplicacao'), ['sicoob', 'itau', 'bb']);
igual('único banco entregue: não falta nada', app.bancosFaltando('um', 'extrato'), []);
igual('cliente sem banco no cadastro segue como antes', app.bancosFaltando('nenhum', 'extrato'), []);
igual('tipo marcado sem banco identificado não inventa pendência', app.bancosFaltando('na', 'extrato'), []);
igual('o que não se aplica não falta de banco nenhum', app.bancosFaltando('na', 'aplicacao'), []);

// ---------- mês antigo: bancosRecebidos era só do extrato ----------
app = montar(clientes, { tres: { extrato: true, bancosRecebidos: ['sicoob'] } });
igual('mês antigo ainda conta pro extrato', app.bancosFaltando('tres', 'extrato'), ['itau', 'bb']);
igual('mês antigo não vira comprovante entregue', app.bancosFaltando('tres', 'comprovante'), ['sicoob', 'itau', 'bb']);

// ---------- o mês separado por banco ----------
app = montar(clientes, {
  tres: { extrato: true, comprovante: true, bancosPorTipo: { extrato: ['sicoob', 'itau'], comprovante: ['sicoob'] } }
});
igual('cada banco com o que ele deve',
  app.faltaPorBanco('tres').map(x => x.banco + ': ' + x.tipos.map(t => t.chave).join('+')),
  ['sicoob: aplicacao', 'itau: comprovante+aplicacao', 'bb: extrato+comprovante+aplicacao']);
// cliente de um banco só, sem nada entregue: aquele banco deve os três
igual('banco único deve os três documentos',
  app.faltaPorBanco('um').map(x => x.banco + ': ' + x.tipos.map(t => t.chave).join('+')),
  ['caixa: extrato+comprovante+aplicacao']);
app = montar(clientes, {
  um: { extrato: true, comprovante: true, aplicacao: true, bancosPorTipo: { extrato: ['caixa'], comprovante: ['caixa'], aplicacao: ['caixa'] } }
});
igual('banco em dia não aparece na lista', app.faltaPorBanco('um').length, 0);
app = montar(clientes, { tres: { semMovimento: true } });
igual('mês sem movimento não deve nada a banco nenhum', app.faltaPorBanco('tres'), []);

// ---------- o que a cobrança vai pedir ----------
app = montar(clientes, {
  tres: { extrato: true, comprovante: true, aplicacao: true, bancosPorTipo: { extrato: ['sicoob'], comprovante: ['sicoob', 'itau', 'bb'], aplicacao: ['sicoob', 'itau', 'bb'] } }
});
const falta = app.faltandoDe('tres');
igual('só o extrato continua faltando', falta.map(t => t.chave), ['extrato']);
igual('a cobrança nomeia os bancos que faltam', falta[0].label, 'Extrato Bancário (Itaú e Banco do Brasil)');
igual('o selo mostra quantos de quantos', falta[0].curto, 'Extrato 1/3');
igual('no meio da frase o banco mantém a maiúscula',
  falta.map(t => t.frase || t.label.toLowerCase()).join(', '), 'extrato do Itaú e Banco do Brasil');

// comprovante também nomeia banco, que é a mudança de agora
app = montar(clientes, {
  tres: { extrato: true, comprovante: true, aplicacao: true, bancosPorTipo: { extrato: ['sicoob', 'itau', 'bb'], comprovante: ['sicoob'], aplicacao: ['sicoob', 'itau', 'bb'] } }
});
igual('comprovante pede o banco igual ao extrato',
  app.faltandoDe('tres').map(t => t.frase), ['comprovante do Itaú e Banco do Brasil']);

// ---------- mês completo só quando todo banco entregou tudo ----------
app = montar(clientes, {});
const mesCheio = { extrato: true, comprovante: true, aplicacao: true };
igual('um banco de três não fecha o mês',
  app.completoNoMes('tres', Object.assign({ bancosPorTipo: { extrato: ['sicoob'], comprovante: ['sicoob'], aplicacao: ['sicoob'] } }, mesCheio)), false);
igual('três bancos em tudo fecham o mês',
  app.completoNoMes('tres', Object.assign({ bancosPorTipo: { extrato: ['sicoob', 'itau', 'bb'], comprovante: ['sicoob', 'itau', 'bb'], aplicacao: ['sicoob', 'itau', 'bb'] } }, mesCheio)), true);
igual('falta o comprovante de um banco e o mês não fecha',
  app.completoNoMes('tres', Object.assign({ bancosPorTipo: { extrato: ['sicoob', 'itau', 'bb'], comprovante: ['sicoob', 'itau'], aplicacao: ['sicoob', 'itau', 'bb'] } }, mesCheio)), false);
igual('mês antigo, sem banco registrado, continua completo', app.completoNoMes('tres', mesCheio), true);
igual('sem movimento fecha o mês', app.completoNoMes('tres', { semMovimento: true }), true);
igual('o que não se aplica sai da conta',
  app.completoNoMes('na', { extrato: true, comprovante: true, bancosPorTipo: { extrato: ['bb'], comprovante: ['bb'] } }), true);

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
