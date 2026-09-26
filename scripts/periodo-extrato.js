// Extrato que não cobre o mês inteiro.
//
// O cliente às vezes manda o extrato tirado no meio do mês ("Período:
// 01/08/2026 a 15/08/2026"). Antes o robô marcava o extrato como recebido e
// ninguém percebia que faltava o resto. Aqui o robô lê o período escrito no
// próprio extrato e diz se ele vai do primeiro ao último dia útil do mês da
// competência.
//
// Só vale o período ESCRITO ("período", "extrato de ... até ...", "data
// inicial/final"): as datas dos lançamentos não servem, porque um mês com
// pouco movimento termina no dia 20 sem estar incompleto. Extrato sem período
// escrito continua sendo aceito como antes.

const pad2 = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const curta = d => pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1);

function data(dia, mes, ano) {
  let a = Number(ano);
  if (a < 100) a += 2000;
  const d = new Date(a, Number(mes) - 1, Number(dia));
  return d.getMonth() === Number(mes) - 1 && d.getDate() === Number(dia) ? d : null;
}

const DATA = '(\\d{2})[\\/.-](\\d{2})[\\/.-](\\d{4}|\\d{2})';
// "Período: 01/08/2026 a 31/08/2026", "PERÍODO DE 01/08/2026 ATÉ 15/08/2026",
// "Extrato de 01/08/2026 até 31/08/2026", "Período de visualização: ... - ...",
// "Data inicial: 01/08/2026 Data final: 15/08/2026"
const PADROES = [
  new RegExp('(?:per[ií]odo|extrato\\s+(?:de|do\\s+per[ií]odo)|movimenta[çc][ãa]o\\s+de)[^0-9\\n]{0,40}' + DATA + '[^0-9\\n]{1,25}?' + DATA, 'i'),
  new RegExp('data\\s+inicial[^0-9\\n]{0,10}' + DATA + '[\\s\\S]{0,60}?data\\s+final[^0-9\\n]{0,10}' + DATA, 'i'),
];

// { de: Date, ate: Date } do período escrito no texto, ou null.
function periodoDoTexto(texto) {
  const t = String(texto || '');
  for (const re of PADROES) {
    const m = t.match(re);
    if (!m) continue;
    const de = data(m[1], m[2], m[3]), ate = data(m[4], m[5], m[6]);
    if (de && ate && ate >= de && ate - de < 400 * 864e5) return { de, ate };
  }
  return null;
}

function diaUtil(d, passo) {
  const x = new Date(d);
  while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + passo);
  return x;
}

// O período cobre a competência ('AAAA-MM')? Um dia de folga nas pontas
// (feriado no fim do mês). Devolve null se o período nem é deste mês.
// -> { completo, de, ate, texto } (datas em AAAA-MM-DD)
function avaliarPeriodo(periodo, competencia) {
  if (!periodo) return null;
  const [a, m] = String(competencia || '').split('-').map(Number);
  if (!a || !m) return null;
  const inicio = new Date(a, m - 1, 1), fim = new Date(a, m, 0);
  if (periodo.ate < inicio || periodo.de > fim) return null;
  const primeiroUtil = diaUtil(inicio, 1), ultimoUtil = diaUtil(fim, -1);
  const folga = 864e5;
  const comecaTarde = periodo.de - primeiroUtil > folga;
  const acabaCedo = ultimoUtil - periodo.ate > folga;
  const completo = !comecaTarde && !acabaCedo;
  let texto = '';
  if (acabaCedo && comecaTarde) texto = 'só de ' + curta(periodo.de) + ' a ' + curta(periodo.ate);
  else if (acabaCedo) texto = 'só até ' + curta(periodo.ate);
  else if (comecaTarde) texto = 'só a partir de ' + curta(periodo.de);
  return { completo, de: iso(periodo.de), ate: iso(periodo.ate), texto };
}

module.exports = { periodoDoTexto, avaliarPeriodo };
