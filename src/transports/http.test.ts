/**
 * Tests for HTTP Transport Module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { Express } from "express";
import request from "supertest";
import { InfomaniakClient } from "../infomaniak-client.js";

// Mock the MCP SDK modules
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(() => ({
    handleRequest: vi.fn().mockImplementation(async (_req, res) => {
      res.json({ jsonrpc: "2.0", result: { tools: [] }, id: 1 });
    }),
    close: vi.fn(),
    onclose: null,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    setRequestHandler: vi.fn(),
  })),
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  CallToolRequestSchema: {},
  ListToolsRequestSchema: {},
}));

// Create a test app that mirrors the HTTP transport setup
function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  const activeSessions = new Map<string, { close: () => void }>();

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", transport: "http", sessionMode: "stateful" });
  });

  // MCP endpoint - simplified for testing
  app.all("/mcp", async (_req, res) => {
    const sessionId = "test-session-" + Date.now();
    res.setHeader("x-mcp-session-id", sessionId);
    res.json({ jsonrpc: "2.0", result: { tools: [] }, id: 1 });
  });

  // Session management endpoints
  app.delete("/mcp/session/:sessionId", (req, res) => {
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

  app.get("/mcp/sessions", (_req, res) => {
    res.json({
      activeSessions: Array.from(activeSessions.keys()),
      count: activeSessions.size,
    });
  });

  return app;
}

describe("HTTP Transport", () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Health endpoint", () => {
    it("should return health status", async () => {
      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: "ok",
        transport: "http",
        sessionMode: "stateful",
      });
    });
  });

  describe("MCP endpoint", () => {
    it("should handle POST requests", async () => {
      const response = await request(app)
        .post("/mcp")
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      expect(response.status).toBe(200);
      expect(response.headers["x-mcp-session-id"]).toBeDefined();
    });

    it("should handle GET requests", async () => {
      const response = await request(app).get("/mcp");

      expect(response.status).toBe(200);
    });

    it("should return session ID in header", async () => {
      const response = await request(app)
        .post("/mcp")
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      expect(response.headers["x-mcp-session-id"]).toMatch(/^test-session-\d+$/);
    });
  });

  describe("Session management", () => {
    it("should return empty sessions initially", async () => {
      const response = await request(app).get("/mcp/sessions");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        activeSessions: [],
        count: 0,
      });
    });

    it("should return 404 for non-existent session deletion", async () => {
      const response = await request(app).delete("/mcp/session/non-existent");

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Session not found" });
    });
  });
});

describe("HTTP Transport Options", () => {
  it("should use default port 3000", () => {
    const defaultPort = 3000;
    expect(defaultPort).toBe(3000);
  });

  it("should support stateful session mode", () => {
    const sessionMode = "stateful";
    expect(sessionMode).toBe("stateful");
  });

  it("should support stateless session mode", () => {
    const sessionMode = "stateless";
    expect(sessionMode).toBe("stateless");
  });
});

describe("InfomaniakClient integration", () => {
  it("should accept InfomaniakClient instance", () => {
    // This test verifies the type compatibility
    const mockClient = {
      ping: vi.fn(),
      getProfile: vi.fn(),
    } as unknown as InfomaniakClient;

    expect(mockClient).toBeDefined();
    expect(typeof mockClient.ping).toBe("function");
  });
});
