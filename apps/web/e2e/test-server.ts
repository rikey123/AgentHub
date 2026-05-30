import { createServer, request, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonApp } from "@agenthub/daemon";

export async function startTestServer(daemon: DaemonApp): Promise<{ server: Server; url: string; close: () => void }> {
  const daemonServer = await daemon.start();
  const daemonAddress = daemonServer.address();
  if (typeof daemonAddress !== "object" || daemonAddress === null) throw new Error("expected TCP address");
  const daemonPort = daemonAddress.port;

  const distPath = join(process.cwd(), "apps", "web", "dist");
  const connections = new Set<import("node:http").ServerResponse>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    const apiPrefixes = ["/auth/session", "/event", "/rooms", "/roles", "/runtimes", "/model-configs", "/agent-bindings", "/settings", "/workspaces", "/agents", "/runs", "/context", "/permissions", "/interventions", "/artifacts", "/debug", "/pending-turns", "/messages", "/healthz", "/openapi.json"];
    const isApi = apiPrefixes.some((prefix) => url.pathname.startsWith(prefix));

    if (isApi) {
      const isSse = url.pathname === "/event";
      const proxyReq = {
        hostname: "127.0.0.1",
        port: daemonPort,
        path: url.pathname + url.search,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${daemonPort}` }
      };

      const clientReq = request(proxyReq, (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        if (isSse) {
          connections.add(res);
          proxyRes.on("data", (chunk) => {
            res.write(chunk);
          });
          proxyRes.on("end", () => {
            connections.delete(res);
            res.end();
          });
          proxyRes.on("error", () => {
            connections.delete(res);
            res.end();
          });
          req.on("close", () => {
            connections.delete(res);
          });
        } else {
          proxyRes.pipe(res);
        }
      });
      clientReq.on("error", (err) => {
        res.writeHead(502);
        res.end(JSON.stringify({ error: "proxy_error", message: err.message }));
      });
      req.pipe(clientReq);
      return;
    }

    const filePath = join(distPath, url.pathname === "/" ? "index.html" : url.pathname);
    try {
      const content = readFileSync(filePath);
      const ext = filePath.split(".").pop() ?? "";
      const mimeTypes: Record<string, string> = {
        html: "text/html",
        js: "application/javascript",
        css: "text/css",
        json: "application/json",
        png: "image/png",
        jpg: "image/jpeg",
        svg: "image/svg+xml"
      };
      res.writeHead(200, { "content-type": mimeTypes[ext] ?? "application/octet-stream" });
      res.end(content);
    } catch {
      try {
        const content = readFileSync(join(distPath, "index.html"));
        res.writeHead(200, { "content-type": "text/html" });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) throw new Error("expected TCP address");
      const close = () => {
        for (const res of connections) {
          try { res.end(); } catch { /* ignore */ }
        }
        connections.clear();
        server.close();
      };
      resolve({ server, url: `http://127.0.0.1:${address.port}`, close });
    });
  });
}
