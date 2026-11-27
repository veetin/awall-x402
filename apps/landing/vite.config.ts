import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The technical documentation is served by the console deploy under this
 * path, so every asset URL must be prefixed with it. In development the
 * console dev server proxies `/documentacao` here.
 */
const base = "/documentacao/";

export default defineConfig({
  base,
  plugins: [react()],
  server: { host: "0.0.0.0", port: 4180, strictPort: true, hmr: { clientPort: 4180 } },
  preview: { host: "0.0.0.0", port: 4180, strictPort: true },
});
