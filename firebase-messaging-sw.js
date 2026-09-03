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
    icon: '/Entregas/icon.png',
    tag: (payload.data && payload.data.tag) || 'nilma-sol',
    data: payload.data || {}
  };
  self.registration.showNotification(titulo, opcoes);
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if ('focus' in clientList[i]) return clientList[i].focus();
      }
      if (clients.openWindow) return clients.openWindow('/Entregas/entregas.html');
    })
  );
});
