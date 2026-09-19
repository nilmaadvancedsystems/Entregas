// Entrega pelo link: o cliente toca em "Recebi" na página dele, e o PC do robô
// transforma isso em entrega confirmada.
//
// O toque do cliente fica em portais/{token}.recebido[entregaId] = "data|nome".
// Ele sozinho não confirma nada — quem está do outro lado do link não tem
// login, e a regra só deixa gravar esse campo. Aqui o robô confere que a
// entrega existe, que é de uma empresa daquele link e que ainda estava
// esperando no link; só então marca como confirmada, com a marca
// "recebidoPeloLink" (é o que o Protocolo do mês mostra: recebido pelo link,
// sem assinatura).
//
// Com o PC desligado, o cliente já vê "Recebido" na página dele; o registro na
// entrega acontece quando o PC voltar.

// "2026-09-19T12:00:00.000Z|Maria" -> { em, nome }. Função pura, testável.
function lerToque(valor) {
  const partes = String(valor || '').split('|');
  const em = partes[0];
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(em) || isNaN(new Date(em))) return null;
  return { em: new Date(em).toISOString(), nome: partes.slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 60) };
}

// A entrega pode ser confirmada por este link? Só se estava esperando no link e
// é de uma empresa que o link mostra.
function podeConfirmar(entrega, portal, empresasDoLink) {
  if (!entrega || entrega.status !== 'link') return false;
  return empresasDoLink.includes(entrega.clienteId);
}

function iniciarEntregaPeloLink(db, log) {
  const { FieldValue } = require('firebase-admin/firestore');
  const jaVistas = new Set();   // token|entregaId já resolvidos nesta execução
  async function tratar(doc) {
    const p = doc.data();
    const recebido = p.recebido && typeof p.recebido === 'object' ? p.recebido : {};
    for (const entregaId of Object.keys(recebido)) {
      const chave = doc.id + '|' + entregaId;
      if (jaVistas.has(chave)) continue;
      jaVistas.add(chave);
      const toque = lerToque(recebido[entregaId]);
      if (!toque || !/^[A-Za-z0-9_-]{6,40}$/.test(entregaId)) continue;
      try {
        const ref = db.collection('entregas').doc(entregaId);
        const snap = await ref.get();
        if (!snap.exists) continue;
        // empresas que este link mostra: a dona e as aglutinadas a ela
        const seguidoras = await db.collection('clientes').where('grupoLocal', '==', p.clienteId).get();
        const empresas = [p.clienteId].concat(seguidoras.docs.map(d => d.id));
        if (!podeConfirmar(snap.data(), p, empresas)) {
          // toque velho de entrega que já está confirmada: sai do link, pra não ser relido a cada vez que o robô liga
          if (snap.data().status === 'confirmada') await doc.ref.update({ ['recebido.' + entregaId]: FieldValue.delete() }).catch(() => {});
          continue;
        }
        const agora = new Date().toISOString();
        await ref.update({
          status: 'confirmada', confirmadoEm: agora, recebedor: toque.nome || 'cliente, pelo link',
          recebidoPeloLink: true, tocouEm: toque.em,
          entregadoPor: 'link-do-cliente', entregadoPorNome: 'Link do cliente',
          temAssinatura: false, falha: false,
        });
        // a página do cliente reflete na hora, sem esperar o app de alguém regravar a lista
        const lista = (p.entregas && Array.isArray(p.entregas.lista)) ? p.entregas.lista : [];
        const nova = lista.map(e => (e.id === entregaId ? Object.assign({}, e, { status: 'confirmada', quando: agora, recebedor: toque.nome, peloLink: true }) : e));
        // o toque já virou entrega: sai do link (a lista passa a dizer "recebido")
        await doc.ref.update({ entregas: { atualizadoEm: agora, lista: nova }, ['recebido.' + entregaId]: FieldValue.delete() });
        await db.collection('auditoria').add({ acao: 'entrega_pelo_link', detalhe: (snap.data().clienteNome || 'cliente') + ' · ' + (toque.nome || 'sem nome'), origem: 'vigia-robo', feitoPor: '', feitoPorNome: 'Link do cliente (pelo robô)', quando: agora }).catch(() => {});
        log('entrega pelo link confirmada:', snap.data().clienteNome || entregaId, '-', toque.nome || 'sem nome');
      } catch (err) {
        jaVistas.delete(chave);   // tenta de novo na próxima mudança
        log('entrega pelo link: não consegui registrar', entregaId, '-', err.message);
      }
    }
  }
  db.collection('portais').onSnapshot(snap => {
    snap.docChanges().forEach(m => { if (m.type !== 'removed') tratar(m.doc); });
  }, err => log('entrega pelo link: perdi o ouvinte dos links -', err.message));
  log('entrega pelo link ligada (o "Recebi" do cliente vira entrega confirmada)');
}

module.exports = { lerToque, podeConfirmar, iniciarEntregaPeloLink };
