// SPDX-License-Identifier: Apache-2.0
// The dev harness: dev/harness.html mounts the theme against a fake ThemeApi (dev/harness.ts).
// esbuild rebuilds on change; this server serves dev/ on --port (default 7420; never 7373)
// and keeps the view's stored document the way the host does: per room (?room=), with an
// ETag, If-Match answered 412 when stale, and a stream that announces every write, so two
// browser contexts in a test share one document as two devices would.

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 7420;

const ctx = await context({
  entryPoints: [path.join(root, "dev/harness.ts")],
  outdir: path.join(root, "dev/dist"),
  bundle: true,
  format: "esm",
  target: ["es2022"],
  sourcemap: true,
  logLevel: "warning",
});
await ctx.watch();
const inner = await ctx.serve({ servedir: path.join(root, "dev"), host: "127.0.0.1" });

/** room → { value, version, listeners } */
const rooms = new Map();
const room = (id) => {
  let r = rooms.get(id);
  if (!r) {
    r = { value: null, version: 0, listeners: new Set() };
    rooms.set(id, r);
  }
  return r;
};
const etag = (r) => `"${r.version}"`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/__state") {
    const r = room(url.searchParams.get("room") || "default");
    if (req.method === "GET") {
      res.writeHead(r.value === null ? 204 : 200, { etag: etag(r), "content-type": "application/json" });
      res.end(r.value === null ? undefined : r.value);
      return;
    }
    if (req.method === "PUT") {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        const match = req.headers["if-match"];
        if (match && match !== etag(r)) {
          res.writeHead(412, { etag: etag(r), "content-type": "application/json" });
          res.end('{"reason":"conflict"}');
          return;
        }
        r.value = body === "null" ? null : body;
        r.version++;
        res.writeHead(204, { etag: etag(r) });
        res.end();
        for (const l of r.listeners) l.write(`data: ${JSON.stringify({ etag: etag(r) })}\n\n`);
      });
      return;
    }
  }
  if (url.pathname === "/__state/events") {
    const r = room(url.searchParams.get("room") || "default");
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": hi\n\n");
    r.listeners.add(res);
    req.on("close", () => r.listeners.delete(res));
    return;
  }
  // Everything else is esbuild's.
  const p = http.request(
    { host: "127.0.0.1", port: inner.port, path: req.url, method: req.method, headers: req.headers },
    (pr) => {
      res.writeHead(pr.statusCode ?? 502, pr.headers);
      pr.pipe(res);
    },
  );
  p.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(p);
});
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`canvas harness: http://127.0.0.1:${port}/harness.html\n`);
});
