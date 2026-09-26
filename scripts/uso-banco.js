// Quanto o banco já usou hoje, de verdade: leituras, gravações e exclusões do
// sistema inteiro, contadas pelo próprio Google.
//
// O cartão "Saúde do sistema" do Entregas contava só as leituras daquele
// navegador: ficavam de fora o robô, a Pendências e os aparelhos das outras
// pessoas, e o dia virava à meia-noite daqui, não à do Google. Mostrava 2%
// num dia em que o limite podia estar perto.
//
// O limite grátis do Firestore (50 mil leituras, 20 mil gravações e 20 mil
// exclusões por dia) zera à meia-noite da Califórnia. A cada 15 minutos o
// robô pergunta ao Cloud Monitoring quanto foi usado desde essa hora e grava
// em robo/uso, que a tela lê uma vez ao abrir o cartão. Só leitura no Google;
// a única gravação é o próprio robo/uso.
require('./fuso.js');
const { GoogleAuth } = require('google-auth-library');

const PROJETO = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'entregas-2e5e2';
const A_CADA_MS = 15 * 60 * 1000;
const METRICAS = {
  leituras: 'firestore.googleapis.com/document/read_ops_count',
  gravacoes: 'firestore.googleapis.com/document/write_ops_count',
  exclusoes: 'firestore.googleapis.com/document/delete_ops_count',
};

// Meia-noite de hoje na Califórnia (a hora em que o Google zera a cota).
function inicioDoDiaDaCota(agora) {
  const partes = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(agora).forEach(p => { partes[p.type] = Number(p.value); });
  const passados = ((partes.hour * 60 + partes.minute) * 60 + partes.second) * 1000 + agora.getMilliseconds();
  return new Date(agora.getTime() - passados);
}

// Soma todos os pontos de uma métrica no intervalo (uma série por tipo de
// operação e banco; o Google já devolve somado com REDUCE_SUM).
function somaDaResposta(dados) {
  let total = 0;
  for (const serie of (dados && dados.timeSeries) || []) {
    for (const ponto of serie.points || []) {
      const v = ponto.value || {};
      total += Number(v.int64Value || v.doubleValue || 0);
    }
  }
  return total;
}

function iniciarUsoDoBanco(db, log, opcoes) {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/monitoring.read'] });
  const ref = db.collection('robo').doc('uso');
  let ultimoErro = '';

  async function somar(metrica, desde, ate, cliente) {
    const segundos = Math.max(60, Math.ceil((ate - desde) / 1000));
    const params = new URLSearchParams({
      filter: 'metric.type="' + metrica + '"',
      'interval.startTime': desde.toISOString(),
      'interval.endTime': ate.toISOString(),
      'aggregation.alignmentPeriod': segundos + 's',
      'aggregation.perSeriesAligner': 'ALIGN_SUM',
      'aggregation.crossSeriesReducer': 'REDUCE_SUM',
    });
    const r = await cliente.request({ url: 'https://monitoring.googleapis.com/v3/projects/' + PROJETO + '/timeSeries?' + params });
    return somaDaResposta(r.data);
  }

  async function medir() {
    const agora = new Date();
    const desde = inicioDoDiaDaCota(agora);
    try {
      const cliente = await auth.getClient();
      const uso = { desde: desde.toISOString(), em: agora.toISOString(), fonte: 'google', erro: null };
      for (const [campo, metrica] of Object.entries(METRICAS)) uso[campo] = await somar(metrica, desde, agora, cliente);
      await ref.set(uso);
      ultimoErro = '';
    } catch (err) {
      const msg = (err && err.response && err.response.data && err.response.data.error && err.response.data.error.message) || (err && err.message) || String(err);
      // Sem permissão pra ler as métricas: a tela volta a contar só o aparelho.
      if (msg !== ultimoErro) log('uso do banco: não consegui ler os números do Google:', msg);
      ultimoErro = msg;
      await ref.set({ erro: msg.slice(0, 300), em: agora.toISOString() }, { merge: true }).catch(() => {});
    }
  }

  if (opcoes && opcoes.semRelogio) return { medir };
  medir();
  setInterval(medir, A_CADA_MS);
  log('uso do banco ligado (lê os números do Google a cada ' + Math.round(A_CADA_MS / 60000) + ' min)');
}

module.exports = { iniciarUsoDoBanco, inicioDoDiaDaCota, somaDaResposta };
