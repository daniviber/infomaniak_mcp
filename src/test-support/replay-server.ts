/**
 * A real HTTP server for the tests, replaying what api.infomaniak.com answered.
 *
 * The client under test is not patched: it is pointed at this server through
 * its `baseUrl` option and speaks real HTTP to it. Each route is a recording
 * from src/__fixtures__ (status + body as the API sent them, anonymised), and
 * every request received is kept, so a test can read back the method, the
 * path, the query and the body the client actually sent.
 */

import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { AddressInfo } from "net";

export interface Recording {
  _recorded: { url: string; status: number; date: string; note: string };
  status: number;
  body: unknown;
}

export interface SeenRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__");

export function recording(name: string): Recording {
  const doc = JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8")) as Recording;
  if (!doc._recorded) throw new Error(`${name} carries no provenance`);
  return doc;
}

type Route = { status: number; body: unknown; headers?: Record<string, string> };

export class ReplayServer {
  readonly requests: SeenRequest[] = [];
  private readonly routes = new Map<string, Route>();
  private server: Server | null = null;
  private port = 0;

  /** Answer `METHOD /path` (path without query) with a recording or a literal response. */
  on(method: string, path: string, response: string | Route): this {
    const route = typeof response === "string" ? { status: recording(response).status, body: recording(response).body } : response;
    this.routes.set(`${method.toUpperCase()} ${path}`, route);
    return this;
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this.baseUrl;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => this.server!.close((err) => (err ? reject(err) : resolve())));
    this.server = null;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", this.baseUrl);
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = raw === "" ? undefined : raw;
      try {
        if (raw !== "") body = JSON.parse(raw);
      } catch {
        /* not JSON: kept as text */
      }
      this.requests.push({
        method: req.method ?? "",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        body,
      });
      const route = this.routes.get(`${req.method} ${url.pathname}`);
      if (!route) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: "error", error: { code: "not_recorded", description: `no recording for ${req.method} ${url.pathname}` } }));
        return;
      }
      res.writeHead(route.status, { "Content-Type": "application/json", ...(route.headers ?? {}) });
      res.end(typeof route.body === "string" ? route.body : JSON.stringify(route.body));
    });
  }
}
