/**
 * HTTP Transport Module
 *
 * Provides HTTP-based transport with SSE streaming for the MCP server.
 * Implements the MCP Streamable HTTP specification (2025-03-26).
 *
 * Security model (see SECURITY_AUDIT.md):
 * - Every /mcp request must carry `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>`
 *   unless `allowUnauthenticated` is explicitly set (loopback-only use).
 * - Binds to 127.0.0.1 by default; DNS-rebinding protection validates the Host
 *   header (loopback names by default, or the configured `allowedHosts`).
 * - CORS is disabled unless `corsOrigins` is configured; browser requests from
 *   other origins are rejected.
 * - Sessions are capped (`maxSessions`) and expire after `sessionTtlMs` idle time.
 * - No endpoint enumerates session IDs.
 *
 * @see https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */

import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import type { Server as HttpServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  hostHeaderValidation,
  localhostHostValidation,
} from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

export interface HttpServerOptions {
  /** Port to listen on (default: 3000) */
  port?: number;
  /** Host to bind to (default: 127.0.0.1). Use 0.0.0.0 only behind a TLS reverse proxy. */
  host?: string;
  /** Stateless mode: every request gets a fresh server/transport, no session is kept. */
  stateless?: boolean;
  /** Shared secret clients must send as `Authorization: Bearer <token>`. */
  authToken?: string;
  /** Explicitly run without authentication (NOT recommended, loopback only). */
  allowUnauthenticated?: boolean;
  /** Browser origins allowed to call the server. Empty/undefined = CORS disabled. */
  corsOrigins?: string[];
  /** Host header allow-list (DNS rebinding protection). Defaults to loopback names when bound to loopback. */
  allowedHosts?: string[];
  /** Maximum concurrent stateful sessions (default: 100). */
  maxSessions?: number;
  /** Idle time after which a session is closed (default: 30 minutes). */
  sessionTtlMs?: number;
  /** express.json body limit (default: 20mb, uploads are base64 in JSON-RPC). */
  bodyLimit?: string;
  /** Logger (default: console.error). */
  log?: (message: string) => void;
}

export interface HttpApp {
  app: Express;
  /** Number of live stateful sessions. */
  sessionCount(): number;
  /** Close all sessions and stop the sweeper. */
  close(): Promise<void>;
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: Server;
  lastSeen: number;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

function bearerAuth(token: string) {
  const expected = Buffer.from(token, "utf8");
  return (req: Request, res: Response, next: NextFunction): void => {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    const provided = match ? Buffer.from(match[1].trim(), "utf8") : Buffer.alloc(0);
    const ok = provided.length === expected.length && provided.length > 0 && timingSafeEqual(provided, expected);
    if (!ok) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
      jsonRpcError(res, 401, -32001, "Unauthorized");
      return;
    }
    next();
  };
}

/** Reject browser requests whose Origin is not explicitly allowed (CSRF / DNS rebinding). */
function originGuard(allowed: string[]) {
  const allowedSet = new Set(allowed.map((o) => o.toLowerCase()));
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin && !allowedSet.has(origin.toLowerCase())) {
      jsonRpcError(res, 403, -32000, "Origin not allowed");
      return;
    }
    next();
  };
}

/**
 * Build the Express application (exported for tests).
 *
 * @param createServer - Factory building a configured MCP server per session
 * @param options - HTTP server configuration options
 */
export function createHttpApp(createServer: () => Server, options: HttpServerOptions = {}): HttpApp {
  const host = options.host ?? "127.0.0.1";
  const stateless = options.stateless ?? false;
  const corsOrigins = (options.corsOrigins ?? []).filter((o) => o.length > 0);
  const maxSessions = options.maxSessions ?? 100;
  const sessionTtlMs = options.sessionTtlMs ?? 30 * 60_000;
  const bodyLimit = options.bodyLimit ?? "20mb";
  const log = options.log ?? ((m: string) => console.error(m));

  if (!options.authToken && !options.allowUnauthenticated) {
    throw new Error(
      "HTTP transport requires MCP_HTTP_AUTH_TOKEN (shared secret sent as 'Authorization: Bearer ...'). " +
        "Set MCP_HTTP_ALLOW_UNAUTHENTICATED=true to run without authentication on a loopback interface only.",
    );
  }
  if (!options.authToken && !LOOPBACK_HOSTS.has(host)) {
    throw new Error(`Refusing to run without authentication on non-loopback host ${host}.`);
  }
  if (options.authToken && options.authToken.length < 16) {
    throw new Error("MCP_HTTP_AUTH_TOKEN must be at least 16 characters long.");
  }
  if (corsOrigins.includes("*")) {
    throw new Error("MCP_CORS_ORIGINS must list explicit origins; '*' is not allowed.");
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  // DNS rebinding protection: validate the Host header.
  if (options.allowedHosts && options.allowedHosts.length > 0) {
    app.use(hostHeaderValidation(options.allowedHosts));
  } else if (LOOPBACK_HOSTS.has(host)) {
    app.use(localhostHostValidation());
  } else {
    log(`Warning: binding to ${host} without a Host allow-list (set MCP_ALLOWED_HOSTS). Authentication is enforced.`);
  }

  // Browser access: opt-in only.
  app.use(originGuard(corsOrigins));
  if (corsOrigins.length > 0) {
    app.use(
      cors({
        origin: corsOrigins,
        methods: ["GET", "POST", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Accept", "Authorization", "Mcp-Session-Id", "Last-Event-ID", "MCP-Protocol-Version"],
        exposedHeaders: ["Mcp-Session-Id"],
        credentials: false,
        maxAge: 600,
      }),
    );
  }

  app.use(express.json({ limit: bodyLimit }));

  // Health check (no secrets, no session data).
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", transport: "http" });
  });

  const mcp = express.Router();
  if (options.authToken) mcp.use(bearerAuth(options.authToken));

  const sessions = new Map<string, SessionEntry>();

  async function destroySession(id: string): Promise<void> {
    const entry = sessions.get(id);
    if (!entry) return;
    sessions.delete(id);
    try {
      await entry.transport.close();
    } catch {
      /* ignore */
    }
    try {
      await entry.server.close();
    } catch {
      /* ignore */
    }
  }

  const sweeper = setInterval(() => {
    const cutoff = Date.now() - sessionTtlMs;
    for (const [id, entry] of sessions) {
      if (entry.lastSeen < cutoff) {
        log(`Session expired: ${id}`);
        void destroySession(id);
      }
    }
  }, Math.min(sessionTtlMs, 60_000));
  sweeper.unref();

  function sessionIdOf(req: Request): string | undefined {
    const raw = req.headers["mcp-session-id"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && /^[A-Za-z0-9._~-]{8,128}$/.test(value) ? value : undefined;
  }

  async function handleStateless(req: Request, res: Response): Promise<void> {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createServer();
    res.on("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  async function handleStatefulPost(req: Request, res: Response): Promise<void> {
    const sessionId = sessionIdOf(req);

    if (sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) {
        jsonRpcError(res, 404, -32001, "Session not found");
        return;
      }
      entry.lastSeen = Date.now();
      await entry.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      jsonRpcError(res, 400, -32600, "Invalid request: no Mcp-Session-Id header and not an initialization request");
      return;
    }

    if (sessions.size >= maxSessions) {
      jsonRpcError(res, 503, -32000, "Too many active sessions, retry later");
      return;
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server, lastSeen: Date.now() });
        log(`Session created: ${id}`);
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
        log(`Session closed: ${id}`);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    // Belt and braces: make sure an initialised transport is tracked.
    if (transport.sessionId && !sessions.has(transport.sessionId)) {
      sessions.set(transport.sessionId, { transport, server, lastSeen: Date.now() });
    }
  }

  function wrap(handler: (req: Request, res: Response) => Promise<void>) {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        await handler(req, res);
      } catch (error) {
        log(`MCP request error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error");
      }
    };
  }

  // POST: client-to-server messages
  mcp.post("/", wrap(async (req, res) => (stateless ? handleStateless(req, res) : handleStatefulPost(req, res))));

  // GET: standalone SSE stream (stateful only)
  mcp.get(
    "/",
    wrap(async (req, res) => {
      if (stateless) {
        jsonRpcError(res, 405, -32000, "Method not allowed in stateless mode");
        return;
      }
      const sessionId = sessionIdOf(req);
      const entry = sessionId ? sessions.get(sessionId) : undefined;
      if (!entry) {
        jsonRpcError(res, sessionId ? 404 : 400, -32001, "Session not found");
        return;
      }
      entry.lastSeen = Date.now();
      await entry.transport.handleRequest(req, res);
    }),
  );

  // DELETE: session termination (stateful only)
  mcp.delete(
    "/",
    wrap(async (req, res) => {
      if (stateless) {
        jsonRpcError(res, 405, -32000, "Method not allowed in stateless mode");
        return;
      }
      const sessionId = sessionIdOf(req);
      if (!sessionId) {
        jsonRpcError(res, 400, -32600, "Invalid request: no Mcp-Session-Id header");
        return;
      }
      if (!sessions.has(sessionId)) {
        jsonRpcError(res, 404, -32001, "Session not found");
        return;
      }
      await destroySession(sessionId);
      res.status(200).json({ message: "Session terminated" });
    }),
  );

  app.use("/mcp", mcp);

  // Anything else: 404 without details.
  app.use((_req: Request, res: Response) => {
    jsonRpcError(res, 404, -32601, "Not found");
  });

  return {
    app,
    sessionCount: () => sessions.size,
    close: async () => {
      clearInterval(sweeper);
      await Promise.all([...sessions.keys()].map((id) => destroySession(id)));
    },
  };
}

/**
 * Start the MCP server with HTTP transport
 *
 * @param createServer - Factory building a configured MCP server per session
 * @param options - HTTP server configuration options
 */
export async function startHttpServer(createServer: () => Server, options: HttpServerOptions = {}): Promise<HttpServer> {
  const port = options.port ?? 3000;
  const host = options.host ?? "127.0.0.1";
  const log = options.log ?? ((m: string) => console.error(m));
  const { app } = createHttpApp(createServer, { ...options, host });

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(port, host, () => {
      log(`Infomaniak MCP Server running on http://${host}:${port}/mcp`);
      log(`Mode: ${options.stateless ? "stateless" : "stateful"}; auth: ${options.authToken ? "bearer token" : "NONE (unauthenticated)"}`);
      log(`Health check: http://${host}:${port}/health`);
      resolve(httpServer);
    });
    httpServer.on("error", reject);
  });
}
