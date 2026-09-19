// Entrega pelo link: o cliente toca em "Confirmar que recebi" na página dele, e
// o PC do robô transforma isso em entrega confirmada.
//
// O toque fica em portais/{token}.recebido[entregaId] = "data|nome". Ele sozinho
// não confirma nada: quem está do outro lado do link não tem login. O robô só
// confirma quando TUDO isto é verdade:
//   - a entrega está na lista que a EQUIPE gravou naquele link (o visitante não
//     consegue mexer nessa lista), e lá ela está esperando no link;
//   - o link ainda é o link atual daquele cliente (não foi trocado);
//   - a entrega, no banco, ainda está com status 'link' e não mudou entre a
//     leitura e a gravação.
// O que não passa na primeira conferência é apagado do link SEM custar leitura:
// é o que impede alguém com o endereço de fazer o robô gastar a cota do banco
// gravando chaves à toa.
//
// Com o PC desligado, o cliente já vê "Recebida" na página dele; o registro na
// entrega acontece quando o PC voltar.
const { ouvir } = require('./ouvinte');

// "2026-09-19T12:00:00.000Z|Maria" -> { em, nome }. Função pura, testável.
function lerToque(valor) {
  const partes = String(valor || '').slice(0, 200).split('|');
  const em = partes[0];
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(em) || isNaN(new Date(em))) return null;
  return { em: new Date(em).toISOString(), nome: partes.slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 60) };
}

// Primeira triagem, sem ler nada do banco: separa o que vale conferir do que
// vai embora. Função pura.
function triar(portal) {
  const recebido = portal && portal.recebido && typeof portal.recebido === 'object' ? portal.recebido : {};
  const lista = (portal && portal.entregas && Array.isArray(portal.entregas.lista)) ? portal.entregas.lista : [];
  const conferir = [], descartar = [];
  Object.keys(recebido).forEach(id => {
    const naLista = lista.find(e => e && e.id === id);
    const toque = lerToque(recebido[id]);
    if (toque && /^[A-Za-z0-9_-]{6,40}$/.test(id) && naLista && naLista.status === 'link') conferir.push({ id, toque });
    else descartar.push(id);
  });
  return { conferir, descartar };
}

// A entrega pode ser confirmada? Só se ainda está esperando no link.
function podeConfirmar(entrega) { return !!entrega && entrega.status === 'link'; }

// A hora do toque vem do celular do cliente: só vale se cair entre a publicação
// e agora. Fora disso (relógio errado, alguém tentando retrodatar) vale a do robô.
function horaConfiavel(toqueEm, criadoEm, agora) {
  const t = new Date(toqueEm).getTime();
  const ini = new Date(criadoEm || 0).getTime() || 0;
  return t >= ini && t <= new Date(agora).getTime() + 5 * 60000 ? new Date(t).toISOString() : agora;
}

function iniciarEntregaPeloLink(db, log) {
  const { FieldValue } = require('firebase-admin/firestore');
  const emAndamento = new Set();
  async function tratar(doc) {
    if (emAndamento.has(doc.id)) return;
    const p = doc.data();
    const { conferir, descartar } = triar(p);
    if (!conferir.length && !descartar.length) return;
    emAndamento.add(doc.id);
    try {
      const patch = {};
      descartar.forEach(id => { patch['recebido.' + id] = FieldValue.delete(); });
      let lista = (p.entregas && Array.isArray(p.entregas.lista)) ? p.entregas.lista.slice() : [];
      let mudouLista = false;
      if (conferir.length) {
        // o link ainda é o deste cliente? (link trocado: o antigo não confirma mais nada)
        const dono = await db.collection('clientes').doc(String(p.clienteId || '-')).get();
        const linkAtual = dono.exists && dono.data().portalToken === doc.id;
        for (const { id, toque } of conferir) {
          patch['recebido.' + id] = FieldValue.delete();
          if (!linkAtual) continue;
          const ref = db.collection('entregas').doc(id);
          const snap = await ref.get();
          if (!snap.exists || !podeConfirmar(snap.data())) continue;
          const agora = new Date().toISOString();
          try {
            await ref.update({
              status: 'confirmada', confirmadoEm: agora, recebedor: toque.nome || 'cliente, pelo link',
              recebidoPeloLink: true, tocouEm: horaConfiavel(toque.em, snap.data().criadoEm, agora),
              entregadoPor: 'link-do-cliente', entregadoPorNome: 'Link do cliente',
              temAssinatura: false, falha: false,
            }, { lastUpdateTime: snap.updateTime });     // alguém da equipe confirmou no mesmo instante: não passa por cima
          } catch (err) { log('entrega pelo link: a entrega', id, 'mudou no meio; deixei como estava'); continue; }
          lista = lista.map(e => (e.id === id ? Object.assign({}, e, { status: 'confirmada', quando: agora, recebedor: toque.nome, peloLink: true }) : e));
          mudouLista = true;
          db.collection('auditoria').add({ acao: 'entrega_pelo_link', detalhe: (snap.data().clienteNome || 'cliente') + ' · ' + (toque.nome || 'sem nome'),
            origem: 'vigia-robo', feitoPor: '', feitoPorNome: 'Link do cliente (pelo robô)', quando: agora }).catch(() => {});
          log('entrega pelo link confirmada:', snap.data().clienteNome || id, '-', toque.nome || 'sem nome');
        }
      }
      // UMA gravação no link, com a lista inteira: confirmar três guias de uma
      // vez não pode fazer a terceira desfazer a primeira
      if (mudouLista) patch.entregas = { atualizadoEm: new Date().toISOString(), lista };
      await doc.ref.update(patch);
    } catch (err) {
      log('entrega pelo link: não consegui tratar o link de', p.clienteNome || doc.id, '-', err.message);
    } finally { emAndamento.delete(doc.id); }
  }
  ouvir('entrega pelo link', () => db.collection('portais'), snap => {
    snap.docChanges().forEach(m => { if (m.type !== 'removed') tratar(m.doc); });
  }, log);
  log('entrega pelo link ligada (o "Confirmar que recebi" do cliente vira entrega confirmada)');
}

module.exports = { lerToque, triar, podeConfirmar, horaConfiavel, iniciarEntregaPeloLink };
