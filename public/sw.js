/* NCGR service worker — conservative by design.
 *
 *  - Navigations (HTML pages): NETWORK-FIRST, so the app is always fresh when
 *    online; falls back to a cached copy, then a small offline page, when the
 *    device is offline.
 *  - Same-origin immutable static assets (/_next/static, icons, images):
 *    CACHE-FIRST (they are content-hashed, so safe to keep).
 *  - Everything else — Supabase (cross-origin), auth, realtime sockets, POSTs,
 *    Google fonts — is NEVER intercepted; it goes straight to the network.
 *
 *  Push + notificationclick handlers are included for the (later) web-push phase.
 */

const VERSION = "v1";
const STATIC_CACHE = `ncgr-static-${VERSION}`;
const PAGE_CACHE = `ncgr-pages-${VERSION}`;

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — NCGR</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;
font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#faf6ec;color:#231b04}
.b{max-width:22rem;text-align:center;padding:2rem}h1{font-size:1.15rem;margin:.25rem 0}
p{color:#6b6350;font-size:.9rem;line-height:1.5}button{margin-top:1rem;border:0;border-radius:.6rem;
padding:.6rem 1.1rem;background:#b8860b;color:#fff;font-weight:600;font-size:.9rem}</style></head>
<body><div class="b"><h1>You're offline</h1>
<p>NCGR needs a connection to load this page. Check your internet and try again.</p>
<button onclick="location.reload()">Retry</button></div></body></html>`;

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon-") ||
    /\.(?:png|jpe?g|gif|svg|webp|ico|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PAGE_CACHE).then((c) => c.put("/offline", new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== PAGE_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never touch writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase / fonts / cross-origin

  // App pages: network-first (fresh when online), cache/offline fallback when not.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGE_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match("/offline"))
        )
    );
    return;
  }

  // Immutable static assets: cache-first, then fill the cache.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
      )
    );
  }
  // Anything else same-origin (RSC data, API routes): fall through to network.
});

// ---- Web push (used once VAPID keys + subscriptions are wired) --------------
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: "NCGR", body: event.data.text() }; }
  const options = {
    body: data.body,
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [100, 50, 100],
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(data.title || "NCGR", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) { c.navigate(target); return c.focus(); } }
      return self.clients.openWindow(target);
    })
  );
});
