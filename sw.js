/* Service worker — cache hors-ligne + mise à jour automatique.
   Stratégie : "réseau d'abord, sans cache HTTP" (no-store) → quand l'appareil
   est en ligne, il exécute TOUJOURS la dernière version déployée. Le cache ne
   sert que de secours hors-ligne. Les données (localStorage) ne sont jamais
   touchées par le service worker : une mise à jour ne les efface pas. */
const VERSION = "1.90"; // ← incrémenter à CHAQUE déploiement (force le rafraîchissement des sessions déjà ouvertes)
const CACHE = "maraude-" + VERSION;
const OFFLINE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=4",
  "./app.js?v=4",
  "./data.js?v=4",
  "./sync.js?v=4",
  "./manifest.json",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", (e) => {
  // skipWaiting : la nouvelle version prend la main sans attendre la fermeture des onglets
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // Supprime les anciens caches de version, puis prend le contrôle des pages ouvertes
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // Cartes + géocodeur + QR : réseau direct, jamais mis en cache
  if (/tile\.openstreetmap\.org|nominatim\.openstreetmap\.org|api\.qrserver\.com/.test(req.url)) return;
  // Reste (app) : toujours frais depuis le réseau (no-store) ; cache = secours hors-ligne
  e.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match("./index.html")))
  );
});
