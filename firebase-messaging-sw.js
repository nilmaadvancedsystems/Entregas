importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAj0V_mMPUGxoMxU35E8VmV-zLhSakGvI8",
  authDomain: "aquivamento-9a793.firebaseapp.com",
  projectId: "aquivamento-9a793",
  storageBucket: "aquivamento-9a793.firebasestorage.app",
  messagingSenderId: "429946620838",
  appId: "1:429946620838:web:e7ee0c3457a8ffabaa1d67"
});

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var titulo = (payload.notification && payload.notification.title) || 'Nilma Protocolos';
  var opcoes = {
    body: (payload.notification && payload.notification.body) || '',
    icon: new URL('icon.png', self.registration.scope).href,
    tag: (payload.data && payload.data.tag) || 'nilma-sol',
    data: payload.data || {}
  };
  self.registration.showNotification(titulo, opcoes);
});

// ---------- cache do app ----------
// Guarda a última versão que abriu com sucesso. Serve pra duas coisas: abrir
// sem sinal (o office boy entra em prédio sem rede o tempo todo) e deixar o
// app instalável na tela inicial, que o Chrome só libera com um service
// worker que trate fetch.
var CACHE = 'nilma-app-v1';

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

  // Rede primeiro: o app é um arquivo só e muda com frequência, então nunca
  // pode ficar preso numa versão velha enquanto existe internet.
  event.respondWith(
    fetch(req).then(function (resposta) {
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

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if ('focus' in clientList[i]) return clientList[i].focus();
      }
      if (clients.openWindow) return clients.openWindow(new URL('entregas.html', self.registration.scope).href);
    })
  );
});
