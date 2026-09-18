// Lista, para a competência informada (padrão: mês atual), os clientes ativos
// que ainda têm algum documento em falta na tela de Cobrança de Documentos.
// Segue as mesmas regras da tela: documento marcado como "não se aplica" no
// cliente não conta como falta, e mês "sem movimento" não tem pendência.
// Uso: node list-pending.js [AAAA-MM] [--todos]
//   --todos  inclui também quem não tem e-mail cadastrado
const { getDb } = require('./firestore-client');

const TIPOS = ['extrato', 'comprovante', 'aplicacao'];
const NOMES = { extrato: 'Extrato Bancário', comprovante: 'Comprovante', aplicacao: 'Aplicação' };

function competenciaAtual() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

async function main() {
  const args = process.argv.slice(2);
  const competencia = args.find(a => /^\d{4}-\d{2}$/.test(a)) || competenciaAtual();
  const incluirSemEmail = args.includes('--todos');
  const db = getDb('entregas-2e5e2');

  const [clientesSnap, docsSnap] = await Promise.all([
    db.collection('clientes').where('ativo', '==', true).get(),
    db.collection('documentosMensal').where('competencia', '==', competencia).get(),
  ]);

  const statusPorCliente = new Map();
  docsSnap.forEach(d => statusPorCliente.set(d.data().clienteId, d.data()));

  const pendentes = [];
  let semEmail = 0;
  clientesSnap.forEach(d => {
    const cliente = Object.assign({ id: d.id }, d.data());
    const status = statusPorCliente.get(cliente.id) || {};
    if (status.semMovimento) return;
    const naoAplica = Array.isArray(cliente.documentosNaoAplicaveis) ? cliente.documentosNaoAplicaveis : [];
    const faltando = TIPOS.filter(t => !naoAplica.includes(t) && !status[t]);
    if (!faltando.length) return;
    const emails = [cliente.email].concat(Array.isArray(cliente.emails) ? cliente.emails : []).filter(Boolean);
    if (!emails.length) { semEmail++; if (!incluirSemEmail) return; }
    pendentes.push({
      clienteId: cliente.id,
      clienteNome: cliente.nome,
      email: emails[0] || null,
      outrosEmails: emails.slice(1),
      competencia,
      documentosPendentes: faltando.map(t => NOMES[t]),
      cobrancasNoMes: Array.isArray(status.cobrancas) ? status.cobrancas.length : 0,
    });
  });

  console.log(JSON.stringify(pendentes, null, 2));
  console.error(`Competência ${competencia}: ${pendentes.length} com pendência` +
    (incluirSemEmail ? '' : ` e e-mail (mais ${semEmail} sem e-mail; use --todos)`));
}

main().catch(err => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
