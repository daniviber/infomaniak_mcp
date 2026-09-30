/**
 * Tests for HTTP Transport Module
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { InfomaniakClient } from "../infomaniak-client.js";
import {
  assertSafeHttpOptions,
  createHttpApp,
  HttpServerOptions,
  isLoopbackHost,
} from "./http.js";

// Mock the transport so no real MCP session is started
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: class {
    sessionId: string;
    onclose: (() => void) | null = null;

    constructor(options: { sessionIdGenerator: () => string }) {
      this.sessionId = options.sessionIdGenerator();
    }

    async handleRequest(_req: unknown, res: { setHeader: (k: string, v: string) => void; json: (b: unknown) => void }) {
      res.setHeader("mcp-session-id", this.sessionId);
      res.json({ jsonrpc: "2.0", result: { protocolVersion: "2025-03-26" }, id: 1 });
    }

    close() {
      this.onclose?.();
    }
  },
}));

vi.mock("../server.js", () => ({
  createMcpServer: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

const client = {} as InfomaniakClient;

const initializeRequest = {
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
  id: 1,
};

const TOKEN = "test-secret-token";

function app(options: HttpServerOptions = {}) {
  return createHttpApp(client, options);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("HTTP Transport", () => {
  describe("Health endpoint", () => {
    it("should return health status", async () => {
      const response = await request(app()).get("/health");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: "ok",
        transport: "http",
        stateless: false,
      });
    });

    it("should not require the auth token", async () => {
      const response = await request(app({ authToken: TOKEN })).get("/health");

      expect(response.status).toBe(200);
    });
  });

  describe("MCP POST endpoint", () => {
    it("should handle initialization request without session ID", async () => {
      const response = await request(app()).post("/mcp").send(initializeRequest);

      expect(response.status).toBe(200);
      expect(response.headers["mcp-session-id"]).toBeDefined();
      expect(response.body.result.protocolVersion).toBe("2025-03-26");
    });

    it("should reject non-initialization request without session ID", async () => {
      const response = await request(app())
        .post("/mcp")
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(-32600);
    });

    it("should use Mcp-Session-Id header (per MCP spec)", async () => {
      const server = app();
      const initResponse = await request(server).post("/mcp").send(initializeRequest);

      const sessionId = initResponse.headers["mcp-session-id"];
      expect(sessionId).toBeDefined();

      const response = await request(server)
        .post("/mcp")
        .set("mcp-session-id", sessionId)
        .send({ jsonrpc: "2.0", method: "tools/list", id: 2 });

      expect(response.status).toBe(200);
    });
  });

  describe("MCP GET endpoint (SSE)", () => {
    it("should reject GET without session ID", async () => {
      const response = await request(app()).get("/mcp");

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("Session not found");
    });

    it("should reject GET with invalid session ID", async () => {
      const response = await request(app())
        .get("/mcp")
        .set("mcp-session-id", "invalid-session");

      expect(response.status).toBe(400);
    });
  });

  describe("MCP DELETE endpoint", () => {
    it("should reject DELETE without session ID", async () => {
      const response = await request(app()).delete("/mcp");

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("No session ID provided");
    });

    it("should return 404 for non-existent session", async () => {
      const response = await request(app())
        .delete("/mcp")
        .set("mcp-session-id", "non-existent");

      expect(response.status).toBe(404);
    });

    it("should terminate existing session", async () => {
      const server = app();
      const initResponse = await request(server).post("/mcp").send(initializeRequest);
      const sessionId = initResponse.headers["mcp-session-id"];

      const response = await request(server)
        .delete("/mcp")
        .set("mcp-session-id", sessionId);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Session terminated");
    });
  });

  describe("Session count endpoint", () => {
    it("should return zero sessions initially", async () => {
      const response = await request(app()).get("/mcp/sessions");

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(0);
    });

    it("should count active sessions without exposing their IDs", async () => {
      const server = app();
      await request(server).post("/mcp").send(initializeRequest);

      const response = await request(server).get("/mcp/sessions");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 1 });
    });
  });

  describe("Bearer authentication", () => {
    it.each([
      ["POST", "/mcp"],
      ["GET", "/mcp"],
      ["DELETE", "/mcp"],
      ["GET", "/mcp/sessions"],
    ] as const)("should reject %s %s without a token", async (method, path) => {
      const server = request(app({ authToken: TOKEN }));
      const req = method === "POST"
        ? server.post(path).send(initializeRequest)
        : method === "DELETE" ? server.delete(path) : server.get(path);

      const response = await req;

      expect(response.status).toBe(401);
      expect(response.headers["www-authenticate"]).toMatch(/^Bearer/);
    });

    it("should reject a wrong token", async () => {
      const response = await request(app({ authToken: TOKEN }))
        .post("/mcp")
        .set("Authorization", "Bearer wrong-token")
        .send(initializeRequest);

      expect(response.status).toBe(401);
    });

    it("should reject a non-Bearer scheme", async () => {
      const response = await request(app({ authToken: TOKEN }))
        .post("/mcp")
        .set("Authorization", `Basic ${TOKEN}`)
        .send(initializeRequest);

      expect(response.status).toBe(401);
    });

    it("should accept the correct token", async () => {
      const response = await request(app({ authToken: TOKEN }))
        .post("/mcp")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send(initializeRequest);

      expect(response.status).toBe(200);
      expect(response.headers["mcp-session-id"]).toBeDefined();
    });

    it("should not require a token when none is configured", async () => {
      const response = await request(app()).post("/mcp").send(initializeRequest);

      expect(response.status).toBe(200);
    });
  });

  describe("CORS", () => {
    it("should not send CORS headers by default", async () => {
      const response = await request(app())
        .post("/mcp")
        .set("Origin", "https://evil.example.com")
        .send(initializeRequest);

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
      expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    });

    it("should not answer preflight requests by default", async () => {
      const response = await request(app())
        .options("/mcp")
        .set("Origin", "https://evil.example.com")
        .set("Access-Control-Request-Method", "POST");

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("should allow configured origins without credentials", async () => {
      const response = await request(app({ corsOrigins: ["https://app.example.com"] }))
        .options("/mcp")
        .set("Origin", "https://app.example.com")
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "authorization,content-type");

      expect(response.status).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.com");
      expect(response.headers["access-control-allow-headers"]).toMatch(/Authorization/);
      expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    });

    it("should not allow origins outside the configured list", async () => {
      const response = await request(app({ corsOrigins: ["https://app.example.com"] }))
        .post("/mcp")
        .set("Origin", "https://evil.example.com")
        .send(initializeRequest);

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("should answer preflight requests before authentication", async () => {
      const response = await request(app({ authToken: TOKEN, corsOrigins: ["https://app.example.com"] }))
        .options("/mcp")
        .set("Origin", "https://app.example.com")
        .set("Access-Control-Request-Method", "POST");

      expect(response.status).toBe(204);
    });
  });

  describe("Host header validation", () => {
    it("should reject unexpected Host headers on loopback without a token", async () => {
      const response = await request(app())
        .post("/mcp")
        .set("Host", "attacker.example.com")
        .send(initializeRequest);

      expect(response.status).toBe(403);
    });

    it("should accept localhost Host headers", async () => {
      const response = await request(app())
        .post("/mcp")
        .set("Host", "localhost:3000")
        .send(initializeRequest);

      expect(response.status).toBe(200);
    });

    it("should rely on the token instead of the Host header when a token is set", async () => {
      const response = await request(app({ authToken: TOKEN }))
        .post("/mcp")
        .set("Host", "mcp.example.com")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send(initializeRequest);

      expect(response.status).toBe(200);
    });
  });
});

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"])("should treat %s as loopback", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(["0.0.0.0", "::", "192.168.1.10", "example.com", "127.example.com"])(
    "should not treat %s as loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("assertSafeHttpOptions", () => {
  it("should accept the defaults", () => {
    expect(() => assertSafeHttpOptions({})).not.toThrow();
  });

  it("should refuse a non-loopback host without a token", () => {
    expect(() => assertSafeHttpOptions({ host: "0.0.0.0" })).toThrow(/MCP_AUTH_TOKEN/);
  });

  it("should accept a non-loopback host with a token", () => {
    expect(() => assertSafeHttpOptions({ host: "0.0.0.0", authToken: TOKEN })).not.toThrow();
  });

  it("should refuse a wildcard CORS origin without a token", () => {
    expect(() => assertSafeHttpOptions({ corsOrigins: ["*"] })).toThrow(/MCP_CORS_ORIGINS/);
  });

  it("should accept a wildcard CORS origin with a token", () => {
    expect(() => assertSafeHttpOptions({ corsOrigins: ["*"], authToken: TOKEN })).not.toThrow();
  });
});
