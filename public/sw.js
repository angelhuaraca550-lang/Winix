// Fideliza — service worker: recibe la publicidad (push) y abre la tarjeta al tocarla.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: "Fideliza", body: e.data ? e.data.text() : "" };
  }
  const opts = {
    body: d.body || "",
    icon: d.icon || "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: d.tag || undefined,
    data: { url: d.url || "/" },
    vibrate: [80, 40, 80],
  };
  if (d.image) opts.image = d.image;
  e.waitUntil(self.registration.showNotification(d.title || "Fideliza", opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (w.url.split("?")[0] === url.split("?")[0] && "focus" in w) {
          try { await w.navigate(url); } catch {}
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
