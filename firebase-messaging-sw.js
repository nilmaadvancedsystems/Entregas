importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyD6xg7XhX8dKTKmaYup4hRX5k9XFHEkb98",
  authDomain: "entregas-2e5e2.firebaseapp.com",
  projectId: "entregas-2e5e2",
  storageBucket: "entregas-2e5e2.firebasestorage.app",
  messagingSenderId: "1009094556836",
  appId: "1:1009094556836:web:d3b6a9283e934db064fa31"
});

var messaging = firebase.messaging();

// Os avisos do robô chegam só com "data" (titulo, corpo, tag, link). Mensagem
// que traz "notification" o próprio Firebase já mostra sozinho; mostrar de
// novo aqui fazia o aviso aparecer duas vezes.
messaging.onBackgroundMessage(function (payload) {
  if (payload.notification) return;
  var d = payload.data || {};
  self.registration.showNotification(d.titulo || 'Nilma Contabilidade', {
    body: d.corpo || '',
    icon: new URL('icon.png', self.registration.scope).href,
    tag: d.tag || 'nilma-aviso',
    data: d
  });
});

// ---------- cache do app ----------
// Guarda a última versão que abriu com sucesso. Serve pra duas coisas: abrir
// sem sinal (o office boy entra em prédio sem rede o tempo todo) e deixar o
// app instalável na tela inicial, que o Chrome só libera com um service
// worker que trate fetch.
//
// Trocar esse nome força o navegador a jogar fora qualquer página antiga
// guardada em cache (ex.: uma cópia de conciliador.html/cheque-especial.html
// de antes de uma correção) na próxima vez que o service worker atualizar.
var CACHE = 'nilma-app-v5';

self.addEventListener('install', function (event) {
  // assume o controle já na primeira visita, sem esperar recarregar
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.map(function (n) {
        return n === CACHE ? null : caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase e CDNs seguem direto

  // Conciliadorzinho e Cheque especial nunca ficam em cache — são páginas
  // à parte que mudam com frequência e não precisam funcionar offline
  // (diferente do entregas.html, que o office boy abre sem sinal). Deixar
  // essas duas passarem direto pra rede evita ficar preso numa versão
  // antiga guardada de uma correção anterior.
  if (/\/(conciliador|cheque-especial)\.html$/.test(url.pathname)) return;

  // Rede primeiro: o app é um arquivo só e muda com frequência, então nunca
  // pode ficar preso numa versão velha enquanto existe internet.
  // 'no-cache' manda o navegador CONFERIR com o servidor em vez de confiar na
  // cópia dele: o GitHub Pages serve com validade de 10 minutos, e era por
  // isso que versão nova só aparecia com Ctrl+F5. Sem mudança, a resposta é
  // um "não mudou" de poucos bytes.
  var conferir = req.mode === 'navigate' || /\.(html|js)$/.test(url.pathname);
  event.respondWith(
    fetch(req, conferir ? { cache: 'no-cache' } : undefined).then(function (resposta) {
      if (resposta && resposta.ok) {
        var copia = resposta.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copia); });
      }
      return resposta;
    }).catch(function () {
      return caches.match(req).then(function (guardada) {
        if (guardada) return guardada;
        if (req.mode === 'navigate') return caches.match('entregas.html');
        return Response.error();
      });
    })
  );
});

// Tocar no aviso abre o endereço que veio nele. O lembrete de vencimento do
// CLIENTE traz o link da página dele: sem isto, o toque abria a tela de login
// do escritório. Só endereço deste mesmo site é aceito.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var dados = event.notification.data || {};
  var destino = new URL('entregas.html', self.registration.scope).href;
  try {
    var pedido = new URL(dados.link || '', self.registration.scope);
    if (pedido.origin === self.location.origin) destino = pedido.href;
  } catch (e) {}
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (abertas) {
      for (var i = 0; i < abertas.length; i++) {
        // já tem uma janela nesse endereço: só traz pra frente
        if (abertas[i].url === destino && 'focus' in abertas[i]) return abertas[i].focus();
      }
      if (!dados.link) {
        for (var j = 0; j < abertas.length; j++) { if ('focus' in abertas[j]) return abertas[j].focus(); }
      }
      if (clients.openWindow) return clients.openWindow(destino);
    })
  );
});
