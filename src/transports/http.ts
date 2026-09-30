/**
 * HTTP Transport Module
 *
 * Provides HTTP-based transport with SSE streaming for the MCP server.
 * Implements the MCP Streamable HTTP specification (2025-03-26).
 *
 * Security defaults:
 * - Listens on 127.0.0.1 unless another host is configured.
 * - Refuses to listen on a non-loopback host without a bearer token.
 * - CORS is disabled unless allowed origins are configured.
 * - When listening on loopback without a token, the Host header is validated
 *   to protect against DNS rebinding.
 *
 * @see https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */

import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { isIPv4 } from "net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { InfomaniakClient } from "../infomaniak-client.js";
import { KChatClient } from "../kchat-client.js";
import { createMcpServer } from "../server.js";

export interface HttpServerOptions {
  /** Port to listen on (default: 3000) */
  port?: number;
  /** Host to bind to (default: '127.0.0.1'). A non-loopback host requires `authToken`. */
  host?: string;
  /** Enable stateless mode where each request creates a new session */
  stateless?: boolean;
  /** Allowed CORS origins (default: none, CORS disabled). '*' requires `authToken`. */
  corsOrigins?: string[];
  /** Bearer token required on all /mcp routes when set */
  authToken?: string;
}

export const DEFAULT_HTTP_HOST = "127.0.0.1";

/**
 * Whether a host only accepts connections from the local machine.
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized === "[::1]") {
    return true;
  }
  return isIPv4(normalized) && normalized.startsWith("127.");
}

/**
 * Validate an HTTP configuration before starting the server.
 * Throws with an actionable message when the configuration is unsafe.
 */
export function assertSafeHttpOptions(options: HttpServerOptions): void {
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const hasToken = Boolean(options.authToken);

  if (!hasToken && !isLoopbackHost(host)) {
    throw new Error(
      `Refusing to listen on ${host} without authentication. ` +
        "Set MCP_AUTH_TOKEN to require a bearer token on /mcp, " +
        "or unset MCP_HOST to listen on 127.0.0.1 only.",
    );
  }

  if (!hasToken && options.corsOrigins?.includes("*")) {
    throw new Error(
      "MCP_CORS_ORIGINS='*' requires MCP_AUTH_TOKEN. " +
        "List the allowed origins explicitly or set MCP_AUTH_TOKEN.",
    );
  }
}

function tokensMatch(provided: string, expected: string): boolean {
  // Hash both values so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function requireBearerToken(expected: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);

    if (!match || !tokensMatch(match[1].trim(), expected)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }

    next();
  };
}

/**
 * Build the Express application serving the MCP endpoints.
 * Exported for testing; use `startHttpServer` to run the server.
 */
export function createHttpApp(
  client: InfomaniakClient,
  options: HttpServerOptions = {},
  kchatClient?: KChatClient | null,
): Express {
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const stateless = options.stateless ?? false;
  const corsOrigins = options.corsOrigins ?? [];
  const authToken = options.authToken;

  // Store active transports for session management (stateful mode)
  const activeSessions = new Map<string, StreamableHTTPServerTransport>();

  const app = express();

  // Without a token, a loopback server is protected from browsers only by the
  // Host header check (DNS rebinding protection).
  if (!authToken && isLoopbackHost(host)) {
    app.use(localhostHostValidation());
  }

  // CORS is only enabled for explicitly allowed origins. Credentials (cookies)
  // are not used: clients authenticate with the Authorization header.
  if (corsOrigins.length > 0) {
    app.use(cors({
      origin: corsOrigins.includes("*") ? "*" : corsOrigins,
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Accept", "Authorization", "Mcp-Session-Id", "Last-Event-ID"],
      exposedHeaders: ["Mcp-Session-Id"],
    }));
  }

  // Health check endpoint (unauthenticated, exposes no account data)
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", transport: "http", stateless });
  });

  // All /mcp routes require the bearer token when one is configured.
  // Registered before the body parser so unauthenticated bodies are not parsed.
  if (authToken) {
    app.use("/mcp", requireBearerToken(authToken));
  }

  app.use(express.json());

  // MCP endpoint - POST for client-to-server messages
  app.post("/mcp", async (req: Request, res: Response) => {
    // Check for existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && activeSessions.has(sessionId)) {
      // Reuse existing session
      transport = activeSessions.get(sessionId);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request - create new transport with pre-generated session ID
      const newSessionId = randomUUID();

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      });

      // Create and connect the MCP server for this session
      const server = createMcpServer(client, kchatClient);
      await server.connect(transport);

      // Store session immediately if stateful mode (before handleRequest)
      if (!stateless) {
        activeSessions.set(newSessionId, transport);
        console.error(`Session created: ${newSessionId}`);

        // Clean up session on close
        transport.onclose = () => {
          activeSessions.delete(newSessionId);
          console.error(`Session closed: ${newSessionId}`);
        };
      }
    } else {
      // Invalid request - no session and not an initialization request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid request: No session ID provided and not an initialization request",
        },
        id: null,
      });
      return;
    }

    // Handle the request through the transport
    try {
      await transport!.handleRequest(req, res, req.body);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("MCP request error:", errorMessage);

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: errorMessage },
          id: null,
        });
      }
    }
  });

  // MCP endpoint - GET for SSE stream (server-to-client notifications)
  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !activeSessions.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid request: Session not found",
        },
        id: null,
      });
      return;
    }

    const transport = activeSessions.get(sessionId)!;

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("MCP SSE error:", errorMessage);

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: errorMessage },
          id: null,
        });
      }
    }
  });

  // MCP endpoint - DELETE for session termination
  app.delete("/mcp", (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid request: No session ID provided",
        },
        id: null,
      });
      return;
    }

    if (activeSessions.has(sessionId)) {
      const transport = activeSessions.get(sessionId)!;
      transport.close();
      activeSessions.delete(sessionId);
      res.status(200).json({ message: "Session terminated" });
    } else {
      res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Session not found",
        },
        id: null,
      });
    }
  });

  // Session count (for monitoring). Session IDs are not listed: they act as
  // credentials for an open session.
  app.get("/mcp/sessions", (_req: Request, res: Response) => {
    res.json({ count: activeSessions.size });
  });

  return app;
}

/**
 * Start the MCP server with HTTP transport
 *
 * @param client - The Infomaniak API client
 * @param options - HTTP server configuration options
 * @param kchatClient - Optional kChat API client
 */
export async function startHttpServer(
  client: InfomaniakClient,
  options: HttpServerOptions = {},
  kchatClient?: KChatClient | null,
): Promise<void> {
  assertSafeHttpOptions(options);

  const port = options.port ?? 3000;
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const stateless = options.stateless ?? false;

  const app = createHttpApp(client, options, kchatClient);

  await new Promise<void>((resolve, reject) => {
    app.listen(port, host, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      console.error(`Infomaniak MCP Server running on http://${host}:${port}/mcp`);
      console.error(`Mode: ${stateless ? "stateless" : "stateful"}`);
      console.error(`Authentication: ${options.authToken ? "bearer token" : "none (loopback only)"}`);
      console.error(`Health check: http://${host}:${port}/health`);
      resolve();
    });
  });
}
