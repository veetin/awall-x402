import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Gateway to proxy the control plane to. `AWALL_URL` overrides it.
 *
 * The console reaches `/awall` on its own origin and this server forwards it.
 * That is what lets the session cookie be `SameSite=Strict` in development:
 * the browser sees one site, not a console on 4179 calling a gateway on 8402.
 */
const gateway = process.env["AWALL_URL"] ?? "http://127.0.0.1:8402";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        console: fileURLToPath(new URL("./index.html", import.meta.url)),
        landing: fileURLToPath(new URL("./landing.html", import.meta.url)),
      },
    },
  },
  server: { host: "0.0.0.0", port: 4179, strictPort: true, proxy: { "/awall": gateway } },
  preview: { host: "0.0.0.0", port: 4179, strictPort: true, proxy: { "/awall": gateway } },
});
