const CACHE = 'voceviva-v7';

const PRECACHE = [
  'index.html',
  'login.html',
  'diary.html',
  'freeNote_func.html',
  'guidedDiary_func.html',
  'vv-auth.js',
  'vv-memory.js',
  'vv-profile.js',
  'vv-report.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
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

// Network-first: prova dalla rete, se fallisce usa la cache
// Intercetta solo file locali, lascia passare tutto il resto (Groq API, Supabase)
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Aggiorna la cache con la risposta fresca
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(cached =>
          cached || new Response('Not found', { status: 404 })
        )
      )
  );
});

// Notifica persistente durante registrazione + gestione aggiornamento
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
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
