import { execFileSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { McpServer } from '@modelcontextprotocol/server';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/main/bootstrap.js';
import { createLegacyHttpApplication } from '../../src/main/legacy.js';
import { runLegacyStdio } from '../../src/adapters/inbound/mcp/legacy-stdio.js';
import { startModernStdio } from '../../src/adapters/inbound/mcp/modern-stdio.js';
import { createLegacyHttpHandler } from '../../src/adapters/inbound/http/legacy-http.js';
import { ENVELOPE_RESERVE } from '../../src/application/drive/transfer.feature.js';

// Observers forward to the installed SDK: no transport or protocol implementation is replaced.
const trace = vi.hoisted(() => ({
  instances: vi.fn(),
  factory: vi.fn(),
  route: vi.fn(),
  classify: vi.fn(),
}));
vi.mock('@modelcontextprotocol/server', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@modelcontextprotocol/server')>();
  return {
    ...sdk,
    McpServer: class extends sdk.McpServer {
      constructor(...args: ConstructorParameters<typeof sdk.McpServer>) {
        super(...args);
        trace.instances(this);
      }
    },
    createMcpHandler: (...args: Parameters<typeof sdk.createMcpHandler>) => {
      const [factory, options] = args;
      const handler = sdk.createMcpHandler((...factoryArgs) => {
        trace.factory(options?.legacy);
        return factory(...factoryArgs);
      }, options);
      return {
        ...handler,
        fetch: (...requestArgs: Parameters<typeof handler.fetch>) => {
          trace.route(args[1]?.legacy);
          return handler.fetch(...requestArgs);
        },
      };
    },
    isLegacyRequest: (...args: Parameters<typeof sdk.isLegacyRequest>) => {
      trace.classify();
      return sdk.isLegacyRequest(...args);
    },
  };
});

const root = fileURLToPath(new URL('../../', import.meta.url));
const pattern = fileURLToPath(new URL('../../src/features/**/*.feature.ts', import.meta.url));
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/mcp-2025.json', import.meta.url), 'utf8'),
);
const bearer = 'HTTP_FIXTURE_BEARER_SENTINEL';
const secret = 'PROVIDER_PRIVATE_SENTINEL';
const defaults = { INFOMANIAK_API_TOKEN: 'offline-fixture', MCP_HTTP_AUTH_TOKEN: bearer };
const all = {
  INFOMANIAK_ALLOW_EXPERIMENTAL: 'true',
  INFOMANIAK_ALLOW_RAW_API: 'true',
  KCHAT_HOST: 'chat.example.test',
  KCHAT_TOKEN: 'offline-chat-fixture',
};
const clock = {
  now: () => 0,
  wait: async () => {
    throw new Error('Unexpected quota wait');
  },
};
const closers: (() => Promise<void>)[] = [];
type Era = 'legacy' | 'modern';
type Runtime = Awaited<ReturnType<typeof bootstrap>>;
const names = (tools: readonly { name: string }[]) => tools.map(({ name }) => name).sort();
const instances = (): McpServer[] => trace.instances.mock.calls.map(([server]) => server);
const makeClient = (name: string) =>
  new Client(
    { name, version: '1' },
    { versionNegotiation: { mode: { pin: fixture.modernVersion } } },
  );
const prior = (era: Era) => (era === 'legacy' ? { prior: { kind: 'legacy' as const } } : {});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  trace.instances.mockClear();
  trace.factory.mockClear();
  trace.route.mockClear();
  trace.classify.mockClear();
});
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

async function runtime(
  env: Record<string, string> = {},
  fetcher = vi.fn<typeof fetch>(async () => Response.json(fixture.providerAccounts)),
) {
  return {
    ...(await bootstrap({ ...defaults, ...env }, { pattern, clock, fetch: fetcher })),
    fetcher,
  };
}
async function application(
  env: Record<string, string> = {},
  fetcher = vi.fn<typeof fetch>(async () => Response.json(fixture.providerAccounts)),
) {
  const log = vi.fn();
  const app = await createLegacyHttpApplication(
    { ...defaults, ...env },
    { pattern, clock, fetch: fetcher, onSecurityEvent: log },
  );
  closers.push(app.close);
  return { ...app, fetcher, log };
}
async function stdio(registry: Runtime, era: Era, name: string = era) {
  const input = new PassThrough();
  const output = new PassThrough();
  const errors = vi.fn();
  const handle = (era === 'legacy' ? runLegacyStdio : startModernStdio)(registry.createServer, {
    transport: new StdioServerTransport(input, output),
    onerror: errors,
  });
  const client = makeClient(name);
  const close = async () => {
    await client.close();
    await handle.close();
    input.destroy();
    output.destroy();
  };
  closers.push(close);
  await client.connect(new StdioServerTransport(output, input), prior(era));
  expect(client.getProtocolEra()).toBe(era);
  expect(client.getNegotiatedProtocolVersion()).toBe(
    era === 'legacy' ? fixture.legacyVersion : fixture.modernVersion,
  );
  return { client, close, errors };
}
async function listen(app: Awaited<ReturnType<typeof application>>) {
  const server = createServer(app.app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  closers.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  return new URL(`http://127.0.0.1:${address.port}/mcp`);
}
async function http(url: URL, era: Era, name: string = era) {
  const responses: Response[] = [];
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    fetch: async (input, init) => {
      // Even a redirect cannot turn these client tests into provider traffic.
      expect(new URL(input instanceof Request ? input.url : String(input)).origin).toBe(url.origin);
      const response = await fetch(input, { ...init, redirect: 'error' });
      responses.push(response);
      return response;
    },
  });
  const client = makeClient(name);
  closers.push(() => client.close());
  await client.connect(transport, prior(era));
  expect(client.getProtocolEra()).toBe(era);
  expect(client.getNegotiatedProtocolVersion()).toBe(
    era === 'legacy' ? fixture.legacyVersion : fixture.modernVersion,
  );
  return { client, transport, responses };
}
function envelope(method: string, params: Record<string, unknown> = {}) {
  return { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: fixture.meta } };
}
function post(app: Awaited<ReturnType<typeof application>>['app'], body: unknown) {
  return request(app)
    .post('/mcp')
    .set('Authorization', `Bearer ${bearer}`)
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .send(body);
}
function clean(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(bearer);
  expect(serialized).not.toContain(secret);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('official client v2, both eras and both transports', () => {
  it.each([{}, all])(
    'preserves catalogue, schemas, annotations and byte-identical text with %j',
    async (env) => {
      const app = await application({ ...env, MCP_TOOLS_TTL_MS: '1234' });
      const url = await listen(app);
      const sessions = await Promise.all([
        stdio(app, 'legacy'),
        stdio(app, 'modern'),
        http(url, 'legacy'),
        http(url, 'modern'),
      ]);
      const lists = await Promise.all(sessions.map(({ client }) => client.listTools()));
      for (const list of lists) {
        expect(names(list.tools)).toEqual(names(app.module.tools));
        expect(list.tools).toEqual(lists[0].tools);
      }
      for (const index of [1, 3])
        expect(lists[index]).toMatchObject({ ttlMs: 1234, cacheScope: 'private' });
      const results = await Promise.all(
        sessions.map(({ client }) => client.callTool(fixture.read)),
      );
      for (const result of results) {
        expect(result.structuredContent).toEqual(fixture.accounts);
        expect(result.content).toEqual([
          { type: 'text', text: JSON.stringify(fixture.accounts, null, 2) },
        ]);
        expect(Buffer.from(JSON.stringify(result.content))).toEqual(
          Buffer.from(JSON.stringify(results[0].content)),
        );
        clean(result);
      }
      expect(app.fetcher).toHaveBeenCalledTimes(sessions.length);
    },
  );

  it.each(['stdio', 'http'] as const)(
    'preserves the read-only refusal byte for byte over %s',
    async (transport) => {
      const app = await application({ INFOMANIAK_READ_ONLY: 'true' });
      const url = await listen(app);
      const sessions = await Promise.all(
        (['legacy', 'modern'] as const).map((era) =>
          transport === 'stdio' ? stdio(app, era) : http(url, era),
        ),
      );
      const results = await Promise.all(
        sessions.map(({ client }) => client.callTool(fixture.write)),
      );
      for (const result of results)
        expect(result).toMatchObject({
          isError: true,
          content: [{ type: 'text', text: `[POLICY_DENIED] read_only: ${fixture.write.name}` }],
          structuredContent: {
            error: { code: 'POLICY_DENIED', reason: 'read_only', tool: fixture.write.name },
          },
        });
      expect(results[0].content).toEqual(results[1].content);
      expect(results[0].structuredContent).toEqual(results[1].structuredContent);
      expect(app.fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { INFOMANIAK_ALLOW_RAW_API: 'true' },
    { INFOMANIAK_ALLOW_EXPERIMENTAL: 'true' },
    all,
  ])('keeps raw visibility and callability governed by both flags: %j', async (env) => {
    const app = await application({ ...env, INFOMANIAK_READ_ONLY: 'true' });
    const url = await listen(app);
    const clients = await Promise.all([http(url, 'legacy'), http(url, 'modern')]);
    const enabled =
      env.INFOMANIAK_ALLOW_EXPERIMENTAL === 'true' && env.INFOMANIAK_ALLOW_RAW_API === 'true';
    for (const { client } of clients) {
      const tools = await client.listTools();
      expect(names(tools.tools).includes('infomaniak_api_call')).toBe(enabled);
      for (const method of ['GET', 'POST']) {
        const call = client.callTool({
          name: 'infomaniak_api_call',
          arguments: { method, endpoint: '/1/test' },
        });
        if (!enabled) {
          // Eras may encode unknown tools as either an RPC error or an error result.
          const result = await call.catch((error: Error) => {
            expect(error.message).toMatch(/unknown tool|not found|does not exist/i);
            return { isError: true };
          });
          expect(result.isError).toBe(true);
        } else if (method === 'POST') {
          expect(await call).toMatchObject({
            isError: true,
            structuredContent: { error: { reason: 'read_only' } },
          });
        } else expect((await call).isError).toBeUndefined();
      }
    }
    expect(app.fetcher.mock.calls.length).toBe(enabled ? clients.length : 0);
  });
});

for (const transport of ['stdio', 'http'] as const) {
  describe(`${transport} client isolation`, () => {
    it.each([
      ['legacy', 'legacy'],
      ['modern', 'modern'],
      ['legacy', 'modern'],
    ] as const)(
      'isolates concurrent %s / %s clients and survives closing one',
      async (firstEra, secondEra) => {
        const arrived = deferred<void>();
        const releases = new Map<number, ReturnType<typeof deferred<Response>>>();
        const fetcher = vi.fn<typeof fetch>(async (input) => {
          const id = Number(new URL(String(input)).pathname.split('/').at(-1));
          const gate = deferred<Response>();
          releases.set(id, gate);
          if (releases.size === 2) arrived.resolve();
          return gate.promise;
        });
        const app = await application({}, fetcher);
        const url = await listen(app);
        const connect = (era: Era, name: string) =>
          transport === 'stdio' ? stdio(app, era, name) : http(url, era, name);
        const [a, b] = await Promise.all([
          connect(firstEra, 'client-a'),
          connect(secondEra, 'client-b'),
        ]);
        const before = new Set(instances());
        const calls = [
          a.client.callTool({ name: 'infomaniak_get_account', arguments: { account_id: 101 } }),
          b.client.callTool({ name: 'infomaniak_get_account', arguments: { account_id: 202 } }),
        ];
        const settled = Promise.allSettled(calls);
        closers.push(async () => {
          for (const [id, release] of releases)
            release.resolve(Response.json({ result: 'success', data: { id, name: 'cleanup' } }));
          await settled;
        });
        await arrived.promise;
        expect([...releases.keys()].sort()).toEqual([101, 202]);
        expect(new Set(instances()).size).toBe(instances().length);
        const active =
          transport === 'stdio' ? instances() : instances().filter((server) => !before.has(server));
        expect(active).toHaveLength(calls.length);
        // Legacy HTTP has no handshake state; modern stdio carries metadata per message.
        // Only legacy stdio and modern HTTP expose it through this SDK accessor.
        const exposedEra = transport === 'stdio' ? 'legacy' : 'modern';
        const expectedClients = [
          firstEra === exposedEra ? 'client-a' : undefined,
          secondEra === exposedEra ? 'client-b' : undefined,
        ];
        expect(active.map((server) => server.server.getClientVersion()?.name).sort()).toEqual(
          expectedClients.sort(),
        );
        // Complete B before A, while both calls are in flight with distinct input and output.
        releases
          .get(202)!
          .resolve(Response.json({ result: 'success', data: { id: 202, name: 'B' } }));
        expect((await calls[1]).structuredContent).toEqual({ account: { id: 202, name: 'B' } });
        releases
          .get(101)!
          .resolve(Response.json({ result: 'success', data: { id: 101, name: 'A' } }));
        expect((await calls[0]).structuredContent).toEqual({ account: { id: 101, name: 'A' } });
        const used = new Set(instances());
        await a.client.close();
        fetcher.mockImplementation(async () => Response.json(fixture.providerAccounts));
        expect((await b.client.callTool(fixture.read)).structuredContent).toEqual(fixture.accounts);
        if ('transport' in b) {
          const fresh = instances().filter((server) => !used.has(server));
          expect(fresh).toHaveLength(1);
          expect(b.transport.sessionId).toBeUndefined();
          for (const response of b.responses) {
            expect(response.headers.has('mcp-session-id')).toBe(false);
            expect(response.headers.has('last-event-id')).toBe(false);
          }
        }
      },
    );
  });
}

function doubles(headers: IncomingMessage['headers'] = {}) {
  const req = Object.assign(new PassThrough(), {
    method: 'POST',
    url: '/mcp',
    headers: {
      host: 'localhost',
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      ...headers,
    },
  });
  const res = Object.assign(new EventEmitter(), {
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    end: vi.fn(),
    write: vi.fn(() => true),
  });
  closers.push(async () => {
    req.destroy();
  });
  return {
    req,
    res,
    incoming: req as unknown as IncomingMessage,
    outgoing: res as unknown as ServerResponse,
  };
}
async function guarded() {
  const registry = await runtime();
  const factory = vi.fn(registry.createServer);
  const log = vi.fn();
  const handler = createLegacyHttpHandler(
    { ...registry, createServer: factory },
    { ...registry.config.http, maxBodyBytes: ENVELOPE_RESERVE, onSecurityEvent: log },
  );
  closers.push(handler.close);
  return { handler, factory, log, registry };
}

describe('HTTP admission precedes body parsing, era classification and MCP construction', () => {
  it.each([
    [
      'bearer',
      { authorization: 'Bearer wrong', host: 'bad.example', origin: 'https://bad.example' },
      401,
      'auth_rejected',
    ],
    ['host', { host: 'bad.example', origin: 'https://bad.example' }, 403, 'host_rejected'],
    ['origin', { origin: 'https://bad.example' }, 403, 'origin_rejected'],
    ['content type', { 'content-type': 'text/plain' }, 415, 'request_rejected'],
    ['missing content type', { 'content-type': undefined }, 415, 'request_rejected'],
    ['encoding', { 'content-encoding': 'gzip' }, 415, 'request_rejected'],
    ['session', { 'mcp-session-id': 'other-client' }, 400, 'request_rejected'],
    ['event', { 'last-event-id': 'other-client' }, 400, 'request_rejected'],
  ] as const)(
    'rejects %s before subscribing to data or invoking either factory',
    async (_label, headers, status, event) => {
      const { handler, factory, log, registry } = await guarded();
      const { req, res, incoming, outgoing } = doubles(headers);
      const on = vi.spyOn(req, 'on');
      await handler(incoming, outgoing);
      expect(res.writeHead.mock.calls[0][0]).toBe(status);
      expect(on.mock.calls.filter(([event]) => event === 'data')).toEqual([]);
      expect(req.readableEnded).toBe(false);
      expect(factory).not.toHaveBeenCalled();
      expect(trace.instances).not.toHaveBeenCalled();
      expect(trace.factory).not.toHaveBeenCalled();
      expect(trace.classify).not.toHaveBeenCalled();
      expect(trace.route).not.toHaveBeenCalled();
      expect(registry.fetcher).not.toHaveBeenCalled();
      expect(log.mock.calls).toEqual([[event]]);
      clean({ output: res.end.mock.calls, log: log.mock.calls });
    },
  );

  it.each([undefined, '1'])(
    'counts actual bytes and returns 413 before EOF, Content-Length=%s',
    async (length) => {
      const { handler, factory, log } = await guarded();
      const { req, res, incoming, outgoing } = doubles(length ? { 'content-length': length } : {});
      const on = vi.spyOn(req, 'on');
      const parse = vi.spyOn(JSON, 'parse');
      const pending = handler(incoming, outgoing);
      req.write(Buffer.alloc(ENVELOPE_RESERVE, ' '));
      req.write(Buffer.from('é'));
      await pending;
      expect(on.mock.calls.filter(([event]) => event === 'data')).toHaveLength(1);
      expect(req.readableEnded).toBe(false);
      expect(req.isPaused()).toBe(true);
      expect(res.writeHead.mock.calls[0][0]).toBe(413);
      expect(parse).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
      expect(trace.instances).not.toHaveBeenCalled();
      expect(trace.factory).not.toHaveBeenCalled();
      expect(trace.classify).not.toHaveBeenCalled();
      expect(trace.route).not.toHaveBeenCalled();
      clean({ output: res.end.mock.calls, log: log.mock.calls });
    },
  );

  it.each(['legacy', 'modern'] as const)(
    'accepts the exact UTF-8 bound in %s and rejects the next byte',
    async (era) => {
      const app = await application({ MCP_HTTP_BODY_LIMIT: String(ENVELOPE_RESERVE) });
      const params = { ...fixture.read, extra: 'é' };
      const body =
        era === 'legacy'
          ? { jsonrpc: '2.0', id: 1, method: 'tools/call', params }
          : envelope('tools/call', params);
      const serialized = JSON.stringify(body);
      const padding = ENVELOPE_RESERVE - Buffer.byteLength(serialized);
      const exact = serialized + ' '.repeat(padding);
      expect(Buffer.byteLength(exact)).toBe(ENVELOPE_RESERVE);
      expect(exact.length).toBeLessThan(ENVELOPE_RESERVE);
      const result = await post(app.app, exact)
        .set('Mcp-Method', 'tools/call')
        .set('Mcp-Name', fixture.read.name);
      expect(result.status).toBe(200);
      expect(app.fetcher).toHaveBeenCalledTimes(1);
      trace.instances.mockClear();
      trace.factory.mockClear();
      trace.classify.mockClear();
      trace.route.mockClear();
      app.fetcher.mockClear();
      const rejected = await post(app.app, exact + ' ');
      expect(rejected.status).toBe(413);
      expect(trace.instances).not.toHaveBeenCalled();
      expect(trace.factory).not.toHaveBeenCalled();
      expect(trace.classify).not.toHaveBeenCalled();
      expect(app.fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(['legacy', 'modern'] as const)(
    'reads the stream once for a successful %s invocation',
    async (era) => {
      const { handler, registry } = await guarded();
      const { req, res, incoming, outgoing } = doubles({
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json; charset=utf-8',
        'mcp-method': 'tools/call',
        'mcp-name': fixture.read.name,
      });
      const on = vi.spyOn(req, 'on');
      const pending = handler(incoming, outgoing);
      req.end(
        JSON.stringify(
          era === 'legacy'
            ? { jsonrpc: '2.0', id: 1, method: 'tools/call', params: fixture.read }
            : envelope('tools/call', fixture.read),
        ),
      );
      await pending;
      expect(res.writeHead.mock.calls[0][0]).toBe(200);
      expect(on.mock.calls.filter(([event]) => event === 'data')).toHaveLength(1);
      expect(trace.classify).toHaveBeenCalledTimes(1);
      expect(trace.route.mock.calls).toEqual([[era === 'legacy' ? 'stateless' : 'reject']]);
      expect(trace.instances).toHaveBeenCalledTimes(1);
      expect(registry.fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['{invalid', 'null', '['])(
    'rejects or classifies bounded JSON %s without rereading the incoming stream',
    async (body) => {
      const { handler, factory } = await guarded();
      const { req, res, incoming, outgoing } = doubles();
      const on = vi.spyOn(req, 'on');
      const pending = handler(incoming, outgoing);
      req.end(body);
      await pending;
      expect(on.mock.calls.filter(([event]) => event === 'data')).toHaveLength(1);
      expect(res.writeHead.mock.calls[0][0]).toBe(400);
      if (body !== 'null') {
        expect(factory).not.toHaveBeenCalled();
        expect(trace.classify).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['get', 'delete', 'put', 'options'] as const)(
    'returns 405 for %s without an instance or session',
    async (method) => {
      const app = await application();
      const response = await request(app.app)
        [method]('/mcp')
        .set('Authorization', `Bearer ${bearer}`);
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe('POST');
      expect(response.headers['mcp-session-id']).toBeUndefined();
      expect(trace.instances).not.toHaveBeenCalled();
      expect(trace.factory).not.toHaveBeenCalled();
    },
  );
});

describe('explicit SDK era boundary', () => {
  it('sends initialize only to the stateless leg and modern discovery only to the strict leg', async () => {
    const app = await application();
    expect((await post(app.app, fixture.initialize)).status).toBe(200);
    expect(trace.route.mock.calls).toEqual([['stateless']]);
    trace.route.mockClear();
    const response = await post(app.app, envelope('server/discover')).set(
      'Mcp-Method',
      'server/discover',
    );
    expect(response.status).toBe(200);
    expect(trace.route.mock.calls).toEqual([['reject']]);
  });

  it.each([
    [
      'malformed envelope',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': fixture.modernVersion } },
      },
      {},
      -32602,
    ],
    [
      'modern header without envelope',
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      { 'MCP-Protocol-Version': fixture.modernVersion },
      -32602,
    ],
    [
      'header/body mismatch',
      envelope('tools/list'),
      { 'MCP-Protocol-Version': fixture.legacyVersion },
      -32020,
    ],
  ])('sends %s to the modern validation ladder', async (_label, body, headers, code) => {
    const app = await application();
    const response = await post(app.app, body).set(headers).set('Mcp-Method', 'tools/list');
    expect(response.body.error.code).toBe(code);
    expect(trace.route.mock.calls).toEqual([['reject']]);
    expect(app.fetcher).not.toHaveBeenCalled();
  });

  it.each(['legacy', 'modern'] as const)('redacts provider failures in %s', async (era) => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error(secret);
    });
    const app = await application({}, fetcher);
    const { client } = await http(await listen(app), era);
    const result = await client.callTool(fixture.read);
    expect(result.isError).toBe(true);
    clean({ result, log: app.log.mock.calls });
  });
});

describe('explicit compiled legacy entry', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
  });
  it('negotiates 2025 on real stdio without provider calls or an era environment switch', async () => {
    const registry = await runtime();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../../build/main/legacy.js', import.meta.url))],
      cwd: '/tmp',
      env: defaults,
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const client = makeClient('compiled-legacy');
    closers.push(() => client.close());
    await client.connect(transport, prior('legacy'));
    expect(client.getProtocolEra()).toBe('legacy');
    expect(names((await client.listTools()).tools)).toEqual(names(registry.module.tools));
    expect(stderr).toBe('');
    expect(registry.fetcher).not.toHaveBeenCalled();
  });
});
