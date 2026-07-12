import { defineConfig } from "vite";

// Relative base so the built site works under any subpath (GitHub Pages
// project path, custom domain root, etc.) without hardcoding one here —
// matches the "./"-relative asset/fetch paths already used throughout the
// app, which exist for the same reason.
export default defineConfig({
  base: "/",
  server: {
    hmr: false,
  },
  build: {
    rollupOptions: {
      input: {
        main: new URL("index.html", import.meta.url).pathname,
        chart: new URL("chart.html", import.meta.url).pathname,
        colors: new URL("colors.html", import.meta.url).pathname,
      },
    },
  },
});
