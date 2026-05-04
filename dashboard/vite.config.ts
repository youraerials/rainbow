import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` controls the URL prefix Vite bakes into asset references in
// the built index.html. The dashboard is served at /dashboard/ on
// production hosts (the user's home app — or a placeholder — lives
// at /). Without this prefix, built `<script src="/assets/index.js">`
// tags 404 because the actual file lands at /dashboard/assets/index.js.
export default defineConfig({
  plugins: [react()],
  base: "/dashboard/",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
