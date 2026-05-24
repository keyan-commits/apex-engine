import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAllTools, startAutoFlush } from "./register-tools";

// Streamable-HTTP MCP entry point. Wave 9: with `tsx watch` launching
// this file, every code change on disk respawns the process within ~100ms.
// Claude Code (configured via `claude mcp add apex-engine --transport http
// http://127.0.0.1:31001/mcp`) reconnects on the next tool call and re-
// fetches the tool list — so new tools / bug fixes become available
// without the user restarting CC.
//
// Stateless mode: each MCP request creates a fresh McpServer + transport.
// Cheap (microseconds) and avoids cross-request state that would survive
// a respawn (defeating the hot-reload story). All durable state still
// lives in apex.db / data/feedback/outbox/ which are file-backed and
// process-independent.
//
// Origin allowlist: we reject requests that carry an `Origin` header
// pointing anywhere other than this machine's loopback. Claude Code's
// HTTP MCP client sends no Origin so its requests pass; a stray browser
// tab on localhost would be blocked. This is belt-and-braces hardening
// since the server is also bound to 127.0.0.1 / ::1 only — not exposed
// to the LAN.

export const DEFAULT_PORT = 31001;
export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/healthz";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://[::1]:3000",
  "http://localhost:31001",
  "http://127.0.0.1:31001",
  "http://[::1]:31001",
]);

// Allowlist for the Host header sent by the HTTP client. Used in the
// transport's built-in DNS-rebinding protection (security review MEDIUM).
// The check is exact-match against {hostname, hostname:port}. Mirrors
// ALLOWED_ORIGINS but with the http:// scheme stripped and both port-
// stripped and port-included variants for safety.
const ALLOWED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  `localhost:${process.env.APEX_MCP_PORT ?? "31001"}`,
  `127.0.0.1:${process.env.APEX_MCP_PORT ?? "31001"}`,
  `[::1]:${process.env.APEX_MCP_PORT ?? "31001"}`,
  "localhost:3000",
  "127.0.0.1:3000",
  "[::1]:3000",
];

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  return ALLOWED_ORIGINS.has(origin);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      // Defensive cap: refuse bodies > 5 MB. Tool inputs are short JSON,
      // never large blobs — if a caller sends more, something is wrong.
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse) {
  // Stateless: fresh McpServer + transport per request. The MCP SDK
  // serves a single JSON-RPC frame and writes the response (or an SSE
  // stream for tool responses) directly to res.
  const server = new McpServer({ name: "apex-engine", version: "0.1.0" });
  registerAllTools(server);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    // SDK-level DNS-rebinding protection (security review MEDIUM). When
    // enabled, the SDK rejects requests whose Host or Origin headers
    // aren't in the allowlist — defense-in-depth on top of our own
    // Origin check above.
    enableDnsRebindingProtection: true,
    allowedHosts: ALLOWED_HOSTS,
    allowedOrigins: Array.from(ALLOWED_ORIGINS),
  });
  // Connect the server BEFORE handleRequest so registered tools are
  // visible to the initial tools/list discovery.
  await server.connect(transport);
  let body: unknown;
  try {
    body = await readBody(req);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : "bad request body",
      }),
    );
    return;
  }
  // SDK's handleRequest streams the response itself; we don't write to
  // res after this call.
  await transport.handleRequest(req, res, body);
}

// Recorded once at module load so /healthz returns a stable timestamp
// for the lifetime of the process. Declared above buildServer so
// closure capture is textually obvious.
const STARTED_AT = new Date().toISOString();

export function buildServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const origin = req.headers.origin;

    // Localhost-only Origin allowlist. CC's HTTP MCP client sends no
    // Origin → passes. A browser tab on a non-allowlisted origin → 403.
    if (!isOriginAllowed(typeof origin === "string" ? origin : undefined)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "origin not allowed" }));
      return;
    }

    if (url.pathname === HEALTH_PATH) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          server: "apex-engine",
          version: "0.1.0",
          pid: process.pid,
          startedAt: STARTED_AT,
        }),
      );
      return;
    }

    if (url.pathname === MCP_PATH) {
      try {
        await handleMcpRequest(req, res);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : "server error",
            }),
          );
        } else {
          try {
            res.end();
          } catch {}
        }
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "not found",
        availablePaths: [MCP_PATH, HEALTH_PATH],
      }),
    );
  });
}

function bootstrap() {
  // Flag visible to selfCheck() so it knows not to nag about switching
  // to HTTP — we ARE on HTTP. Set in-process; doesn't leak to children.
  process.env.APEX_MCP_TRANSPORT = "http";

  const port = (() => {
    const raw = process.env.APEX_MCP_PORT;
    if (!raw) return DEFAULT_PORT;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
  })();

  const httpServer = buildServer();

  // Bind to both IPv4 and IPv6 loopback. Node listens on `::` (IPv6 any)
  // by default which on Linux includes IPv4; on macOS the dual-stack
  // behavior depends on net.inet6.ip6.v6only. Binding explicitly to
  // 127.0.0.1 keeps us off the LAN and works consistently. We open a
  // second listener on ::1 so tools that prefer IPv6 still resolve.
  httpServer.listen(port, "127.0.0.1", () => {
    console.log(
      `[mcp:http] apex-engine MCP listening on http://127.0.0.1:${port}${MCP_PATH} (pid=${process.pid})`,
    );
    console.log(`[mcp:http] health endpoint: http://127.0.0.1:${port}${HEALTH_PATH}`);
  });

  // Second listener on IPv6 loopback. createServer separately is the
  // simplest way to get both — http.Server.listen() can only bind once.
  const ipv6Server = buildServer();
  ipv6Server.listen(port, "::1", () => {
    console.log(`[mcp:http] also listening on http://[::1]:${port}${MCP_PATH}`);
  });
  ipv6Server.on("error", (err: NodeJS.ErrnoException) => {
    // Some hosts disable IPv6 — that's fine, fall through silently.
    if (err.code === "EADDRINUSE" || err.code === "EAFNOSUPPORT") {
      console.error(`[mcp:http] IPv6 listener not started: ${err.code}`);
      return;
    }
    console.error("[mcp:http] IPv6 listener error:", err);
  });

  const stopAutoFlush = startAutoFlush({ logTag: "mcp:http" });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[mcp:http] ${signal} received — draining`);
    stopAutoFlush();
    const forceExit = setTimeout(() => {
      console.error("[mcp:http] graceful shutdown timed out — force exit");
      process.exit(1);
    }, 3_000);
    forceExit.unref();
    Promise.allSettled([
      new Promise<void>((resolve) => httpServer.close(() => resolve())),
      new Promise<void>((resolve) => ipv6Server.close(() => resolve())),
    ]).then(() => {
      console.log("[mcp:http] closed");
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[mcp:http] port ${port} is in use. Another apex-engine MCP server is probably running. Stop it (or pick a different APEX_MCP_PORT) and try again.`,
      );
      process.exit(1);
    }
    console.error("[mcp:http] listener error:", err);
    process.exit(1);
  });
}

// Only bootstrap when this file is the entrypoint — NOT when it's
// imported as a library (e.g. tests pulling in isOriginAllowed).
// process.argv[1] is the resolved path of the script tsx is running.
const isMain = (() => {
  try {
    return (
      process.argv[1] !== undefined &&
      fileURLToPath(import.meta.url) === resolve(process.argv[1])
    );
  } catch {
    return false;
  }
})();
if (isMain) bootstrap();
