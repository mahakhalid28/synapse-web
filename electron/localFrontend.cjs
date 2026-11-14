// A packaged build gets a real loopback origin, retaining browser security,
// module loading, microphone permissions and the API's explicit CORS policy.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PACKAGED_ORIGIN = "http://127.0.0.1:5174";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ico": "image/x-icon" };

function startLocalFrontend(directory) {
  const root = fs.realpathSync(directory);
  const server = http.createServer((request, response) => {
    if (request.headers.host !== "127.0.0.1:5174" || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(403).end(); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, PACKAGED_ORIGIN).pathname);
      const candidate = path.resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
      const lexical = path.relative(root, candidate);
      if (lexical.startsWith("..") || path.isAbsolute(lexical)) { response.writeHead(404).end(); return; }
      const target = fs.realpathSync(candidate);
      const relative = path.relative(root, target);
      if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(target).isFile()) {
        response.writeHead(404).end(); return;
      }
      response.writeHead(200, { "Content-Type": MIME[path.extname(target)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
      if (request.method === "HEAD") response.end();
      else fs.createReadStream(target).on("error", () => response.destroy()).pipe(response);
    } catch { response.writeHead(404).end(); }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(5174, "127.0.0.1", () => resolve(server));
  });
}

module.exports = { PACKAGED_ORIGIN, startLocalFrontend };
