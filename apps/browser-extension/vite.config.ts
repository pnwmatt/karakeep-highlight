import path from "node:path";
import { fileURLToPath } from "node:url";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

import manifest from "./manifest.json";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  plugins: [
    react(),
    crx({
      manifest,
      browser: process.env.VITE_BUILD_FIREFOX ? "firefox" : "chrome",
    }),
  ],
  server: {
    port: 5174,
    strictPort: true,
    cors: {
      origin: [/chrome-extension:\/\//],
    },
  },
});
