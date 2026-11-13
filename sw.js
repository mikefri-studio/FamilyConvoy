// ============================================================
// sw.js — Service Worker avec versioning automatique
// ============================================================
// 🎯 À CHAQUE MISE À JOUR IMPORTANTE DE TON CODE :
// Change simplement le numéro de version ci-dessous (v21, v22, v23...)
// Tous les utilisateurs recevront automatiquement la nouvelle version
// ============================================================

const VERSION = 'fc-v25';

// Installation : on active immédiatement le nouveau SW
self.addEventListener('install', event => {
  console.log(`[SW] ${VERSION} installé`);
  self.skipWaiting(); // Force l'activation sans attendre que tous les onglets soient fermés
});

// Activation : on supprime tous les anciens caches
self.addEventListener('activate', event => {
  console.log(`[SW] ${VERSION} activé, nettoyage des anciens caches...`);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== VERSION) // Garde uniquement le cache actuel
          .map(name => {
            console.log(`[SW] Suppression du cache obsolète : ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => {
      return self.clients.claim(); // Prend le contrôle de tous les onglets ouverts
    })
  );
});

// Fetch : stratégie "Network First" pour les fichiers JS/CSS, "Cache First" pour les images
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  const isCodeFile = /\.(js|css|html)$/.test(url.pathname);
  
  // Pour les fichiers de code : on privilégie toujours la version réseau
  // → Si GitHub a un nouveau fichier, on le récupère immédiatement
  if (isCodeFile) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Mise à jour du cache avec la nouvelle version
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(VERSION).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback sur le cache si pas de réseau
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Pour les images/tuiles de carte : cache-first (plus rapide)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.url.startsWith('http')) {
          const responseClone = response.clone();
          caches.open(VERSION).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(() => cached);
    })
  );
});
