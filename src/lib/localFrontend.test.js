// @vitest-environment node
import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { get } from "node:http";
const require = createRequire(import.meta.url);
const { startLocalFrontend, PACKAGED_ORIGIN } = require("../../electron/localFrontend.cjs");

it("serves packaged assets with a real origin and rejects traversal, unexpected hosts and writes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "synapse-static-"));
  let server;
  try {
    const root = path.join(directory, "dist");
    await mkdir(root);
    await writeFile(path.join(root, "index.html"), "<h1>Synapse</h1>");
    await writeFile(path.join(root, "app.js"), "export const app = true;");
    await writeFile(path.join(directory, "private.txt"), "private");
    server = await startLocalFrontend(root);
    expect(await (await fetch(`${PACKAGED_ORIGIN}/index.html`)).text()).toBe("<h1>Synapse</h1>");
    expect((await fetch(`${PACKAGED_ORIGIN}/app.js`)).headers.get("content-type")).toBe("text/javascript");
    expect((await fetch(`${PACKAGED_ORIGIN}/%2e%2e%2fprivate.txt`)).status).toBe(404);
    expect((await fetch(`${PACKAGED_ORIGIN}/`, { method: "POST" })).status).toBe(403);
    const hostileHost = await new Promise((resolve, reject) => {
      get(PACKAGED_ORIGIN, { headers: { Host: "evil.example" } }, (response) => {
        response.resume(); resolve(response.statusCode);
      }).on("error", reject);
    });
    expect(hostileHost).toBe(403);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
    if (relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(directory).startsWith("synapse-static-")) throw new Error("Unsafe test cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});
