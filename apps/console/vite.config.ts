import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Gateway to proxy the control plane to. `AWALL_URL` overrides it.
 *
 * The console reaches `/awall` on its own origin and this server forwards it.
 * That is what lets the session cookie be `SameSite=Strict` in development:
 * the browser sees one site, not a console on 4179 calling a gateway on 8402.
 */
const gateway = process.env["AWALL_URL"] ?? "http://127.0.0.1:8402";

/**
 * The technical documentation is its own app (`apps/landing`). In production
 * its build is copied to `dist/documentacao`; in development this server
 * forwards `/documentacao` to its dev server so both live under one origin.
 */
const docs = { target: "http://127.0.0.1:4180", ws: true };

/** Path prefix of the operator console in development only. */
const CONSOLE_BASE = "/console";

/**
 * A directory named without its trailing slash (`/documentacao`, `/console`)
 * gets a bare 404 from the static servers. Redirect it to the slash form.
 * Registered as a pre-middleware, so it runs before the dev proxy.
 */
function trailingSlashRedirects(): Plugin {
  const dirs = new Set(["/documentacao", CONSOLE_BASE]);
  const redirect = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const path = req.url?.split("?")[0];
    if (path !== undefined && dirs.has(path)) {
      const query = (req.url ?? "").slice(path.length);
      res.statusCode = 302;
      res.setHeader("Location", `${path}/${query}`);
      res.end();
      return;
    }
    next();
  };
  return {
    name: "trailing-slash-redirects",
    configureServer(server) {
      server.middlewares.use(redirect);
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect);
    },
  };
}

/**
 * In development the landing is the front door: `/` and `/landing` serve the
 * landing page, and the operator console lives under `/console/`. The build
 * and `vite preview` keep the console at the root, which is how the Docker
 * stack and Caddy serve it.
 *
 * Root-level files that public pages link to (the favicon) are mapped the
 * same way, because Vite serves `public/` only under `base` in development.
 */
function landingAtRoot(): Plugin {
  const landing = new Set(["/", "/landing"]);
  const rootFiles = new Set(["/favicon.svg"]);
  return {
    name: "landing-at-root",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, _res: ServerResponse, next: () => void) => {
        const [path = "/", query = ""] = (req.url ?? "/").split(/(?=\?)/);
        if (landing.has(path)) req.url = `${CONSOLE_BASE}/landing.html${query}`;
        else if (rootFiles.has(path)) req.url = `${CONSOLE_BASE}${path}${query}`;
        next();
      });
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === "serve" && !isPreview ? `${CONSOLE_BASE}/` : "/",
  plugins: [react(), trailingSlashRedirects(), landingAtRoot()],
  build: {
    rollupOptions: {
      input: {
        console: fileURLToPath(new URL("./index.html", import.meta.url)),
        landing: fileURLToPath(new URL("./landing.html", import.meta.url)),
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4179,
    strictPort: true,
    proxy: { "/awall": gateway, "/documentacao": docs },
  },
  preview: { host: "0.0.0.0", port: 4179, strictPort: true, proxy: { "/awall": gateway } },
}));
