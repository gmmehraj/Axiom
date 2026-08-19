// ============================================================
// AXIOM AI OS — Production Service Worker (PWA Shell & Offline Cache)
// ============================================================
'use strict';

const CACHE_NAME = 'axiom-pwa-shell-v1.0.0';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './os-shell.html',
  './playground.html',
  './workspace.html',
  './studios.html',
  './agent-library.html',
  './brain.html',
  './browser.html',
  './memory.html',
  './analytics.html',
  './automation.html',
  './settings.html',
  './billing.html',
  './admin.html',
  './login.html',
  './register.html',
  './manifest.webmanifest',
  './favicon.ico',
  './styles/design-tokens.css',
  './styles/motion-tokens.css',
  './styles/base.css',
  './styles/app.css',
  './styles/ax-pages.css',
  './styles/ax-dock.css',
  './styles/ax-topbar.css',
  './styles/ax-redesign.css',
  './styles/ax-premium-polish.css',
  './styles/ax-chat.css',
  './styles/accessibility.css',
  './styles/mobile-dock.css',
  './styles/workspace-responsive.css',
  './components/app-init.js',
  './components/premium-shell.js',
  './components/universal-search.js',
  './components/quick-command.js',
  './components/notifications-center.js',
  './locales/en.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_ASSETS).catch(function (err) {
        try { console.warn('[Axiom SW] Non-fatal precache warning:', err); } catch (_) {}
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }

  // Bypass cache for external APIs, Supabase Edge Functions, Auth, OpenRouter, Razorpay, ElevenLabs
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('openrouter.ai') ||
    url.hostname.includes('elevenlabs.io') ||
    url.hostname.includes('razorpay.com') ||
    url.pathname.includes('/functions/v1/') ||
    url.pathname.includes('/auth/v1/')
  ) {
    return;
  }

  // Navigation requests: Network-First with cached fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (networkRes) {
          if (networkRes && networkRes.status === 200) {
            var copy = networkRes.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(req, copy);
            });
          }
          return networkRes;
        })
        .catch(function () {
          return caches.match(req).then(function (cached) {
            return cached || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // Static assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then(function (cachedRes) {
      var fetchPromise = fetch(req).then(function (networkRes) {
        if (networkRes && networkRes.status === 200) {
          var copy = networkRes.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(req, copy);
          });
        }
        return networkRes;
      }).catch(function () {
        return cachedRes;
      });

      return cachedRes || fetchPromise;
    })
  );
});
