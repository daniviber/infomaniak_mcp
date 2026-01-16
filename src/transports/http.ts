/**
 * HTTP Transport Module
 *
 * Provides HTTP-based transport with SSE streaming for the MCP server.
 * This enables web-based MCP clients and remote connections.
 */

import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InfomaniakClient } from "../infomaniak-client.js";
import { createMcpServer } from "../server.js";

export interface HttpServerOptions {
  /** Port to listen on (default: 3000) */
  port?: number;
  /** Session mode: 'stateful' maintains sessions, 'stateless' for single requests */
  sessionMode?: "stateful" | "stateless";
}

// Store active transports for session management
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
  const sessionMode = options.sessionMode ?? "stateful";

  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", transport: "http", sessionMode });
  });

  // MCP endpoint - handles all MCP protocol requests
  app.all("/mcp", async (req: Request, res: Response) => {
    // Get or create session
    let sessionId = req.headers["x-mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionMode === "stateful" && sessionId && activeSessions.has(sessionId)) {
      // Reuse existing session
      transport = activeSessions.get(sessionId)!;
    } else {
      // Create new session
      sessionId = randomUUID();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId!,
      });

      // Create and connect the MCP server for this session
      const server = createMcpServer(client);
      await server.connect(transport);

      if (sessionMode === "stateful") {
        activeSessions.set(sessionId, transport);

        // Clean up session on close
        transport.onclose = () => {
          activeSessions.delete(sessionId!);
        };
      }
    }

    // Set session ID in response header
    res.setHeader("x-mcp-session-id", sessionId);

    // Handle the request through the transport
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("MCP request error:", errorMessage);

      if (!res.headersSent) {
        res.status(500).json({ error: errorMessage });
      }
    }
  });

  // Session management endpoint (stateful mode only)
  if (sessionMode === "stateful") {
    app.delete("/mcp/session/:sessionId", (req: Request, res: Response) => {
      const sessionId = req.params.sessionId as string;

      if (activeSessions.has(sessionId)) {
        const transport = activeSessions.get(sessionId)!;
        transport.close();
        activeSessions.delete(sessionId);
        res.json({ message: "Session closed" });
      } else {
        res.status(404).json({ error: "Session not found" });
      }
    });

    app.get("/mcp/sessions", (_req: Request, res: Response) => {
      res.json({
        activeSessions: Array.from(activeSessions.keys()),
        count: activeSessions.size,
      });
    });
  }

  // Start the server
  app.listen(port, () => {
    console.error(`Infomaniak MCP Server running on http://localhost:${port}/mcp`);
    console.error(`Session mode: ${sessionMode}`);
    console.error(`Health check: http://localhost:${port}/health`);
  });
}
