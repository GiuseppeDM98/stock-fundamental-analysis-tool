// Minimal service worker — required by browsers to show the PWA install prompt.
// Strategy: network-only (pass all fetches through). No caching for now,
// so the app always reflects fresh data from Yahoo Finance and the AI API.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
