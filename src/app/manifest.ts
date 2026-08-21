import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest (kept public in src/proxy.ts: browsers
// fetch the manifest without cookies, so it must bypass the session check).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NervaBrain",
    short_name: "NervaBrain",
    description:
      "A local-first AI memory built on a private Markdown vault.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
