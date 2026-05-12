import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stock Analysis",
    short_name: "StockFA",
    description: "Fair value analysis with DCF, DDM and EV/EBITDA",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        // maskable: browser can crop to any shape (circle, squircle, etc.)
        purpose: "maskable",
      },
    ],
  };
}
