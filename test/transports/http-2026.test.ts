import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpApplication } from '../../src/main/http.js';
import { bootstrap } from '../../src/main/bootstrap.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createModernHttpHandler } from '../../src/adapters/inbound/http/modern-http.js';
import {
  BODY_LIMIT,
  DOWNLOAD_LIMIT,
  UPLOAD_LIMIT,
  ENVELOPE_RESERVE,
} from '../../src/application/drive/transfer.feature.js';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/mcp-2026-http.json', import.meta.url), 'utf8'),
);
const bearer = 'CONFIGURED_BEARER_SENTINEL';
const providerSecret = 'PROVIDER_RESPONSE_SENTINEL';
const stackSecret = 'INTERNAL_STACK_SENTINEL';
const allowedHost = 'configured-host-sentinel.example';
const allowedOrigin = 'https://configured-origin-sentinel.example';
const defaults = { INFOMANIAK_API_TOKEN: 'provider-token-fixture', MCP_HTTP_AUTH_TOKEN: bearer };
const pattern = fileURLToPath(new URL('../../src/features/**/*.feature.ts', import.meta.url));
const all = {
  KCHAT_HOST: 'chat.example.test',
  KCHAT_TOKEN: 'chat-token-fixture',
  INFOMANIAK_ALLOW_EXPERIMENTAL: 'true',
  INFOMANIAK_ALLOW_RAW_API: 'true',
};
const clock = { now: () => 0, wait: vi.fn(async () => {}) };
const closers: (() => Promise<void>)[] = [];
let warnings: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  vi.restoreAllMocks();
  clock.wait.mockClear();
});

function envelope(method: string, params: Record<string, unknown> = {}) {
  return { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: fixture.meta } };
}
async function application(
  env: Record<string, string> = {},
  fetcher = vi.fn<typeof fetch>(async () => Response.json(fixture.providerAccounts)),
) {
  const log = vi.fn();
  const runtime = await createHttpApplication(
    { ...defaults, ...env },
    { pattern, fetch: fetcher, clock, random: () => 0, onSecurityEvent: log },
  );
  closers.push(runtime.close);
  return { ...runtime, log, fetcher };
}
function rpc(
  runtime: Awaited<ReturnType<typeof application>>,
  method: string,
  params: Record<string, unknown> = {},
) {
  const call = request(runtime.app)
    .post('/mcp')
    .set('Authorization', `Bearer ${bearer}`)
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .set('Mcp-Method', method);
  if (typeof params.name === 'string') call.set('Mcp-Name', params.name);
  return call.send(envelope(method, params));
}
function clean(response: { text: string; headers: object }, logs: unknown) {
  const output = JSON.stringify({ text: response.text, headers: response.headers, logs });
  for (const secret of [bearer, providerSecret, stackSecret, allowedHost, allowedOrigin])
    expect(output).not.toContain(secret);
}
function noSession(response: { headers: Record<string, string> }) {
  expect(response.headers['mcp-session-id']).toBeUndefined();
  expect(response.headers['last-event-id']).toBeUndefined();
  expect(response.headers['content-type']).not.toContain('text/event-stream');
}

describe('modern Node HTTP transport', () => {
  it.each([{}, all])(
    'discovers and lists the same catalogue as the common factory with %j',
    async (env) => {
      const runtime = await application(env);
      const discover = await rpc(runtime, 'server/discover');
      expect(discover.status).toBe(200);
      expect(discover.body.result._meta).toMatchObject({
        'io.modelcontextprotocol/serverInfo': fixture.serverInfo,
      });
      expect(discover.headers['content-type']).toContain('application/json');
      noSession(discover);
      const listed = await rpc(runtime, 'tools/list');
      expect(listed.status).toBe(200);
      expect(listed.body.result).toMatchObject({ ttlMs: 60000, cacheScope: 'private' });
      expect(listed.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
        runtime.module.tools.map((tool) => tool.name),
      );
      noSession(listed);
      expect(runtime.fetcher).not.toHaveBeenCalled();
      expect(runtime.log).not.toHaveBeenCalled();
      expect(warnings).toHaveBeenCalledWith(
        expect.stringContaining("responseMode: 'json' drops mid-call notifications"),
      );
    },
  );

  it('uses the captured TTL and emits validated text, structured result and metadata', async () => {
    const runtime = await application({ MCP_TOOLS_TTL_MS: '1234' });
    const listed = await rpc(runtime, 'tools/list');
    expect(listed.body.result).toMatchObject({ ttlMs: 1234, cacheScope: 'private' });
    const result = await rpc(runtime, 'tools/call', {
      name: 'infomaniak_list_accounts',
      arguments: {},
    });
    expect(result.status).toBe(200);
    expect(result.body.result).toMatchObject({
      structuredContent: fixture.accounts,
      resultType: 'complete',
      _meta: { 'io.modelcontextprotocol/serverInfo': fixture.serverInfo },
      content: [{ type: 'text', text: JSON.stringify(fixture.accounts, null, 2) }],
    });
    expect(runtime.fetcher).toHaveBeenCalledTimes(1);
    noSession(result);
    clean(result, runtime.log.mock.calls);
  });

  it.each(['', 'Bearer wrong', 'Basic invalid', `Bearer ${bearer}x`, 'Bearer x'])(
    'returns 401 before provider invocation for %j',
    async (authorization) => {
      const runtime = await application();
      const response = await request(runtime.app)
        .post('/mcp')
        .set('Authorization', authorization)
        .send({ sensitive: providerSecret });
      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(runtime.fetcher).not.toHaveBeenCalled();
      expect(runtime.log.mock.calls).toEqual([['auth_rejected']]);
      clean(response, runtime.log.mock.calls);
    },
  );

  it.each(['Host', 'Origin'])(
    'returns the official %s 403 without disclosing allowed configuration',
    async (header) => {
      const runtime = await application({
        MCP_ALLOWED_HOSTS: `127.0.0.1,${allowedHost}`,
        MCP_CORS_ORIGINS: allowedOrigin,
      });
      const response = await rpc(runtime, 'tools/call', {
        name: 'infomaniak_list_accounts',
        arguments: {},
      }).set(header, header === 'Host' ? 'rejected.example' : 'https://rejected.example');
      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('rejected.example');
      expect(runtime.fetcher).not.toHaveBeenCalled();
      expect(runtime.log.mock.calls).toEqual([[`${header.toLowerCase()}_rejected`]]);
      clean(response, runtime.log.mock.calls);
    },
  );

  it('accepts the configured Origin and Host with CORS, without credentials', async () => {
    const runtime = await application({
      MCP_ALLOWED_HOSTS: 'localhost',
      MCP_CORS_ORIGINS: 'https://client.example',
    });
    const response = await rpc(runtime, 'server/discover')
      .set('Host', 'localhost:3000')
      .set('Origin', 'https://client.example');
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://client.example');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it.each(['get', 'delete', 'put', 'options'] as const)(
    'refuses %s, including GET SSE, with POST as the only method',
    async (method) => {
      const runtime = await application();
      const response = await request(runtime.app)
        [method]('/mcp')
        .set('Authorization', `Bearer ${bearer}`)
        .set('Accept', 'text/event-stream');
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe('POST');
      noSession(response);
      expect(runtime.fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(['Mcp-Session-Id', 'Last-Event-ID'])('rejects forbidden inbound %s', async (header) => {
    const runtime = await application();
    const response = await rpc(runtime, 'server/discover').set(header, 'arbitrary');
    expect(response.status).toBe(400);
    noSession(response);
    expect(runtime.fetcher).not.toHaveBeenCalled();
  });

  it('rejects legacy traffic instead of creating a session', async () => {
    const runtime = await application();
    const response = await request(runtime.app)
      .post('/mcp')
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'fixture', version: '1' },
        },
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    noSession(response);
    expect(runtime.fetcher).not.toHaveBeenCalled();
  });

  it('admits the exact UTF-8 body limit and rejects the next byte before invocation', async () => {
    const limit = ENVELOPE_RESERVE + 256;
    const runtime = await application({ MCP_HTTP_BODY_LIMIT: String(limit) });
    const body = envelope('tools/call', {
      name: 'infomaniak_list_accounts',
      arguments: {},
      extra: '',
    });
    const padding = limit - Buffer.byteLength(JSON.stringify(body));
    body.params.extra = 'é'.repeat(Math.floor(padding / 2)) + 'x'.repeat(padding % 2);
    const serialized = JSON.stringify(body);
    expect(Buffer.byteLength(serialized)).toBe(limit);
    const send = (text: string) =>
      request(runtime.app)
        .post('/mcp')
        .set('Authorization', `Bearer ${bearer}`)
        .set('Content-Type', 'application/json')
        .set('Mcp-Method', 'tools/call')
        .set('Mcp-Name', 'infomaniak_list_accounts')
        .send(text);
    expect((await send(serialized)).status).toBe(200);
    runtime.fetcher.mockClear();
    const rejected = await send(`${serialized} `);
    expect(rejected.status).toBe(413);
    expect(runtime.fetcher).not.toHaveBeenCalled();
    clean(rejected, runtime.log.mock.calls);
  });

  it.each(['{invalid', '{"sensitive":"PROVIDER_RESPONSE_SENTINEL"'])(
    'redacts malformed JSON %s',
    async (body) => {
      const runtime = await application();
      const result = await request(runtime.app)
        .post('/mcp')
        .set('Authorization', `Bearer ${bearer}`)
        .set('Content-Type', 'application/json')
        .send(body);
      expect(result.status).toBe(400);
      expect(runtime.fetcher).not.toHaveBeenCalled();
      clean(result, runtime.log.mock.calls);
    },
  );

  it('refuses compressed bodies without invoking the application', async () => {
    const runtime = await application();
    const result = await rpc(runtime, 'server/discover').set('Content-Encoding', 'gzip');
    expect(result.status).toBe(415);
    expect(runtime.fetcher).not.toHaveBeenCalled();
  });

  it('applies effective FEAT-03 base64 admission after HTTP body admission', async () => {
    const runtime = await application({ MCP_HTTP_BODY_LIMIT: String(ENVELOPE_RESERVE + 128) });
    const result = await rpc(runtime, 'tools/call', {
      name: 'infomaniak_upload_kdrive_file',
      arguments: { drive_id: 9, file_name: 'x', base64_content: 'AAAA'.repeat(33) },
    });
    expect(result.status).toBe(200);
    expect(result.body.result.isError).toBe(true);
    expect(runtime.fetcher).not.toHaveBeenCalled();
  });

  it.each(['status', 'json', 'throw', 'oversized'] as const)(
    'redacts provider %s failures in response and logs',
    async (kind) => {
      const cancellation = vi.fn();
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (kind === 'throw') {
          const error = new Error(providerSecret);
          error.stack = stackSecret;
          throw error;
        }
        if (kind === 'status') return new Response(providerSecret, { status: 400 });
        if (kind === 'json') return new Response(providerSecret);
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(BODY_LIMIT + 1));
            },
            cancel: cancellation,
          }),
          { headers: { 'Content-Length': '1' } },
        );
      });
      const runtime = await application({}, fetcher);
      const result = await rpc(runtime, 'tools/call', {
        name: 'infomaniak_list_accounts',
        arguments: {},
      });
      expect(result.status).toBe(200);
      expect(result.body.result.isError).toBe(true);
      clean(result, runtime.log.mock.calls);
      if (kind === 'oversized') expect(cancellation).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps visibility and read-only policy independent of HTTP', async () => {
    const normal = await application();
    const readonly = await application({ INFOMANIAK_READ_ONLY: 'true' });
    const names = (runtime: typeof normal) => runtime.module.tools.map((tool) => tool.name);
    expect(names(readonly)).toEqual(names(normal));
    expect(names(normal)).not.toContain('infomaniak_api_call');
    const hidden = await rpc(normal, 'tools/call', {
      name: 'infomaniak_api_call',
      arguments: { method: 'GET', path: '/1' },
    });
    expect(hidden.body.result?.isError === true || hidden.body.error !== undefined).toBe(true);
    const name = 'infomaniak_delete_dns_record';
    const denied = await rpc(readonly, 'tools/call', {
      name,
      arguments: { domain: 'example.test', record_id: 1 },
    });
    expect(denied.body.result).toMatchObject({
      isError: true,
      resultType: 'complete',
      structuredContent: { error: { code: 'POLICY_DENIED', reason: 'read_only', tool: name } },
      content: [{ type: 'text', text: `[POLICY_DENIED] read_only: ${name}` }],
    });
    expect(normal.fetcher).not.toHaveBeenCalled();
    expect(readonly.fetcher).not.toHaveBeenCalled();
  });

  it.each(['POST', 'DELETE', 'PATCH'])(
    'enforces readOnly on raw %s even when visible',
    async (method) => {
      const runtime = await application({ ...all, INFOMANIAK_READ_ONLY: 'true' });
      const name = 'infomaniak_api_call';
      expect(runtime.module.tools.map((tool) => tool.name)).toContain(name);
      const result = await rpc(runtime, 'tools/call', {
        name,
        arguments: { method, endpoint: '/1/test' },
      });
      expect(result.body.result).toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'POLICY_DENIED', reason: 'read_only', tool: name } },
      });
      expect(runtime.fetcher).not.toHaveBeenCalled();
    },
  );

  it('allows raw GET in read-only mode when both enabling flags are present', async () => {
    const runtime = await application({ ...all, INFOMANIAK_READ_ONLY: 'true' });
    const result = await rpc(runtime, 'tools/call', {
      name: 'infomaniak_api_call',
      arguments: { method: 'GET', endpoint: '/1/test' },
    });
    expect(result.body.result.isError).toBeUndefined();
    expect(result.body.result.structuredContent).toMatchObject({
      method: 'GET',
      endpoint: '/1/test',
      status: 200,
    });
    expect(runtime.fetcher).toHaveBeenCalledTimes(1);
  });
});

function doubles(headers: IncomingMessage['headers']) {
  const req = Object.assign(new PassThrough(), { headers, method: 'POST', url: '/mcp' });
  const res = Object.assign(new EventEmitter(), {
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    end: vi.fn(),
    write: vi.fn(() => true),
  });
  return {
    req,
    res,
    incoming: req as unknown as IncomingMessage,
    outgoing: res as unknown as ServerResponse,
  };
}
describe('admission before stream consumption', () => {
  it.each(['auth', 'host', 'origin'])(
    'rejects %s without reading or creating an MCP server',
    async (kind) => {
      const server = vi.fn(() => {
        throw new Error(stackSecret);
      });
      const log = vi.fn();
      const handler = createModernHttpHandler({
        server,
        ...loadRuntimeConfig(defaults).http,
        onSecurityEvent: log,
      });
      closers.push(handler.close);
      const { incoming, outgoing, req, res } = doubles({
        host: kind === 'host' ? 'rejected.example' : 'localhost',
        authorization: kind === 'auth' ? 'Bearer wrong' : `Bearer ${bearer}`,
        ...(kind === 'origin' ? { origin: 'https://rejected.example' } : {}),
      });
      const on = vi.spyOn(req, 'on');
      await handler(incoming, outgoing);
      expect(res.writeHead.mock.calls[0][0]).toBe(kind === 'auth' ? 401 : 403);
      expect(on.mock.calls.some(([event]) => event === 'data')).toBe(false);
      expect(server).not.toHaveBeenCalled();
      req.destroy();
    },
  );

  it.each([undefined, '1'])('returns 413 before EOF with Content-Length=%s', async (length) => {
    const server = vi.fn(() => {
      throw new Error(stackSecret);
    });
    const handler = createModernHttpHandler({
      server,
      ...loadRuntimeConfig(defaults).http,
      maxBodyBytes: ENVELOPE_RESERVE,
      onSecurityEvent: vi.fn(),
    });
    closers.push(handler.close);
    const { incoming, outgoing, req, res } = doubles({
      host: 'localhost',
      authorization: `Bearer ${bearer}`,
      ...(length ? { 'content-length': length } : {}),
    });
    const pending = handler(incoming, outgoing);
    req.write(Buffer.alloc(ENVELOPE_RESERVE));
    req.write(Buffer.from('é'));
    await pending;
    expect(req.readableEnded).toBe(false);
    expect(res.writeHead.mock.calls[0][0]).toBe(413);
    expect(server).not.toHaveBeenCalled();
    req.destroy();
  });

  it('redacts a factory stack error via the injected callback', async () => {
    const server = vi.fn(() => {
      const error = new Error(providerSecret);
      error.stack = stackSecret;
      throw error;
    });
    const log = vi.fn();
    const handler = createModernHttpHandler({
      server,
      ...loadRuntimeConfig(defaults).http,
      onSecurityEvent: log,
    });
    closers.push(handler.close);
    const { incoming, outgoing, req, res } = doubles({
      host: 'localhost',
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'mcp-method': 'server/discover',
    });
    const pending = handler(incoming, outgoing);
    req.end(JSON.stringify(envelope('server/discover')));
    await pending;
    expect(res.writeHead.mock.calls[0][0]).toBe(500);
    expect(log.mock.calls).toEqual([['internal_error']]);
    const output = JSON.stringify({
      writes: res.write.mock.calls.map(([data]) => Buffer.from(data).toString()),
      logs: log.mock.calls,
    });
    expect(output).not.toContain(providerSecret);
    expect(output).not.toContain(stackSecret);
    expect(output).not.toContain(bearer);
  });

  it('logs to stderr by default and never to stdout', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const handler = createModernHttpHandler({
      server: vi.fn(),
      ...loadRuntimeConfig(defaults).http,
    });
    closers.push(handler.close);
    const { incoming, outgoing, req } = doubles({ host: 'localhost' });
    await handler(incoming, outgoing);
    expect(stderr).toHaveBeenCalledWith('HTTP security: auth_rejected\n');
    expect(stdout).not.toHaveBeenCalled();
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(bearer);
    req.destroy();
  });
});

describe('captured HTTP and transfer configuration', () => {
  it('preserves baseline defaults, PORT fallback and typed FEAT-03 limits', () => {
    const config = loadRuntimeConfig(defaults);
    expect(config.http).toMatchObject({
      host: '127.0.0.1',
      port: 3000,
      maxBodyBytes: BODY_LIMIT,
      allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
      allowedOrigins: [],
    });
    expect(config.transfer).toEqual({
      downloadLimit: DOWNLOAD_LIMIT,
      uploadLimit: UPLOAD_LIMIT,
      bodyLimit: BODY_LIMIT,
    });
    expect(loadRuntimeConfig({ ...defaults, PORT: '4567' }).http.port).toBe(4567);
    expect(loadRuntimeConfig({ ...defaults, PORT: '4567', MCP_PORT: '5678' }).http.port).toBe(5678);
    expect(loadRuntimeConfig({ ...defaults, MCP_HTTP_BODY_LIMIT: '20mb' }).http.maxBodyBytes).toBe(
      BODY_LIMIT,
    );
  });

  it.each([
    ['MCP_PORT', '0'],
    ['MCP_PORT', '65536'],
    ['MCP_PORT', '3000secret'],
    ['PORT', '1.5'],
    ['MCP_HOST', 'bad/host'],
    ['MCP_HTTP_AUTH_TOKEN', 'short'],
    ['MCP_HTTP_ALLOW_UNAUTHENTICATED', 'maybe'],
    ['MCP_ALLOWED_HOSTS', '*'],
    ['MCP_ALLOWED_HOSTS', 'localhost,'],
    ['MCP_CORS_ORIGINS', '*'],
    ['MCP_CORS_ORIGINS', 'https://example.test/path'],
    ['MCP_HTTP_BODY_LIMIT', '20mb-secret'],
    ['MCP_HTTP_BODY_LIMIT', '1'],
    ['KDRIVE_MAX_DOWNLOAD_BYTES', '-1'],
    ['KDRIVE_MAX_UPLOAD_BYTES', '1.1'],
    ['KDRIVE_MAX_UPLOAD_BYTES', '9007199254740992'],
  ])('rejects invalid %s without its value', (key, value) => {
    expect(() => loadRuntimeConfig({ ...defaults, [key]: value })).toThrow(
      `Invalid runtime configuration: ${key}`,
    );
    try {
      loadRuntimeConfig({ ...defaults, [key]: value });
    } catch (error) {
      expect((error as Error).message).not.toContain(bearer);
      expect((error as Error).message).not.toContain(value);
    }
  });

  it.each(['0.0.0.0', '::', 'public.example'])(
    'refuses unauthenticated public bind %s even with the exception',
    async (host) => {
      await expect(
        application({
          MCP_HTTP_AUTH_TOKEN: '',
          MCP_HOST: host,
          MCP_HTTP_ALLOW_UNAUTHENTICATED: 'true',
        }),
      ).rejects.toThrow('HTTP transport requires MCP_HTTP_AUTH_TOKEN');
    },
  );

  it('requires explicit loopback exception while leaving stdio token-independent', async () => {
    await expect(application({ MCP_HTTP_AUTH_TOKEN: '' })).rejects.toThrow(
      'HTTP transport requires MCP_HTTP_AUTH_TOKEN',
    );
    const runtime = await application({
      MCP_HTTP_AUTH_TOKEN: '',
      MCP_HTTP_ALLOW_UNAUTHENTICATED: 'true',
    });
    const result = await request(runtime.app)
      .post('/mcp')
      .set('Mcp-Method', 'server/discover')
      .send(envelope('server/discover'));
    expect(result.status).toBe(200);
    const stdio = await bootstrap(
      { INFOMANIAK_API_TOKEN: 'fixture' },
      { pattern, fetch: vi.fn(), clock },
    );
    expect(stdio.module.tools.map((tool) => tool.name)).toEqual(
      runtime.module.tools.map((tool) => tool.name),
    );
  });

  it('captures environment once for HTTP and all provider gateways', async () => {
    const reads = new Map<string, number>();
    const env = new Proxy(
      {
        ...defaults,
        ...all,
        KDRIVE_MAX_DOWNLOAD_BYTES: '3',
        KDRIVE_MAX_UPLOAD_BYTES: '256',
        MCP_HTTP_BODY_LIMIT: String(ENVELOPE_RESERVE + 256),
      },
      {
        get(target, key: string) {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return target[key as keyof typeof target];
        },
      },
    );
    const fetcher = vi.fn<typeof fetch>(async () => Response.json([]));
    const runtime = await createHttpApplication(env, {
      pattern,
      fetch: fetcher,
      clock,
      onSecurityEvent: vi.fn(),
    });
    closers.push(runtime.close);
    const before = [...reads.entries()];
    env.MCP_HTTP_AUTH_TOKEN = 'changed';
    env.KDRIVE_MAX_DOWNLOAD_BYTES = '100';
    await runtime.module.invoke('infomaniak_kchat_list_teams', {}, runtime.config.policy);
    expect(fetcher.mock.calls[0][1]?.headers).toHaveProperty(
      'Authorization',
      'Bearer chat-token-fixture',
    );
    expect(runtime.config.http.auth.token).toBe(bearer);
    expect(runtime.config.transfer.downloadLimit).toBe(3);
    expect([...reads.entries()]).toEqual(before);
    for (const key of ['MCP_HTTP_AUTH_TOKEN', 'MCP_HTTP_BODY_LIMIT', 'KDRIVE_MAX_DOWNLOAD_BYTES'])
      expect(reads.get(key)).toBe(1);
    expect(Object.isFrozen(runtime.config.http)).toBe(true);
    expect(Object.isFrozen(runtime.config.transfer)).toBe(true);
  });

  it.each(['infomaniak_list_accounts', 'infomaniak_kchat_list_teams'])(
    'bounds %s through bootstrap without the HTTP entrypoint',
    async (name) => {
      const cancel = vi.fn();
      const fetcher = vi.fn<typeof fetch>(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(BODY_LIMIT + 1));
              },
              cancel,
            }),
            { headers: { 'Content-Length': '1' } },
          ),
      );
      const runtime = await bootstrap({ ...defaults, ...all }, { pattern, fetch: fetcher, clock });
      await expect(runtime.module.invoke(name, {}, runtime.config.policy)).rejects.toThrow(
        'Invalid Infomaniak response',
      );
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(clock.wait).not.toHaveBeenCalled();
    },
  );
});
