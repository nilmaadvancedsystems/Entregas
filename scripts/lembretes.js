// Lembretes do escritório, avisados pelo PC do robô.
//
// O admin escreve em Clientes e ajustes › Lembretes do escritório: um texto,
// um dia do mês e pra qual cargo. Aqui, uma vez por dia a partir das 8h, o
// que cai hoje vira notificação no celular de quem tem aquele cargo.
//
// Cuidados:
//   - dia que cai em sábado, domingo ou feriado avisa no próximo dia útil
//     (senão o aviso morre no fim de semana e ninguém lembra na segunda);
//   - marca o dia ANTES de avisar, então vigia religado não repete;
//   - sem lembrete nenhum, custa uma leitura por hora e nada mais.
const { ouvir } = require('./ouvinte');

const HORA_MINIMA = 8;
const MAX_POR_DIA = 12;

const pad2 = n => String(n).padStart(2, '0');
const diaIso = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

// Feriados nacionais do ano, da BrasilAPI (a mesma fonte que o app usa).
// Se a consulta falhar, o dia útil considera só sábado e domingo.
async function feriadosDoAno(ano) {
  try {
    const r = await fetch('https://brasilapi.com.br/api/feriados/v1/' + ano);
    if (!r.ok) return new Set();
    const lista = await r.json();
    return new Set((Array.isArray(lista) ? lista : []).map(f => f && f.date).filter(Boolean));
  } catch (e) { return new Set(); }
}

function ehDiaUtil(d, feriados) {
  return d.getDay() !== 0 && d.getDay() !== 6 && !feriados.has(diaIso(d));
}

// Em que dia ESTE lembrete deve sair neste mês: o dia escolhido, ou o
// primeiro dia útil depois dele.
function diaDoAviso(ano, mes, dia, feriados) {
  const d = new Date(ano, mes, Math.min(Math.max(Number(dia) || 1, 1), 28));
  let voltas = 0;
  while (!ehDiaUtil(d, feriados) && voltas < 10) { d.setDate(d.getDate() + 1); voltas++; }
  return diaIso(d);
}

// Quais lembretes saem hoje.
function lembretesDeHoje(itens, agora, feriados) {
  const hoje = diaIso(agora);
  return (Array.isArray(itens) ? itens : [])
    .filter(l => l && l.texto && l.dia)
    .filter(l => diaDoAviso(agora.getFullYear(), agora.getMonth(), l.dia, feriados) === hoje)
    .slice(0, MAX_POR_DIA);
}

function iniciarLembretes({ db, log, avisos }) {
  if (!avisos) { log('lembretes do escritório: sem aviso no celular, módulo parado'); return; }
  const estadoRef = db.collection('robo').doc('estado');
  const configRef = db.collection('config').doc('lembretes');
  let rodando = false;
  let feitoEm = '';
  let feriados = new Set();
  let feriadosDe = 0;

  async function talvez() {
    const agora = new Date();
    const hoje = diaIso(agora);
    if (rodando || feitoEm === hoje || agora.getHours() < HORA_MINIMA) return;
    rodando = true;
    try {
      const cfg = (await configRef.get()).data() || {};
      const itens = Array.isArray(cfg.itens) ? cfg.itens : [];
      if (!itens.length) return;
      if (feriadosDe !== agora.getFullYear()) { feriados = await feriadosDoAno(agora.getFullYear()); feriadosDe = agora.getFullYear(); }
      const hojeLembretes = lembretesDeHoje(itens, agora, feriados);
      if (!hojeLembretes.length) { feitoEm = hoje; return; }
      const estado = (await estadoRef.get()).data() || {};
      if (estado.lembretesEm === hoje) { feitoEm = hoje; return; }
      // marca antes: se cair no meio, não repete o que já saiu
      await estadoRef.set({ lembretesEm: hoje }, { merge: true });
      feitoEm = hoje;
      for (const l of hojeLembretes) {
        const titulo = hojeLembretes.length === 1 ? 'Lembrete do escritório' : 'Lembrete: dia ' + l.dia;
        await avisos.enviar(l.quem || '', '', titulo, l.texto, 'lembrete')
          .catch(err => log('lembrete não saiu:', err.message));
      }
      log('lembrete(s) do dia enviados:', hojeLembretes.map(l => l.texto).join(' · '));
    } catch (err) {
      log('lembretes do escritório falharam:', err.message);
    } finally { rodando = false; }
  }

  setTimeout(talvez, 4 * 60 * 1000);
  setInterval(talvez, 60 * 60 * 1000);
  log('lembretes do escritório ligados (a partir das ' + HORA_MINIMA + 'h)');
}

module.exports = { diaDoAviso, lembretesDeHoje, ehDiaUtil, iniciarLembretes };
