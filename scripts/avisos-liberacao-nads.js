// Aviso no celular dos administradores quando alguém pede para liberar o login do nads (proteção do login,
// 30/09/2026). O pedido aparece na tela do Tarefas de quem está com ela aberta; este aviso (o mesmo das entregas,
// avisos-push.js) chama os outros admins, onde estiverem. Tocar abre o Tarefas, onde está o Aprovar e o código.
//   nadsPedidos/{id} { uid, nome, email, computador, authTime, status: 'pendente', criadoEm }  -> grava avisadoEm
// Pedido com mais de 30 min não avisa (já venceu para o admin); cada pedido avisa uma vez só.
const { ouvir } = require('./ouvinte');

const LINK = 'https://tarefas-nilma.web.app/';
const VELHO_MS = 30 * 60 * 1000;

/** O aviso de um pedido (ou null quando ele não deve avisar). */
function avisoDoPedido(p, agora) {
  if (!p || p.status !== 'pendente' || p.avisadoEm) return null;
  const criado = Date.parse(p.criadoEm || '');
  if (!criado || agora - criado > VELHO_MS) return null;
  const quem = String(p.nome || p.email || 'Alguém').trim();
  return { titulo: 'Liberar o nads', corpo: quem + ' quer entrar no nads (' + (p.computador || 'computador novo') + '). Toque para aprovar e ver o código.' };
}

function iniciarAvisosDeLiberacao(db, log, avisos) {
  if (!avisos) { log('aviso de liberação do nads desligado (sem avisos no celular)'); return; }
  const vistos = new Set();
  ouvir('pedidos de liberação do nads', () => db.collection('nadsPedidos').where('status', '==', 'pendente').limit(20), snap => {
    for (const d of snap.docs) {
      if (vistos.has(d.id)) continue;
      const aviso = avisoDoPedido(d.data(), Date.now());
      if (!aviso) continue;
      vistos.add(d.id);
      avisos.enviar('admin', '', aviso.titulo, aviso.corpo, 'nads-liberacao-' + d.id, LINK)
        .then(() => d.ref.update({ avisadoEm: new Date().toISOString() }))
        .then(() => log('aviso de liberação do nads:', d.get('nome') || d.get('email')))
        .catch(err => log('aviso de liberação do nads não saiu:', err.message));
    }
  }, log);
  log('aviso de liberação do nads no celular dos admins: ligado');
}

module.exports = { avisoDoPedido, iniciarAvisosDeLiberacao };
