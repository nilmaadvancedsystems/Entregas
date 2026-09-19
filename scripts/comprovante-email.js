// Comprovante de entrega por e-mail, enviado pelo PC do robô.
//
// Com a opção ligada (Pendências › Configurações › Automático), cada entrega
// confirmada na rua vira um e-mail curto pro cliente: o que foi entregue,
// quem recebeu e quando, e o link da página dele se tiver. É o recibo que o
// cliente guarda sem precisar pedir.
//
// Vem DESLIGADO. Cuidados:
//   - só pra e-mail do cadastro do cliente;
//   - várias guias do mesmo cliente confirmadas juntas (assinatura em lote)
//     saem num e-mail só: espera AGRUPAR_MS depois da última;
//   - marca a entrega (comprovanteEmail) ANTES de mandar, com a condição de
//     ninguém ter mexido nela desde a leitura: vigia religado não manda de novo;
//   - recebido pelo link não gera e-mail: foi o próprio cliente que confirmou.
const cacheDeClientes = require('./clientes-cache');
const { ouvir } = require('./ouvinte');

const BASE = 'https://nilmaadvancedsystems.github.io/Entregas/cliente.html';
const JANELA_MS = 24 * 36e5;          // só entregas das últimas 24h
const AGRUPAR_MS = 90 * 1000;
const REFAZER_OUVINTE_MS = 12 * 36e5; // a janela anda: o ouvinte é refeito duas vezes por dia
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const dinheiro = v => 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const mesPorExtenso = comp => { const p = String(comp || '').split('-'); return MESES[Number(p[1]) - 1] ? MESES[Number(p[1]) - 1] + ' de ' + p[0] : ''; };
const dataHora = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };

// Esta entrega pede comprovante? Função pura, pra testar sem rede.
function precisaDeComprovante(e, agora) {
  if (!e || e.status !== 'confirmada' || e.recebidoPeloLink || e.comprovanteEmail) return false;
  const quando = new Date(e.confirmadoEm || 0).getTime();
  return agora - quando < JANELA_MS && quando <= agora + 60000;
}

function textoDoComprovante(cliente, entregas, assinatura) {
  const nome = (cliente.nomeFantasia || '').trim() || cliente.nome || '';
  const linhas = entregas.map(e => {
    const docs = (e.itens || []).map(i => (typeof i === 'string' ? i : i.tipo) + (i && i.valor != null ? ' ' + dinheiro(i.valor) : '')).join(', ') || 'Documentos';
    const extra = [mesPorExtenso(e.competencia), e.vencimento ? 'vence ' + e.vencimento.split('-').reverse().join('/') : ''].filter(Boolean).join(', ');
    return '- ' + docs + (extra ? ' (' + extra + ')' : '');
  });
  const recebedores = [...new Set(entregas.map(e => e.recebedor).filter(Boolean))];
  const ultima = entregas.map(e => e.confirmadoEm).sort().pop();
  const link = cliente.portalToken ? BASE + '?portal=' + cliente.portalToken : '';
  const assunto = entregas.length === 1
    ? 'Entrega registrada: ' + linhas[0].slice(2).replace(/ \(.*\)$/, '')
    : 'Entrega registrada: ' + entregas.length + ' documentos';
  const corpo = [
    'Olá,', '',
    'Registramos a entrega destes documentos para ' + nome + ':', '',
    ...linhas, '',
    (recebedores.length ? 'Recebido por ' + recebedores.join(', ') : 'Entregue') + ' em ' + dataHora(ultima) + '.',
    ...(link ? ['', 'As guias, o código para pagar e este comprovante ficam na sua página:', link] : []),
    '', 'Se algo não confere, é só responder este e-mail.', '',
    assinatura || 'Nilma Contabilidade',
  ].join('\n');
  return { assunto, corpo };
}

function iniciarComprovantePorEmail({ db, log, correio }) {
  const configRef = db.collection('config').doc('cobranca');
  let config = null, configEm = 0;
  async function lerConfig() {
    if (Date.now() - configEm > 10 * 60 * 1000) {
      try { config = (await configRef.get()).data() || {}; configEm = Date.now(); } catch (e) { config = config || {}; }
    }
    return config;
  }
  async function clienteDe(id) {
    const lista = cacheDeClientes.lerDoArquivo();
    const achado = lista && lista.find(c => c.id === id);
    if (achado) return Object.assign({ id }, achado.dados);
    const s = await db.collection('clientes').doc(id).get();
    return s.exists ? Object.assign({ id: s.id }, s.data()) : null;
  }

  const vistos = new Set();          // já tratados nesta execução (inclusive os sem e-mail)
  const esperando = new Map();       // clienteId -> { ids:Set, timer }
  async function mandar(clienteId, ids) {
    try {
      const cfg = await lerConfig();
      if (cfg.comprovanteEmail !== true) return;
      const cliente = await clienteDe(clienteId);
      const para = cliente && String(cliente.email || '').trim().toLowerCase();
      if (!para) return;
      if (!correio.podeEnviar(1)) { log('comprovante: freio por hora, fica pra depois'); ids.forEach(id => vistos.delete(id)); return; }
      // marca cada entrega com a condição de ninguém ter mexido nela
      const marcadas = [];
      const em = new Date().toISOString();
      for (const id of ids) {
        const ref = db.collection('entregas').doc(id);
        const s = await ref.get();
        if (!s.exists || !precisaDeComprovante(s.data(), Date.now())) continue;
        try {
          await ref.update({ comprovanteEmail: { em, para } }, { lastUpdateTime: s.updateTime });
          marcadas.push(s.data());
        } catch (e) { /* mudou no meio: o ouvinte traz de novo */ }
      }
      if (!marcadas.length) return;
      const m = textoDoComprovante(cliente, marcadas.sort((a, b) => String(a.confirmadoEm).localeCompare(String(b.confirmadoEm))), cfg.assinatura);
      await correio.enviar({ para, assunto: m.assunto, corpo: m.corpo });
      correio.contar();
      log('comprovante de entrega enviado para', cliente.nome, '(' + marcadas.length + ')');
    } catch (err) {
      log('comprovante de entrega não saiu:', err.message);
    }
  }
  function enfileirar(e) {
    const f = esperando.get(e.clienteId) || { ids: new Set(), timer: null };
    f.ids.add(e.id);
    clearTimeout(f.timer);
    f.timer = setTimeout(() => { esperando.delete(e.clienteId); mandar(e.clienteId, [...f.ids]); }, AGRUPAR_MS);
    esperando.set(e.clienteId, f);
  }

  let parar = null;
  const ligar = () => {
    if (parar) parar();
    parar = ouvir('comprovante por e-mail', () =>
      db.collection('entregas').where('confirmadoEm', '>=', new Date(Date.now() - JANELA_MS).toISOString()),
    async snap => {
      const agora = Date.now();
      const novas = snap.docChanges().filter(ch => ch.type !== 'removed')
        .map(ch => Object.assign({ id: ch.doc.id }, ch.doc.data()))
        .filter(e => !vistos.has(e.id) && e.clienteId && precisaDeComprovante(e, agora));
      if (!novas.length) return;
      if ((await lerConfig()).comprovanteEmail !== true) return;   // desligado: não marca como visto, vale se ligar depois
      novas.forEach(e => { vistos.add(e.id); enfileirar(e); });
    }, log);
  };
  ligar();
  setInterval(() => { vistos.clear(); ligar(); }, REFAZER_OUVINTE_MS);
  log('comprovante de entrega por e-mail pronto (só age se estiver ligado em Pendências › Configurações)');
}

module.exports = { precisaDeComprovante, textoDoComprovante, iniciarComprovantePorEmail };
