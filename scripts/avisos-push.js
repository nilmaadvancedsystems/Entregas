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

  // a equipe muda pouco: uma leitura dos usuários vale por 10 minutos
  let usuariosLidos = null, usuariosEm = 0;
  async function usuarios() {
    if (!usuariosLidos || Date.now() - usuariosEm > 10 * 60000) {
      const snap = await db.collection('usuarios').get();
      usuariosLidos = snap.docs.map(d => ({ id: d.id, data: () => d.data() }));
      usuariosEm = Date.now();
    }
    return usuariosLidos;
  }
  async function tokensDe(papel, menosEmail) {
    const alvos = [];
    (await usuarios()).forEach(d => {
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
    // Só "data": o service worker do app monta o aviso e sabe o que abrir no toque
    const r = await getMessaging().sendEachForMulticast({
      tokens: alvos.map(a => a.token),
      data: { titulo, corpo, tag, link: 'https://nilmaadvancedsystems.github.io/Entregas/entregas.html' },
      webpush: { headers: { Urgency: 'high' } },
    });
    const erro = (r.responses.find(x => x.error) || {}).error;
    log('aviso "' + titulo + '":', r.successCount, 'entregue(s),', r.failureCount, 'falha(s)' + (erro ? ' (' + (erro.code || erro.message) + ')' : ''));
    // token morto (app desinstalado, permissão tirada) sai do cadastro
    const { FieldValue } = require('firebase-admin/firestore');
    r.responses.forEach((resp, i) => {
      const codigo = resp.error && resp.error.code;
      if (codigo === 'messaging/registration-token-not-registered' || codigo === 'messaging/invalid-registration-token') {
        db.collection('usuarios').doc(alvos[i].uid).update({ fcmTokens: FieldValue.arrayRemove(alvos[i].token) }).catch(() => {});
        usuariosLidos = null;
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
  // Consulta pelo que foi CRIADO depois de o vigia ligar (e filtra "pendente"
  // aqui): ouvir todas as pendentes lia a rota inteira a cada partida.
  const { ouvir } = require('./ouvinte');
  const jaAvisadas = new Set();
  ouvir('avisos (rota)', () => db.collection('entregas').where('criadoEm', '>=', ligadoEm), snap => {
    snap.docChanges().forEach(m => {
      if (m.type !== 'added' || jaAvisadas.has(m.doc.id)) return;
      const e = m.doc.data();
      if (e.status !== 'pendente') return;
      jaAvisadas.add(m.doc.id);
      novaParada(e.entregadoPor || '', e);
    });
  }, log);
  ouvir('avisos (entregas)', () => db.collection('entregas').where('confirmadoEm', '>=', ligadoEm), snap => {
    snap.docChanges().forEach(m => {
      if (m.type !== 'added' || jaAvisadas.has('f:' + m.doc.id)) return;
      const e = m.doc.data();
      if (e.status !== 'falha') return;
      jaAvisadas.add('f:' + m.doc.id);
      naoEntregue(e.entregadoPor || '', e);
    });
  }, log);

  log('avisos no celular ligados (parada nova pro office boy, entrega não realizada pro admin)');
  // quem mais quiser avisar (o vigia de CNPJ) usa o mesmo envio
  return { enviar };
}

module.exports = { iniciarAvisos };
