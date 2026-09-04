/**
 * Tests for the HTTP transport (real Express app from createHttpApp).
 *
 * The MCP StreamableHTTPServerTransport is replaced by a small fake that mimics
 * session initialisation; everything else (auth, host/origin checks, session
 * store, routing) is the real implementation.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => {
  class FakeTransport {
    sessionId: string | undefined;
    onclose?: () => void;
    private readonly opts: {
      sessionIdGenerator?: () => string;
      onsessioninitialized?: (id: string) => void | Promise<void>;
    };

    constructor(opts?: FakeTransport["opts"]) {
      this.opts = opts ?? {};
    }

    async start(): Promise<void> {}

    async close(): Promise<void> {
      this.onclose?.();
    }

    async handleRequest(
      req: { method: string },
      res: { setHeader: (k: string, v: string) => void; status: (c: number) => { end: () => void }; json: (b: unknown) => void },
      body?: { method?: string; id?: number },
    ): Promise<void> {
      if (req.method === "POST" && body?.method === "initialize") {
        if (this.opts.sessionIdGenerator) {
          this.sessionId = this.opts.sessionIdGenerator();
          await this.opts.onsessioninitialized?.(this.sessionId);
          res.setHeader("mcp-session-id", this.sessionId);
        }
        res.json({ jsonrpc: "2.0", result: { protocolVersion: "2025-03-26" }, id: body.id ?? null });
        return;
      }
      if (req.method === "GET") {
        res.setHeader("content-type", "text/event-stream");
        res.status(200).end();
        return;
      }
      res.json({ jsonrpc: "2.0", result: { echo: body?.method ?? null, session: this.sessionId ?? null }, id: body?.id ?? null });
    }
  }
  return { StreamableHTTPServerTransport: FakeTransport };
});

import { createHttpApp, HttpApp, HttpServerOptions } from "./http.js";

const TOKEN = "super-secret-token-1234567890";

function fakeServerFactory() {
  const created: Array<{ connect: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
  const factory = () => {
    const server = { connect: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    created.push(server);
    return server as unknown as Server;
  };
  return { factory, created };
}

const INIT_BODY = {
  jsonrpc: "2.0",
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
  id: 1,
};

const apps: HttpApp[] = [];
function build(options: HttpServerOptions = {}) {
  const { factory, created } = fakeServerFactory();
  const httpApp = createHttpApp(factory, { authToken: TOKEN, log: () => undefined, ...options });
  apps.push(httpApp);
  return { ...httpApp, created };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

describe("createHttpApp configuration guards", () => {
  it("refuses to start without an auth token", () => {
    const { factory } = fakeServerFactory();
    expect(() => createHttpApp(factory, { log: () => undefined })).toThrow(/MCP_HTTP_AUTH_TOKEN/);
  });

  it("refuses unauthenticated mode on a non-loopback host", () => {
    const { factory } = fakeServerFactory();
    expect(() => createHttpApp(factory, { allowUnauthenticated: true, host: "0.0.0.0", log: () => undefined })).toThrow(/non-loopback/);
  });

  it("refuses short auth tokens", () => {
    const { factory } = fakeServerFactory();
    expect(() => createHttpApp(factory, { authToken: "short", log: () => undefined })).toThrow(/at least 16/);
  });

  it("refuses wildcard CORS origins", () => {
    const { factory } = fakeServerFactory();
    expect(() => createHttpApp(factory, { authToken: TOKEN, corsOrigins: ["*"], log: () => undefined })).toThrow(/'\*' is not allowed/);
  });

  it("allows explicit unauthenticated loopback mode", () => {
    const { factory } = fakeServerFactory();
    const app = createHttpApp(factory, { allowUnauthenticated: true, host: "127.0.0.1", log: () => undefined });
    apps.push(app);
    expect(app.app).toBeDefined();
  });
});

describe("authentication", () => {
  it("serves /health without authentication and without session data", async () => {
    const { app } = build();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", transport: "http" });
  });

  it("rejects /mcp without a bearer token", async () => {
    const { app, created } = build();
    const res = await request(app).post("/mcp").send(INIT_BODY);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
    expect(created).toHaveLength(0);
  });

  it("rejects /mcp with a wrong bearer token", async () => {
    const { app } = build();
    const res = await request(app).post("/mcp").set("Authorization", `Bearer ${TOKEN}x`).send(INIT_BODY);
    expect(res.status).toBe(401);
  });

  it("does not expose a session listing endpoint", async () => {
    const { app } = build();
    const res = await request(app).get("/mcp/sessions").set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("activeSessions");
  });
});

describe("DNS rebinding and browser protections", () => {
  it("rejects requests whose Host header is not loopback", async () => {
    const { app } = build();
    const res = await request(app).get("/health").set("Host", "evil.example.com");
    expect(res.status).toBe(403);
  });

  it("accepts hosts from the configured allow-list", async () => {
    const { app } = build({ host: "0.0.0.0", allowedHosts: ["mcp.example.com"] });
    const ok = await request(app).get("/health").set("Host", "mcp.example.com");
    expect(ok.status).toBe(200);
    const bad = await request(app).get("/health").set("Host", "other.example.com");
    expect(bad.status).toBe(403);
  });

  it("rejects browser requests from unknown origins", async () => {
    const { app } = build();
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Origin", "https://attacker.example")
      .send(INIT_BODY);
    expect(res.status).toBe(403);
  });

  it("allows configured CORS origins without credentials", async () => {
    const { app } = build({ corsOrigins: ["https://app.example.com"] });
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Origin", "https://app.example.com")
      .send(INIT_BODY);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

describe("stateful sessions", () => {
  it("creates a session on initialize and reuses it", async () => {
    const { app, created, sessionCount } = build();

    const init = await request(app).post("/mcp").set("Authorization", `Bearer ${TOKEN}`).send(INIT_BODY);
    expect(init.status).toBe(200);
    const sessionId = init.headers["mcp-session-id"];
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionCount()).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].connect).toHaveBeenCalledTimes(1);

    const list = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Mcp-Session-Id", sessionId)
      .send({ jsonrpc: "2.0", method: "tools/list", id: 2 });
    expect(list.status).toBe(200);
    expect(list.body.result.session).toBe(sessionId);
    expect(created).toHaveLength(1);
  });

  it("rejects non-initialize requests without a session", async () => {
    const { app } = build();
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ jsonrpc: "2.0", method: "tools/list", id: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32600);
  });

  it("returns 404 for unknown sessions on POST, GET and DELETE", async () => {
    const { app } = build();
    const auth = `Bearer ${TOKEN}`;
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await request(app).post("/mcp").set("Authorization", auth).set("Mcp-Session-Id", unknown).send({ jsonrpc: "2.0", method: "tools/list", id: 1 })).status).toBe(404);
    expect((await request(app).get("/mcp").set("Authorization", auth).set("Mcp-Session-Id", unknown)).status).toBe(404);
    expect((await request(app).delete("/mcp").set("Authorization", auth).set("Mcp-Session-Id", unknown)).status).toBe(404);
  });

  it("opens an SSE stream for an existing session", async () => {
    const { app } = build();
    const init = await request(app).post("/mcp").set("Authorization", `Bearer ${TOKEN}`).send(INIT_BODY);
    const res = await request(app).get("/mcp").set("Authorization", `Bearer ${TOKEN}`).set("Mcp-Session-Id", init.headers["mcp-session-id"]);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
  });

  it("terminates a session on DELETE and closes its server", async () => {
    const { app, created, sessionCount } = build();
    const init = await request(app).post("/mcp").set("Authorization", `Bearer ${TOKEN}`).send(INIT_BODY);
    const res = await request(app).delete("/mcp").set("Authorization", `Bearer ${TOKEN}`).set("Mcp-Session-Id", init.headers["mcp-session-id"]);
    expect(res.status).toBe(200);
    expect(sessionCount()).toBe(0);
    expect(created[0].close).toHaveBeenCalled();
  });

  it("caps the number of concurrent sessions", async () => {
    const { app } = build({ maxSessions: 2 });
    const auth = `Bearer ${TOKEN}`;
    expect((await request(app).post("/mcp").set("Authorization", auth).send(INIT_BODY)).status).toBe(200);
    expect((await request(app).post("/mcp").set("Authorization", auth).send(INIT_BODY)).status).toBe(200);
    const third = await request(app).post("/mcp").set("Authorization", auth).send(INIT_BODY);
    expect(third.status).toBe(503);
  });

  it("expires idle sessions", async () => {
    const { app, sessionCount } = build({ sessionTtlMs: 40 });
    await request(app).post("/mcp").set("Authorization", `Bearer ${TOKEN}`).send(INIT_BODY);
    expect(sessionCount()).toBe(1);
    await new Promise((r) => setTimeout(r, 160));
    expect(sessionCount()).toBe(0);
  });

  it("ignores malformed session ids", async () => {
    const { app } = build();
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Mcp-Session-Id", "../etc/passwd")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });
    expect(res.status).toBe(400);
  });
});

describe("stateless mode", () => {
  it("answers initialize without creating a session", async () => {
    const { app, sessionCount, created } = build({ stateless: true });
    const res = await request(app).post("/mcp").set("Authorization", `Bearer ${TOKEN}`).send(INIT_BODY);
    expect(res.status).toBe(200);
    expect(res.headers["mcp-session-id"]).toBeUndefined();
    expect(sessionCount()).toBe(0);
    expect(created).toHaveLength(1);
  });

  it("rejects GET and DELETE", async () => {
    const { app } = build({ stateless: true });
    expect((await request(app).get("/mcp").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(405);
    expect((await request(app).delete("/mcp").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(405);
  });
});

describe("error handling", () => {
  it("returns a generic 500 without leaking internals", async () => {
    const factory = () => {
      throw new Error("database password is hunter2");
    };
    const httpApp = createHttpApp(factory as unknown as () => Server, { authToken: TOKEN, log: () => undefined });
    apps.push(httpApp);
    const res = await request(httpApp.app).post("/mcp").set("Authorization", `Bearer ${TOKEN}`).send(INIT_BODY);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
  });
});
