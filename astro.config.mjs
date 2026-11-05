// @ts-check
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

/**
 * Static Astro site with Tailwind v4 via the Vite plugin.
 * No adapter yet — Vercel (or similar) can be added later if needed.
 */
export default defineConfig({
  output: "static",
  server: { port: 4321 },
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
  },
});
