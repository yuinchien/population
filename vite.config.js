import { defineConfig } from "vite";
import { resolve } from "path";
// Relative base so the built site works under any subpath (GitHub Pages
// project path, custom domain root, etc.) without hardcoding one here —
// matches the "./"-relative asset/fetch paths already used throughout the
// app, which exist for the same reason.
export default defineConfig({
  // Keep generated asset URLs relative so the same artifact works at a
  // GitHub Pages project path, a custom-domain root, or a local subdirectory.
  base: "./",
  server: {
    hmr: false,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        colors: resolve(__dirname, "colors.html"),
      },
    },
  },
});
