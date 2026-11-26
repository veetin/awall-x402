// Protected application stand-in for scripts/traefik-proof.sh.
//
// It answers every request with the method, the URL and the request headers it
// received, which is the only way to see what forwardAuth put on the upstream
// request: Traefik copies the gateway's decision headers onto the request it
// forwards, never onto the client response.
import { createServer } from "node:http";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error("usage: node scripts/echo-app.mjs <port>");
  process.exit(1);
}

createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({ method: request.method, url: request.url, headers: request.headers }),
  );
}).listen(port, "127.0.0.1");
