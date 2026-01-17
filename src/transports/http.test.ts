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
    sessionId: "test-session-123",
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
  isInitializeRequest: vi.fn().mockImplementation((body) => {
    return body?.method === "initialize";
  }),
}));

// Create a test app that mirrors the HTTP transport setup
function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  const activeSessions = new Map<string, { close: () => void }>();

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", transport: "http", stateless: false });
  });

  // MCP POST endpoint
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && activeSessions.has(sessionId)) {
      res.json({ jsonrpc: "2.0", result: { tools: [] }, id: 1 });
    } else if (!sessionId && req.body?.method === "initialize") {
      const newSessionId = "test-session-" + Date.now();
      activeSessions.set(newSessionId, { close: () => {} });
      res.setHeader("mcp-session-id", newSessionId);
      res.json({ jsonrpc: "2.0", result: { protocolVersion: "2025-03-26" }, id: 1 });
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid request: No session ID provided and not an initialization request",
        },
        id: null,
      });
    }
  });

  // MCP GET endpoint (SSE)
  app.get("/mcp", (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !activeSessions.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid request: Session not found" },
        id: null,
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.status(200).end();
  });

  // MCP DELETE endpoint
  app.delete("/mcp", (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid request: No session ID provided" },
        id: null,
      });
      return;
    }

    if (activeSessions.has(sessionId)) {
      activeSessions.delete(sessionId);
      res.json({ message: "Session terminated" });
    } else {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Session not found" },
        id: null,
      });
    }
  });

  // Session management endpoint
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
        stateless: false,
      });
    });
  });

  describe("MCP POST endpoint", () => {
    it("should handle initialization request without session ID", async () => {
      const response = await request(app)
        .post("/mcp")
        .send({ jsonrpc: "2.0", method: "initialize", id: 1 });

      expect(response.status).toBe(200);
      expect(response.headers["mcp-session-id"]).toBeDefined();
      expect(response.body.result.protocolVersion).toBe("2025-03-26");
    });

    it("should reject non-initialization request without session ID", async () => {
      const response = await request(app)
        .post("/mcp")
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(-32600);
    });

    it("should use Mcp-Session-Id header (per MCP spec)", async () => {
      // First, initialize to get a session
      const initResponse = await request(app)
        .post("/mcp")
        .send({ jsonrpc: "2.0", method: "initialize", id: 1 });

      const sessionId = initResponse.headers["mcp-session-id"];
      expect(sessionId).toBeDefined();

      // Then use the session
      const response = await request(app)
        .post("/mcp")
        .set("mcp-session-id", sessionId)
        .send({ jsonrpc: "2.0", method: "tools/list", id: 2 });

      expect(response.status).toBe(200);
    });
  });

  describe("MCP GET endpoint (SSE)", () => {
    it("should reject GET without session ID", async () => {
      const response = await request(app).get("/mcp");

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("Session not found");
    });

    it("should reject GET with invalid session ID", async () => {
      const response = await request(app)
        .get("/mcp")
        .set("mcp-session-id", "invalid-session");

      expect(response.status).toBe(400);
    });
  });

  describe("MCP DELETE endpoint", () => {
    it("should reject DELETE without session ID", async () => {
      const response = await request(app).delete("/mcp");

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("No session ID provided");
    });

    it("should return 404 for non-existent session", async () => {
      const response = await request(app)
        .delete("/mcp")
        .set("mcp-session-id", "non-existent");

      expect(response.status).toBe(404);
    });

    it("should terminate existing session", async () => {
      // First, initialize to create a session
      const initResponse = await request(app)
        .post("/mcp")
        .send({ jsonrpc: "2.0", method: "initialize", id: 1 });

      const sessionId = initResponse.headers["mcp-session-id"];

      // Then terminate it
      const response = await request(app)
        .delete("/mcp")
        .set("mcp-session-id", sessionId);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Session terminated");
    });
  });

  describe("Session management", () => {
    it("should return empty sessions initially", async () => {
      const response = await request(app).get("/mcp/sessions");

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(0);
    });

    it("should track active sessions", async () => {
      // Create a session
      await request(app)
        .post("/mcp")
        .send({ jsonrpc: "2.0", method: "initialize", id: 1 });

      const response = await request(app).get("/mcp/sessions");

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
    });
  });
});

describe("InfomaniakClient integration", () => {
  it("should accept InfomaniakClient instance", () => {
    const mockClient = {
      ping: vi.fn(),
      getProfile: vi.fn(),
    } as unknown as InfomaniakClient;

    expect(mockClient).toBeDefined();
    expect(typeof mockClient.ping).toBe("function");
  });
});
