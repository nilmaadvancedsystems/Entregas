// Avisos no celular, enviados pelo PC do robô.
//
// O app já pede permissão de notificação e guarda o token de cada aparelho em
// usuarios/{uid}.fcmTokens, mas ninguém enviava nada: enviar exige credencial
// de servidor, e o sistema não tem servidor. Tem este PC, que já fica ligado
// pro robô do Gmail e já fala com o Firestore — então é ele que avisa.
//
//   - parada nova na rota  -> quem é office boy (menos quem a colocou)
//   - entrega não realizada -> quem é admin      (menos quem registrou)
//
// Sem custo e sem passo novo pra equipe. Com o PC desligado não há aviso; o
// app continua funcionando igual.
const { getMessaging } = require('firebase-admin/messaging');

const JANELA_MS = 20000;   // junta o que acontece em 20s num aviso só (rota montada de uma vez)

function iniciarAvisos(db, log) {
  const ligadoEm = new Date().toISOString();

  async function tokensDe(papel, menosEmail) {
    const snap = await db.collection('usuarios').get();
    const alvos = [];
    snap.forEach(d => {
      const u = d.data();
      const papeis = Array.isArray(u.roles) ? u.roles : [];
      if (!papeis.includes(papel)) return;
      if (menosEmail && String(u.email || '').toLowerCase() === String(menosEmail).toLowerCase()) return;
      (Array.isArray(u.fcmTokens) ? u.fcmTokens : []).forEach(t => alvos.push({ uid: d.id, token: t }));
    });
    return alvos;
  }

  async function enviar(papel, menosEmail, titulo, corpo, tag) {
    const alvos = await tokensDe(papel, menosEmail);
    if (!alvos.length) return;
    const r = await getMessaging().sendEachForMulticast({
      tokens: alvos.map(a => a.token),
      notification: { title: titulo, body: corpo },
      data: { tag },
      webpush: { fcmOptions: { link: 'https://nilmaadvancedsystems.github.io/Entregas/entregas.html' } },
    });
    log('aviso "' + titulo + '":', r.successCount, 'entregue(s),', r.failureCount, 'falha(s)');
    // token morto (app desinstalado, permissão tirada) sai do cadastro
    const { FieldValue } = require('firebase-admin/firestore');
    r.responses.forEach((resp, i) => {
      const codigo = resp.error && resp.error.code;
      if (codigo === 'messaging/registration-token-not-registered') {
        db.collection('usuarios').doc(alvos[i].uid).update({ fcmTokens: FieldValue.arrayRemove(alvos[i].token) }).catch(() => {});
      }
    });
  }

  // agrupa por quem fez, pra não mandar 12 avisos quando o admin monta a rota
  function agrupador(aoFechar) {
    const grupos = new Map();
    return (chave, item) => {
      let g = grupos.get(chave);
      if (!g) {
        g = { itens: [] };
        grupos.set(chave, g);
        g.relogio = setTimeout(() => {
          grupos.delete(chave);
          aoFechar(chave, g.itens).catch(err => log('aviso não saiu:', err.message));
        }, JANELA_MS);
      }
      g.itens.push(item);
    };
  }

  const novaParada = agrupador(async (criadoPor, itens) => {
    const nomes = [...new Set(itens.map(e => e.clienteNome || 'cliente'))];
    const titulo = itens.length === 1 ? 'Parada nova na rota' : itens.length + ' paradas novas na rota';
    const corpo = nomes.slice(0, 3).join(', ') + (nomes.length > 3 ? ' e mais ' + (nomes.length - 3) : '');
    await enviar('office_boy', criadoPor, titulo, corpo, 'rota-nova');
  });
  const naoEntregue = agrupador(async (feitoPor, itens) => {
    const e = itens[0];
    const titulo = itens.length === 1 ? 'Entrega não realizada' : itens.length + ' entregas não realizadas';
    const corpo = (e.clienteNome || 'cliente') + (e.motivoFalha ? ': ' + e.motivoFalha : '') +
      (e.entregadoPorNome ? ' (' + e.entregadoPorNome + ')' : '');
    await enviar('admin', feitoPor, titulo, corpo, 'entrega-falha');
  });

  // Só o que acontece DEPOIS de o vigia ligar: a primeira leva do ouvinte traz
  // tudo que já existia, e avisar disso seria uma rajada a cada reinício.
  db.collection('entregas').where('status', '==', 'pendente').onSnapshot(snap => {
    snap.docChanges().forEach(m => {
      if (m.type !== 'added') return;
      const e = m.doc.data();
      if (String(e.criadoEm || '') < ligadoEm) return;
      novaParada(e.entregadoPor || '', e);
    });
  }, err => log('avisos: perdi o ouvinte da rota:', err.message));

  db.collection('entregas').where('confirmadoEm', '>=', ligadoEm).onSnapshot(snap => {
    snap.docChanges().forEach(m => {
      if (m.type !== 'added') return;
      const e = m.doc.data();
      if (e.status === 'falha') naoEntregue(e.entregadoPor || '', e);
    });
  }, err => log('avisos: perdi o ouvinte das entregas:', err.message));

  log('avisos no celular ligados (parada nova pro office boy, entrega não realizada pro admin)');
  // quem mais quiser avisar (o vigia de CNPJ) usa o mesmo envio
  return { enviar };
}

module.exports = { iniciarAvisos };
