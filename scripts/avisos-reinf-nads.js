// Aviso no celular do responsável do DP quando o Fiscal transmite a REINF de um cliente (nads, 07/10/2026: "quando
// transmitir a REINF, quero que apareça para o responsável do DP na aba de REINF e o notifique"). O nads marca a etapa
// REINF do DP como feita "pelo Fiscal" e guarda quem avisar:
//   rotinas/{empresa}_{aaaa-mm}_dp.etapas['dp-reinf'] = { situacao: 'feita', por: 'Heverton (Fiscal)', em, avisar: 'Fabiana' }
// Este módulo (o mesmo aviso das entregas, avisos-push.js) acha a pessoa pelo nome (ou pelo começo do e-mail), avisa só
// ela e grava avisadoEm. Transmissão com mais de 2 dias não avisa; cada uma avisa uma vez só.
const { ouvir } = require('./ouvinte');

// tocar abre as Obrigações do DP (a tabela com a coluna REINF), no mês da transmissão
const LINK = c => 'https://tarefas-nilma.web.app/tarefas/dp/obrigacoes?competencia=' + c;
const VELHO_MS = 2 * 24 * 60 * 60 * 1000;

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** O aviso de uma execução do DP (ou null quando ela não deve avisar). */
function avisoDaReinf(ex, agora) {
  const e = ex && ex.etapas && ex.etapas['dp-reinf'];
  if (!e || e.situacao !== 'feita' || !e.avisar || e.avisadoEm) return null;
  const em = Date.parse(e.em || '');
  if (!em || agora - em > VELHO_MS) return null;
  const comp = String(ex.competencia || '');
  const mes = comp.slice(5, 7) + '/' + comp.slice(0, 4);
  return {
    link: LINK(comp),
    para: String(e.avisar),
    titulo: 'REINF transmitida',
    corpo: (ex.codigo != null ? ex.codigo + ' · ' : '') + (ex.empresa || 'cliente') + ' · ' + mes + ' — transmitida por ' + String(e.por || 'o Fiscal'),
  };
}

/** O usuário de um nome do DP ("Fabiana", "Gustavo.P"): pelo nome, pelo primeiro nome ou pelo começo do e-mail. */
function usuarioDoNome(usuarios, nome) {
  const alvo = norm(nome);
  if (!alvo) return null;
  const achar = f => usuarios.find(u => f(u.data())) || null;
  return achar(u => norm(u.nome) === alvo)
    || achar(u => norm(String(u.email || '').split('@')[0]) === alvo)
    || achar(u => norm(u.nome).split(/\s+/)[0] === alvo);
}

function iniciarAvisosDaReinf(db, log, avisos) {
  if (!avisos || !avisos.enviarPara) { log('aviso da REINF do nads desligado (sem avisos no celular)'); return; }
  const vistos = new Set();
  // as competências que podem ter transmissão nova: o mês passado e os dois antes dele
  const competencias = () => {
    const d = new Date();
    return [1, 2, 3].map(k => { const x = new Date(d.getFullYear(), d.getMonth() - k + 1, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); });
  };
  ouvir('REINF transmitida pelo Fiscal (nads)', () => db.collection('rotinas').where('departamento', '==', 'dp').where('competencia', 'in', competencias()), async snap => {
    const pendentes = [];
    for (const d of snap.docs) {
      const aviso = avisoDaReinf(d.data(), Date.now());
      const chave = d.id + '|' + ((d.data().etapas || {})['dp-reinf'] || {}).em;
      if (!aviso || vistos.has(chave)) continue;
      vistos.add(chave);
      pendentes.push({ d, aviso });
    }
    if (!pendentes.length) return;
    const usuarios = (await db.collection('usuarios').get()).docs;
    for (const { d, aviso } of pendentes) {
      const u = usuarioDoNome(usuarios, aviso.para);
      const marcar = () => d.ref.update({ 'etapas.dp-reinf.avisadoEm': new Date().toISOString() });
      if (!u) { log('aviso da REINF: não achei o usuário de', aviso.para); await marcar().catch(() => {}); continue; }
      await avisos.enviarPara([u.id], aviso.titulo, aviso.corpo, 'nads-reinf-' + d.id, aviso.link)
        .then(marcar)
        .then(() => log('aviso da REINF para', aviso.para + ':', aviso.corpo))
        .catch(err => log('aviso da REINF não saiu:', err.message));
    }
  }, log);
  log('aviso da REINF transmitida pelo Fiscal no celular do responsável do DP: ligado');
}

module.exports = { avisoDaReinf, usuarioDoNome, iniciarAvisosDaReinf };
