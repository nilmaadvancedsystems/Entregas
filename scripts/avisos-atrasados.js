// Aviso diário no celular: tarefas e parcelas atrasadas (tarefas.html).
//
// Uma vez por dia útil, a partir das 8h, o PC do robô olha as tarefas abertas
// e os parcelamentos ativos e avisa cada pessoa do que é DELA:
//   - tarefa atrasada ou que vence hoje -> o responsável da tarefa;
//   - parcela atrasada, que vence hoje ou em até 3 dias -> o responsável da
//     empresa (clientes.responsavelUid);
//   - quem está de férias/folga hoje não recebe: vai pra quem cobre
//     (ausencias/{uid}.cobreUid); sem ninguém cobrindo, ou sem responsável,
//     vai pro admin;
//   - o admin recebe, junto, o resumo do escritório.
// Marca o dia ANTES de avisar (robo/estado.atrasadosEm): vigia religado não
// repete. Custa 4 leituras de coleção por dia (tarefas abertas, parcelamentos
// ativos, ausências, usuários); clientes vêm do arquivo local.
const cacheDeClientes = require('./clientes-cache');
const { situacao } = require('./parcela-paga');

const HORA_MINIMA = 8;
const LINK = 'https://nilmaadvancedsystems.github.io/Entregas/tarefas.html';
const NOME_ORGAO = { pgfn: 'PGFN', simples: 'Simples', receita: 'Receita', estadual: 'Estado', municipal: 'Prefeitura', outro: 'Parcelamento' };

const pad2 = n => String(n).padStart(2, '0');
const diaIso = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const nomeCurto = c => (c && (c.nomeFantasia || c.nome)) || 'cliente';

// -> { porPessoa: Map(uid -> itens), escritorio: { tarefas, parcelamentos } }
function montarAvisos({ tarefas, parcelamentos, clientes, ausencias, admins, hoje }) {
  const porPessoa = new Map();
  const itensDe = uid => { if (!porPessoa.has(uid)) porPessoa.set(uid, { tarefasAtrasadas: [], tarefasHoje: [], parcelasAtrasadas: [], parcelasHoje: [], parcelasPerto: [] }); return porPessoa.get(uid); };
  const fora = uid => { const a = uid && ausencias.get(uid); return a && a.de <= hoje && hoje <= a.ate ? a : null; };
  // pra quem vai: o dono; fora hoje, quem cobre; sem ninguém, os admins
  const destinos = uid => {
    if (uid && !fora(uid)) return [uid];
    const a = fora(uid);
    if (a && a.cobreUid && !fora(a.cobreUid)) return [a.cobreUid];
    return admins.filter(x => !fora(x));
  };
  const escritorio = { tarefas: 0, parcelamentos: 0 };
  (tarefas || []).forEach(t => {
    if (!t || t.aberta === false || t.status === 'feito' || !t.prazo) return;
    const quando = t.prazo < hoje ? 'tarefasAtrasadas' : t.prazo === hoje ? 'tarefasHoje' : null;
    if (!quando) return;
    if (quando === 'tarefasAtrasadas') escritorio.tarefas++;
    destinos(t.responsavelUid).forEach(u => itensDe(u)[quando].push(t.titulo || 'tarefa'));
  });
  (parcelamentos || []).forEach(p => {
    if (!p || p.aberto === false || (p.status && p.status !== 'ativo') || !p.primeira) return;
    const sx = situacao(p, hoje);
    const c = clientes.get(p.clienteId);
    const rotulo = (NOME_ORGAO[p.orgao] || 'Parcelamento') + ' de ' + (c ? nomeCurto(c) : String(p.clienteNome || 'cliente').replace(/^\s*\d+\s*-\s*/, ''));
    let quando = null;
    if (sx.atrasadas.length) { quando = 'parcelasAtrasadas'; escritorio.parcelamentos++; }
    else if (sx.atual && !sx.atualPaga) {
      const d = diasEntre(hoje, sx.vencAtual);
      if (d === 0) quando = 'parcelasHoje';
      else if (d > 0 && d <= 3) quando = 'parcelasPerto';
    }
    if (!quando) return;
    destinos(c && c.responsavelUid).forEach(u => itensDe(u)[quando].push(rotulo));
  });
  return { porPessoa, escritorio };
}

function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
function lista(xs) { return xs.slice(0, 2).join(', ') + (xs.length > 2 ? ' e mais ' + (xs.length - 2) : ''); }

// o texto de uma pessoa (com o resumo do escritório, se for admin) ou null
function textoDoAviso(itens, escritorio) {
  const partes = [];
  let link = LINK + '#minhas';
  if (itens) {
    if (itens.parcelasAtrasadas.length) partes.push('Parcela atrasada: ' + lista(itens.parcelasAtrasadas));
    if (itens.parcelasHoje.length) partes.push('Parcela vence hoje: ' + lista(itens.parcelasHoje));
    if (itens.parcelasPerto.length) partes.push('Parcela vence esta semana: ' + lista(itens.parcelasPerto));
    if (itens.tarefasAtrasadas.length) partes.push(plural(itens.tarefasAtrasadas.length, 'tarefa atrasada', 'tarefas atrasadas') + (itens.tarefasAtrasadas.length <= 2 ? ' (' + lista(itens.tarefasAtrasadas) + ')' : ''));
    if (itens.tarefasHoje.length) partes.push(plural(itens.tarefasHoje.length, 'tarefa vence hoje', 'tarefas vencem hoje'));
    const soParcela = !itens.tarefasAtrasadas.length && !itens.tarefasHoje.length && partes.length;
    if (soParcela) link = LINK + '#parcelamentos';
  }
  if (escritorio && (escritorio.tarefas || escritorio.parcelamentos)) {
    partes.push('Escritório: ' + [escritorio.tarefas ? plural(escritorio.tarefas, 'tarefa atrasada', 'tarefas atrasadas') : '', escritorio.parcelamentos ? plural(escritorio.parcelamentos, 'parcelamento atrasado', 'parcelamentos atrasados') : ''].filter(Boolean).join(', '));
  }
  if (!partes.length) return null;
  const atraso = itens && (itens.parcelasAtrasadas.length || itens.tarefasAtrasadas.length);
  return { titulo: atraso ? 'Você tem coisa atrasada' : 'Pendências de hoje', corpo: partes.join(' · ').slice(0, 300), link };
}

function iniciarAvisosAtrasados({ db, log, avisos }) {
  if (!avisos || !avisos.enviarPara) { log('aviso de atrasados: sem aviso no celular, módulo parado'); return; }
  const estadoRef = db.collection('robo').doc('estado');
  let rodando = false, feitoEm = '';

  async function talvez() {
    const agora = new Date(), hoje = diaIso(agora);
    if (rodando || feitoEm === hoje || agora.getHours() < HORA_MINIMA || agora.getDay() === 0 || agora.getDay() === 6) return;
    rodando = true;
    try {
      const estado = (await estadoRef.get()).data() || {};
      if (estado.atrasadosEm === hoje) { feitoEm = hoje; return; }
      const [tSnap, pSnap, aSnap, uSnap] = await Promise.all([
        db.collection('tarefas').where('aberta', '==', true).get(),
        db.collection('parcelamentos').where('aberto', '==', true).get(),
        db.collection('ausencias').get(),
        db.collection('usuarios').get(),
      ]);
      const clientes = new Map();
      (await cacheDeClientes.clientesAtivos(db, log)).forEach(d => clientes.set(d.id, Object.assign({ id: d.id }, d.data())));
      const ausencias = new Map(aSnap.docs.map(d => [d.id, d.data()]));
      const admins = uSnap.docs.filter(d => (d.data().roles || []).includes('admin')).map(d => d.id);
      const { porPessoa, escritorio } = montarAvisos({
        tarefas: tSnap.docs.map(d => d.data()), parcelamentos: pSnap.docs.map(d => d.data()), clientes, ausencias, admins, hoje,
      });
      admins.forEach(u => { if (!porPessoa.has(u) && (escritorio.tarefas || escritorio.parcelamentos)) porPessoa.set(u, null); });
      // marca antes de avisar: vigia religado não manda de novo
      await estadoRef.set({ atrasadosEm: hoje }, { merge: true });
      feitoEm = hoje;
      let enviados = 0;
      for (const [uid, itens] of porPessoa) {
        const txt = textoDoAviso(itens, admins.includes(uid) ? escritorio : null);
        if (!txt) continue;
        await avisos.enviarPara([uid], txt.titulo, txt.corpo, 'atrasados', txt.link).catch(err => log('aviso de atrasados não saiu:', err.message));
        enviados++;
      }
      log('aviso de atrasados: ' + enviados + ' pessoa(s); escritório com ' + escritorio.tarefas + ' tarefa(s) e ' + escritorio.parcelamentos + ' parcelamento(s) atrasados');
    } catch (err) {
      log('aviso de atrasados falhou:', err.message);
    } finally { rodando = false; }
  }

  setTimeout(talvez, 6 * 60 * 1000);
  setInterval(talvez, 60 * 60 * 1000);
  log('aviso de tarefas e parcelas atrasadas ligado (dias úteis, a partir das ' + HORA_MINIMA + 'h)');
}

module.exports = { montarAvisos, textoDoAviso, iniciarAvisosAtrasados };
