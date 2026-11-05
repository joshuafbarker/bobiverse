// @ts-check
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

/**
 * Static Astro site with Tailwind v4 via the Vite plugin.
 * No adapter yet — Vercel (or similar) can be added later if needed.
 */
export default defineConfig({
  // GitHub Pages serves the site at joshuafbarker.github.io/bobiverse,
  // so every page and asset lives under the /bobiverse path
  site: "https://joshuafbarker.github.io",
  base: "/bobiverse",
  output: "static",
  server: { port: 4321 },
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
  },
});
