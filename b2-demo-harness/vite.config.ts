import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  envDir: false,
  envPrefix: "B2_UNUSED_",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 15603,
    strictPort: true,
    fs: { strict: true, allow: [fileURLToPath(new URL(".", import.meta.url))] },
  },
  preview: { host: "127.0.0.1", port: 15604, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
