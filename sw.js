/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — Service Worker
   · Notifications push (rappels, badges, ligues)
   · Mode hors-ligne léger pour connexions instables : les feuilles de style,
     scripts et pages déjà visitées restent disponibles sans réseau.
   ═══════════════════════════════════════════════════════════════════════════ */
const VERSION = 'rb-v2.0.0';
const CORE = [
  '/relbrain-design-system.css',
  '/relbrain-theme.css',
  '/relbrain-theme.js',
  '/relbrain-motion.js',
  '/relbrain-config.js',
  '/relbrain-app.js',
  '/relbrain-site.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE).catch(() => null)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Jamais de cache pour l'API, l'authentification ni les autres domaines (Supabase…)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    // Pages : réseau d'abord, cache en secours
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html'))),
    );
    return;
  }
  // Ressources statiques : cache d'abord, mise à jour en arrière-plan
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'RelBrain', body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'RelBrain', {
      body: data.body || '',
      icon: data.icon && data.icon.startsWith('/') ? data.icon : '/icon-192.png',
      badge: '/icon-badge.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || '/relbrain-accueil.html' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url === target && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
