// Minimal service worker — required by browsers to show the PWA install prompt.
// Strategy: no caching. The app always reflects fresh data from Yahoo Finance
// and the AI API, so there is nothing to intercept or store.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Empty fetch handler on purpose — do NOT call event.respondWith().
//
// A previous version proxied every request (event.respondWith(fetch(event.request))).
// That ties the response's lifetime to the service worker instead of the document.
// Our AI routes (Advisor, Deep Value) stream long-lived responses (web search can
// run 30–60s+), and Chrome aggressively kills idle service workers (~30s). When the
// SW was terminated mid-stream, its proxied fetch aborted ("Failed to fetch" from
// sw.js) and the client's response body closed prematurely — truncating the AI reply.
//
// Registering a fetch handler (even an empty one) still satisfies the PWA install
// criteria, but by not calling respondWith() we let the browser handle every request
// natively, tied to the document's lifetime — so streams survive SW termination.
self.addEventListener("fetch", () => {});
