// Minimaler Service Worker – nur für Mitteilungen (iOS/iPadOS-Home-Bildschirm-App braucht ihn).
// Bewusst KEIN Caching: Updates von GitHub Pages sollen sofort ankommen.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if ("focus" in c) return c.focus();
    return self.clients.openWindow("bot.html");
  }));
});
