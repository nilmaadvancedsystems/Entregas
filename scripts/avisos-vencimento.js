// Lembrete de vencimento no celular do CLIENTE, enviado pelo PC do robô.
//
// No link do cliente (portal) existe o botão "Me avise um dia antes de vencer".
// Quem toca guarda ali o endereço de notificação do próprio celular
// (portais/{token}.avisar). Uma vez por dia, a partir das 8h, este módulo olha
// as guias de cada link e avisa:
//   - o que vence amanhã;
//   - o que vence hoje;
//   - na sexta, também o que vence no fim de semana e na segunda (o PC do
//     escritório costuma ficar desligado sábado e domingo).
//
// Ninguém do escritório faz nada. Com o PC desligado o dia todo, o aviso
// daquele dia não sai — o cliente ainda tem a data no link e no calendário.
const { getMessaging } = require('firebase-admin/messaging');
const { FieldValue } = require('firebase-admin/firestore');

const fs = require('fs');
const path = require('path');
const BASE = 'https://nilmaadvancedsystems.github.io/Entregas/cliente.html';
// Quem já foi avisado hoje fica anotado. Se o vigia cair no meio da rodada e
// religar, os primeiros clientes não recebem o mesmo aviso de novo.
//
// A anotação mora no banco (robo/avisosVencimento), e não só num arquivo
// deste PC: na nuvem o disco nasce limpo a cada reinício, e quando a vez passa
// de uma máquina pra outra no meio do dia a que assume precisa saber o que a
// outra já avisou. O arquivo continua como reserva pra quando o banco falhar.
const ARQ_FEITOS = path.join(__dirname, 'avisos-vencimento-feitos.json');
const refFeitos = db => db.collection('robo').doc('avisosVencimento');
async function lerFeitos(db, dia) {
  try {
    const d = (await refFeitos(db).get()).data();
    if (d && d.dia === dia) return new Set(d.tokens || []);
    if (d) return new Set();
  } catch (e) { /* sem banco: vale o arquivo */ }
  try { const j = JSON.parse(fs.readFileSync(ARQ_FEITOS, 'utf8')); return j.dia === dia ? new Set(j.tokens) : new Set(); } catch (e) { return new Set(); }
}
async function gravarFeitos(db, dia, feitos) {
  const dados = { dia, tokens: Array.from(feitos) };
  try { fs.writeFileSync(ARQ_FEITOS, JSON.stringify(dados)); } catch (e) {}
  try { await refFeitos(db).set(dados); } catch (e) {}
}
// endereço de aviso que o Firebase diz que não existe mais (ou nunca existiu)
const ENDERECO_MORTO = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];
const HORA_MINIMA = 8;

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dinheiro = v => 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// Quais guias desta lista merecem aviso hoje, e com que palavra ("hoje",
// "amanhã", "segunda"). Função pura, pra poder testar sem rede.
function guiasParaAvisar(lista, hoje) {
  const alvo = new Map([[iso(hoje), 'hoje']]);
  const ate = hoje.getDay() === 5 ? 3 : 1;          // sexta olha até segunda
  for (let i = 1; i <= ate; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + i);
    alvo.set(iso(d), i === 1 ? 'amanhã' : DIAS[d.getDay()]);
  }
  return (Array.isArray(lista) ? lista : [])
    .filter(e => e && e.vencimento && e.status !== 'falha' && alvo.has(e.vencimento))
    .map(e => ({ entrega: e, quando: alvo.get(e.vencimento) }));
}

function textoDoAviso(achadas) {
  const nome = e => (e.itens || []).map(i => i.tipo + (i.valor != null ? ' ' + dinheiro(i.valor) : '')).join(', ') || 'guia';
  if (achadas.length === 1) {
    return { titulo: 'Vence ' + achadas[0].quando + ': ' + nome(achadas[0].entrega), corpo: 'Toque pra ver a guia e copiar o código.' };
  }
  return {
    titulo: achadas.length + ' guias vencendo',
    corpo: achadas.slice(0, 3).map(a => nome(a.entrega) + ' (' + a.quando + ')').join(' · ') + (achadas.length > 3 ? ' …' : ''),
  };
}

async function avisarHoje(db, log, hoje) {
  const dia = iso(hoje);
  const feitos = await lerFeitos(db, dia);
  const snap = await db.collection('portais').get();
  let enviados = 0, falhas = 0, primeiroErro = '';
  for (const doc of snap.docs) {
    if (feitos.has(doc.id)) continue;
    // um cliente com problema não pode parar o aviso dos outros
    try {
      const p = doc.data();
      const enderecos = Array.isArray(p.avisar) ? p.avisar.filter(t => typeof t === 'string' && t) : [];
      if (!enderecos.length) continue;
      const achadas = guiasParaAvisar(p.entregas && p.entregas.lista, hoje);
      if (!achadas.length) continue;
      const t = textoDoAviso(achadas);
      // Só "data": quem mostra o aviso é o service worker da página, que sabe
      // abrir o endereço do cliente no toque. Com "notification" o Firebase
      // mostrava por conta própria e o toque abria a tela de login do escritório.
      const r = await getMessaging().sendEachForMulticast({
        tokens: enderecos,
        data: { titulo: t.titulo, corpo: t.corpo, tag: 'vencimento', link: BASE + '?portal=' + doc.id },
        webpush: { headers: { Urgency: 'high', TTL: '43200' } },
      });
      enviados += r.successCount;
      falhas += r.failureCount;
      r.responses.forEach(x => { if (x.error && !primeiroErro) primeiroErro = x.error.code || x.error.message; });
      feitos.add(doc.id);
      await gravarFeitos(db, dia, feitos);
      const mortos = enderecos.filter((_, i) => r.responses[i].error && ENDERECO_MORTO.includes(r.responses[i].error.code));
      if (mortos.length) await doc.ref.update({ avisar: FieldValue.arrayRemove(...mortos) }).catch(() => {});
    } catch (err) {
      falhas++;
      if (!primeiroErro) primeiroErro = err.message;
    }
  }
  if (falhas) log('lembretes de vencimento:', falhas, 'falha(s); a primeira foi:', primeiroErro);
  return enviados;
}

function iniciarAvisosDeVencimento(db, log) {
  const estadoRef = db.collection('robo').doc('estado');
  let rodando = false;
  let feitoNoDia = '';   // na memória: não pergunta ao banco de meia em meia hora se já foi
  async function talvez() {
    const agora = new Date();
    if (rodando || agora.getHours() < HORA_MINIMA || feitoNoDia === iso(agora)) return;
    rodando = true;
    try {
      const estado = (await estadoRef.get()).data() || {};
      if (estado.vencimentos && estado.vencimentos.ultimoDia === iso(agora)) { feitoNoDia = iso(agora); return; }
      const enviados = await avisarHoje(db, log, agora);
      await estadoRef.set({ vencimentos: { ultimoDia: iso(agora), enviados, em: agora.toISOString() } }, { merge: true });
      feitoNoDia = iso(agora);
      log('lembretes de vencimento pros clientes:', enviados, 'enviado(s)');
    } catch (err) {
      log('lembretes de vencimento falharam:', err.message);
    } finally { rodando = false; }
  }
  setTimeout(talvez, 3 * 60 * 1000);
  setInterval(talvez, 30 * 60 * 1000);
  log('lembrete de vencimento pros clientes ligado (uma vez por dia, a partir das ' + HORA_MINIMA + 'h)');
}

module.exports = { guiasParaAvisar, textoDoAviso, iniciarAvisosDeVencimento };
