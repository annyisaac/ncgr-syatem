import type { MetadataRoute } from "next";

// Web app manifest — makes the app installable to a phone/desktop home screen
// (standalone, own icon, no browser chrome). Served by Next at /manifest.webmanifest
// and auto-linked into <head>.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NCGR LTD — Poultry Management",
    short_name: "NCGR",
    description:
      "NCGR Ltd hatchery, chick orders, delivery planning and payment verification.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf6ec",
    theme_color: "#b8860b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
