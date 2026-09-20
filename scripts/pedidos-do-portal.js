// Recado que o cliente manda pela página dele ("Falar com o escritório").
//
// Ele grava em pedidosDoPortal; aqui, no PC do robô, o recado vira uma
// solicitação na mesma fila que o office boy já usa, com o nome do cliente
// junto, e o pedido original é apagado. Quem tem o cargo de office boy
// recebe aviso no celular.
//
// Cuidados:
//   - o token diz de quem é: sem portal, ou com link já trocado, o recado é
//     descartado (não vira solicitação anônima);
//   - a coleção é pequena e esvazia sozinha, então o ouvinte custa quase nada.
const { ouvir } = require('./ouvinte');

const ASSUNTOS = {
  'segunda-via': { tipo: 'documento', titulo: 'Segunda via de guia' },
  'buscar-documento': { tipo: 'documento', titulo: 'Buscar documento no cliente' },
  'duvida': { tipo: 'outro', titulo: 'Dúvida do cliente' },
  'outro': { tipo: 'outro', titulo: 'Recado do cliente' },
};

// O que vai virar solicitação. Função pura, pra testar sem rede.
function solicitacaoDoPedido(pedido, cliente, agora) {
  const assunto = ASSUNTOS[pedido && pedido.assunto] || ASSUNTOS.outro;
  const nome = (cliente && (cliente.nomeFantasia || cliente.nome)) || 'cliente';
  return {
    tipo: assunto.tipo,
    local: nome,
    descricao: assunto.titulo + ' — ' + nome + ': ' + String((pedido && pedido.texto) || '').trim().slice(0, 400),
    urgente: false,
    status: 'pendente',
    criadoPor: 'pagina-do-cliente',
    criadoPorNome: nome + ' (pela página dele)',
    criadoEm: (agora || new Date()).toISOString(),
    clienteId: (cliente && cliente.id) || null,
  };
}

function iniciarPedidosDoPortal(db, log, avisos) {
  const tratando = new Set();

  async function tratar(doc) {
    if (tratando.has(doc.id)) return;
    tratando.add(doc.id);
    const pedido = doc.data() || {};
    try {
      const portal = await db.collection('portais').doc(String(pedido.token || '-')).get();
      if (!portal.exists) { await doc.ref.delete(); log('recado de link que não existe mais, descartado'); return; }
      const cs = await db.collection('clientes').doc(String(portal.data().clienteId || '-')).get();
      // link trocado depois do recado: não dá pra dizer de quem é
      if (!cs.exists || cs.data().portalToken !== pedido.token) {
        await doc.ref.delete();
        log('recado de link antigo, descartado');
        return;
      }
      const cliente = Object.assign({ id: cs.id }, cs.data());
      await db.collection('solicitacoes').add(solicitacaoDoPedido(pedido, cliente));
      await doc.ref.delete();
      log('recado do cliente virou solicitação:', cliente.nome, '-', pedido.assunto);
      if (avisos) {
        avisos.enviar('office_boy', '', 'Pedido de cliente', (cliente.nomeFantasia || cliente.nome || 'Cliente') + ': ' + String(pedido.texto || '').slice(0, 80), 'pedido')
          .catch(err => log('aviso do recado não saiu:', err.message));
      }
    } catch (err) {
      log('recado do cliente ficou esperando:', err.message);
    } finally { tratando.delete(doc.id); }
  }

  ouvir('recados da página do cliente', () => db.collection('pedidosDoPortal').limit(10), snap => {
    snap.docs.forEach(d => { tratar(d); });
  }, log);
  // o que ficou pra trás (banco fora do ar na hora) é tentado de novo
  setInterval(async () => {
    try { (await db.collection('pedidosDoPortal').limit(10).get()).docs.forEach(d => { tratar(d); }); } catch (e) {}
  }, 30 * 60 * 1000);
  log('recados da página do cliente: ligado');
}

module.exports = { solicitacaoDoPedido, iniciarPedidosDoPortal };
