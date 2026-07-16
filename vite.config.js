import { defineConfig } from "vite";
import { resolve } from "path";
// Relative base so the built site works under any subpath (GitHub Pages
// project path, custom domain root, etc.) without hardcoding one here —
// matches the "./"-relative asset/fetch paths already used throughout the
// app, which exist for the same reason.
export default defineConfig({
  // publicDir: 'public',
  base: "/population/",
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
