const CACHE = 'voceviva-v4';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Elimina cache vecchie per garantire che i file aggiornati vengano serviti
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => clients.claim())
  );
});

// Intercetta solo file locali, lascia passare tutto il resto (Groq API)
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Lascia passare le chiamate a Groq e qualsiasi dominio esterno
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// Notifica persistente durante registrazione
self.addEventListener('message', e => {
  if (e.data === 'startRecording') {
    self.registration.showNotification('🔴 Voce Viva', {
      body: 'Registrazione in corso',
      tag: 'recording',
      requireInteraction: true,
      silent: true,
      actions: [{ action: 'stop', title: '⏹ Stop' }]
    });
  }
  if (e.data === 'stopRecording') {
    self.registration.getNotifications({ tag: 'recording' })
      .then(notifications => notifications.forEach(n => n.close()));
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'stop') {
    e.waitUntil(
      clients.matchAll({ type: 'window' }).then(list => {
        list.forEach(c => c.postMessage('stopFromNotification'));
      })
    );
  } else {
    e.waitUntil(
      clients.matchAll({ type: 'window' }).then(list => {
        if (list.length > 0) list[0].focus();
        else clients.openWindow('/voceviva/');
      })
    );
  }
});
