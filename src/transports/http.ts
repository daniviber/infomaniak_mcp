/**
 * HTTP Transport Module
 *
 * Provides HTTP-based transport with SSE streaming for the MCP server.
 * Implements the MCP Streamable HTTP specification (2025-03-26).
 *
 * @see https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */

import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { InfomaniakClient } from "../infomaniak-client.js";
import { createMcpServer } from "../server.js";

export interface HttpServerOptions {
  /** Port to listen on (default: 3000) */
  port?: number;
  /** Enable stateless mode where each request creates a new session */
  stateless?: boolean;
  /** Allowed CORS origins (default: '*' allows all) */
  corsOrigins?: string | string[];
}

// Store active transports for session management (stateful mode)
const activeSessions = new Map<string, StreamableHTTPServerTransport>();

/**
 * Start the MCP server with HTTP transport
 *
 * @param client - The Infomaniak API client
 * @param options - HTTP server configuration options
 */
export async function startHttpServer(
  client: InfomaniakClient,
  options: HttpServerOptions = {}
): Promise<void> {
  const port = options.port ?? 3000;
  const stateless = options.stateless ?? false;
  const corsOrigins = options.corsOrigins ?? "*";

  const app = express();

  // Enable CORS for browser-based MCP clients
  app.use(cors({
    origin: corsOrigins,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "Last-Event-ID"],
    exposedHeaders: ["Mcp-Session-Id"],
    credentials: true,
  }));

  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", transport: "http", stateless });
  });

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
      const server = createMcpServer(client);
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

  // Session management endpoints (for debugging/monitoring)
  app.get("/mcp/sessions", (_req: Request, res: Response) => {
    res.json({
      activeSessions: Array.from(activeSessions.keys()),
      count: activeSessions.size,
    });
  });

  // Start the server
  app.listen(port, () => {
    console.error(`Infomaniak MCP Server running on http://localhost:${port}/mcp`);
    console.error(`Mode: ${stateless ? "stateless" : "stateful"}`);
    console.error(`Health check: http://localhost:${port}/health`);
  });
}
