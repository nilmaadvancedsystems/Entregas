// Ponte do Drive para o Extratudo acoplado (Contábil → Extratudo, 29/09/2026).
// O Extratudo mora em outro endereço (extratudo-entregas.web.app) e não
// enxerga o login desta página; em vez de pedir usuário e senha de novo, ele
// pede aqui, por mensagem, o que precisa do Drive — e esta página responde com
// o login de quem já está no Entregas:
//   quem   → quem está logado (ou null);
//   raiz   → driveIndice/raiz: a lista das pastas dos clientes;
//   partes → driveIndice/{pasta}/partes: os arquivos da pasta;
//   baixar → o pedido em aberturasDrive (modo "baixar"); devolve o link
//            temporário que o robô publica (o Extratudo baixa de lá).
// Só responde ao iframe #frameExtratudo e só àquele endereço. Não grava nada
// além do pedido em aberturasDrive (o mesmo do Arquivo das Pendências).
(function () {
  var ORIGEM = 'https://extratudo-entregas.web.app';
  var ESPERA_MS = 90000;

  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGEM) return;
    var f = document.getElementById('frameExtratudo');
    if (!f || e.source !== f.contentWindow) return;
    var m = e.data;
    if (!m || m.nilmaDrive !== 1 || typeof m.op !== 'string') return;
    function responder(ok, dados) { e.source.postMessage({ nilmaDrive: 1, id: m.id, ok: ok, dados: dados }, ORIGEM); }
    function passo(txt) { e.source.postMessage({ nilmaDrive: 1, id: m.id, passo: txt }, ORIGEM); }
    function falhar(err) { responder(false, String((err && err.message) || err || 'erro')); }

    var auth = firebase.auth(), db = firebase.firestore(), u = auth.currentUser;
    if (m.op === 'quem') return responder(true, u ? { email: u.email || '' } : null);
    if (!u) return responder(false, 'Entre no Entregas primeiro.');

    if (m.op === 'raiz') {
      db.collection('driveIndice').doc('raiz').get().then(function (d) {
        responder(true, (d.exists && d.data().clientes) || []);
      }).catch(falhar);
      return;
    }
    if (m.op === 'partes') {
      if (typeof m.pasta !== 'string' || !m.pasta || m.pasta.indexOf('/') > -1) return responder(false, 'pasta inválida');
      db.collection('driveIndice').doc(m.pasta).collection('partes').get().then(function (snap) {
        var docs = snap.docs.slice().sort(function (a, b) { return Number(a.id) - Number(b.id); });
        var itens = [];
        docs.forEach(function (p) { itens = itens.concat(p.data().itens || []); });
        responder(true, itens);
      }).catch(falhar);
      return;
    }
    if (m.op === 'baixar') {
      if (typeof m.fileId !== 'string' || !m.fileId) return responder(false, 'arquivo inválido');
      passo('pedindo ao robô do Drive');
      db.collection('aberturasDrive').add({
        status: 'pendente', fileId: m.fileId, nome: String(m.nome || ''), modo: 'baixar',
        criadoEm: new Date().toISOString(), criadoPor: (u.email || '').replace(/@nilma\.local$/, '') || 'extratudo', criadoPorUid: u.uid
      }).then(function (ref) {
        var fim = setTimeout(function () { parar(); responder(false, 'O robô do Drive não respondeu a tempo. Confira se ele está online e tente de novo.'); }, ESPERA_MS);
        var parar = ref.onSnapshot(function (d) {
          var p = d.data() || {};
          if (p.status === 'buscando') passo('o robô está buscando no Drive');
          if (p.status === 'pronto' && p.url) { clearTimeout(fim); parar(); responder(true, String(p.url)); }
          if (p.status === 'erro') { clearTimeout(fim); parar(); responder(false, 'O robô não conseguiu trazer o arquivo: ' + (p.erro || 'erro')); }
        }, function (err) { clearTimeout(fim); falhar(err); });
      }).catch(falhar);
      return;
    }
    responder(false, 'pedido desconhecido');
  });
})();
