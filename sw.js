const CACHE = 'voceviva-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// Messaggio dal app per mostrare/nascondere notifica persistente
self.addEventListener('message', e => {
  if (e.data === 'startRecording') {
    self.registration.showNotification('🔴 Voce Viva', {
      body: 'Registrazione in corso — tieni aperta questa notifica',
      icon: '/voceviva/icon.png',
      badge: '/voceviva/icon.png',
      tag: 'recording',
      renotify: false,
      requireInteraction: true,  // rimane fino a dismissione manuale
      silent: true,
      actions: [{ action: 'stop', title: '⏹ Stop' }]
    });
  }
  if (e.data === 'stopRecording') {
    self.registration.getNotifications({ tag: 'recording' })
      .then(notifications => notifications.forEach(n => n.close()));
  }
});

// Click su "Stop" nella notifica
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'stop') {
    e.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        clientList.forEach(client => client.postMessage('stopFromNotification'));
      })
    );
  } else {
    e.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        if (clientList.length > 0) clientList[0].focus();
        else clients.openWindow('/voceviva/');
      })
    );
  }
});
