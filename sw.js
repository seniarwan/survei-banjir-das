// ============================================================
// SERVICE WORKER – Survei Banjir DAS Randangan
// Versi cache harus diubah setiap kali ada update file
// ============================================================

const CACHE_NAME    = "survei-banjir-v1";
const CACHE_TIMEOUT = 5000; // ms sebelum fallback ke cache

// File yang wajib di-cache saat install
const PRECACHE_URLS = [
  "./",
  "./index.html",
  // Google Fonts – di-cache agar teks tetap rapi saat offline
  "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap",
];

// ── Install: cache semua file wajib ────────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log("[SW] Pre-caching assets");
        // Cache satu per satu agar satu failure tidak blokir semua
        return Promise.allSettled(
          PRECACHE_URLS.map(url =>
            cache.add(url).catch(err =>
              console.warn("[SW] Failed to cache:", url, err)
            )
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── Activate: hapus cache lama ─────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => {
              console.log("[SW] Deleting old cache:", name);
              return caches.delete(name);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: Network-first dengan fallback ke cache ──────────
self.addEventListener("fetch", event => {
  const req = event.request;

  // Lewati request non-GET (POST ke Apps Script tetap ke network)
  if (req.method !== "GET") return;

  // Lewati request ke Apps Script (selalu butuh network)
  if (req.url.includes("script.google.com")) return;

  // Lewati request ke Google Drive (upload foto)
  if (req.url.includes("drive.google.com") ||
      req.url.includes("googleapis.com")) return;

  event.respondWith(networkFirstWithCache(req));
});

// Strategi: coba network dulu, fallback ke cache jika gagal/timeout
async function networkFirstWithCache(req) {
  const cache = await caches.open(CACHE_NAME);

  try {
    // Race antara network dan timeout
    const networkRes = await Promise.race([
      fetch(req.clone()),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), CACHE_TIMEOUT)
      )
    ]);

    // Jika berhasil dari network, update cache
    if (networkRes && networkRes.status === 200) {
      cache.put(req, networkRes.clone());
    }
    return networkRes;

  } catch (err) {
    // Network gagal atau timeout → ambil dari cache
    console.log("[SW] Network failed, serving from cache:", req.url);
    const cached = await cache.match(req);

    if (cached) return cached;

    // Jika tidak ada di cache dan ini navigasi halaman → kembalikan index.html
    if (req.mode === "navigate") {
      const indexCached = await cache.match("./index.html");
      if (indexCached) return indexCached;
    }

    // Tidak ada di mana pun → kembalikan response kosong
    return new Response("", {
      status: 503,
      statusText: "Service Unavailable – offline dan tidak ada cache",
    });
  }
}

// ── Message handler: force update dari app ─────────────────
self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
