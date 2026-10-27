/**
 * Ecossistema ITPA - Service Worker Offline-First
 * Fornece caching robusto do App Shell, bibliotecas Leaflet e recursos estáticos.
 */

const CACHE_NAME = 'itpa-ecossistema-v4';

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './app.js',
  './js/db.js',
  './js/camera.js',
  './js/map.js',
  './js/sync.js',
  './js/report.js',
  './DATA/KMLs.geojson',
  './assets/logo.jpg',
  './assets/icons/favicon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  // CDNs essenciais do Leaflet & MarkerCluster
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  // Bibliotecas PDF (jsPDF + AutoTable)
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  // Firebase SDK Compat v10 (Firestore e Storage)
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js',
  // Tipografia Google Fonts
  'https://fonts.googleapis.com/css2?family=Bitter:ital,wght@0,500;0,700;0,800;1,600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
];

// Instalação do Service Worker e pré-cache do App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pré-carregando App Shell offline...');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[Service Worker] Alguns recursos CDN podem ser cacheados sob demanda:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Ativação e limpeza de versões antigas de cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removendo cache legado:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptação de requisições de rede
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Não intercepta chamadas de API ou requisições não-GET
  if (req.method !== 'GET') {
    return;
  }

  // Requisições de Tiles do Mapa (OpenStreetMap / Esri): Cache dinâmico
  if (url.hostname.includes('tile.openstreetmap.org') || url.hostname.includes('arcgisonline.com') || url.hostname.includes('cartocdn.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(req);
        if (cachedResponse) return cachedResponse;

        try {
          const networkResponse = await fetch(req);
          if (networkResponse.status === 200) {
            cache.put(req, networkResponse.clone());
          }
          return networkResponse;
        } catch (e) {
          return cachedResponse || new Response('', { status: 408 });
        }
      })
    );
    return;
  }

  // Estratégia Stale-While-Revalidate para App Shell e recursos locais
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const fetchPromise = fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // Se offline e falhar a rede, retorna o que tem em cache
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
