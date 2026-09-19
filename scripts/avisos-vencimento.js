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

const BASE = 'https://nilmaadvancedsystems.github.io/Entregas/entregas.html';
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
  const snap = await db.collection('portais').get();
  let enviados = 0;
  for (const doc of snap.docs) {
    const p = doc.data();
    const enderecos = Array.isArray(p.avisar) ? p.avisar.filter(t => typeof t === 'string' && t) : [];
    if (!enderecos.length) continue;
    const achadas = guiasParaAvisar(p.entregas && p.entregas.lista, hoje);
    if (!achadas.length) continue;
    const t = textoDoAviso(achadas);
    const r = await getMessaging().sendEachForMulticast({
      tokens: enderecos,
      notification: { title: t.titulo, body: t.corpo },
      data: { tag: 'vencimento' },
      webpush: { fcmOptions: { link: BASE + '?portal=' + doc.id } },
    });
    enviados += r.successCount;
    const mortos = enderecos.filter((_, i) => r.responses[i].error && r.responses[i].error.code === 'messaging/registration-token-not-registered');
    if (mortos.length) await doc.ref.update({ avisar: FieldValue.arrayRemove(...mortos) }).catch(() => {});
  }
  return enviados;
}

function iniciarAvisosDeVencimento(db, log) {
  const estadoRef = db.collection('robo').doc('estado');
  let rodando = false;
  async function talvez() {
    const agora = new Date();
    if (rodando || agora.getHours() < HORA_MINIMA) return;
    rodando = true;
    try {
      const estado = (await estadoRef.get()).data() || {};
      if (estado.vencimentos && estado.vencimentos.ultimoDia === iso(agora)) return;
      const enviados = await avisarHoje(db, log, agora);
      await estadoRef.set({ vencimentos: { ultimoDia: iso(agora), enviados, em: agora.toISOString() } }, { merge: true });
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
