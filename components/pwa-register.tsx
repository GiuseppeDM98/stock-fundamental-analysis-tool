"use client";

import { useEffect } from "react";

// Registers the service worker after hydration.
// Required for the browser to show the PWA "Install App" prompt instead of
// the plain "Add to Home Screen" shortcut — browsers gate the install prompt
// on an active SW registration.
export default function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return null;
}
