import { describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { createFeatureModule } from '../../src/application/feature-module.js';
import { createEventContract } from '../../src/application/calendar/create-event.js';
import { listDrivesContract } from '../../src/application/drive/list-drives.js';
import { createModernServer } from '../../src/adapters/inbound/mcp/modern-server.js';
import { DriveListAdapter } from '../../src/adapters/outbound/infomaniak/drive-list.adapter.js';
import { CalendarCreateAdapter } from '../../src/adapters/outbound/infomaniak/calendar-create.adapter.js';
import * as driveFeature from '../fixtures/features/positive/a-drive.feature.js';
import * as calendarFeature from '../fixtures/features/positive/z-calendar.feature.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';
import {
  composeFeatureModules,
  discoverFeatureModules,
} from '../../src/main/discover-feature-modules.js';
import * as feature from '../fixtures/features/added/original.feature.js';
import { readdirSync } from 'node:fs';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createRuntime } from '../../src/main/index.js';

const policy = { readOnly: false, allowRawApi: false, allowExperimental: false };
const command = {
  title: 'Meeting',
  start: '2026-09-04T10:00:00Z',
  end: '2026-09-04T11:00:00Z',
  calendar_id: '7',
  timezone: 'Europe/Zurich',
  attendees: ['guest@example.test'],
};
const eventResponse = {
  data: {
    title: 'Meeting',
    id: 42,
    calendar_id: '7',
    start: '2026-09-04 12:00:00',
    end: '2026-09-04 13:00:00',
    location: 'Room',
  },
  result: 'success',
};
const positivePattern = 'test/fixtures/features/positive/**/*.feature.ts';
const idleClock = {
  now: () => 0,
  wait: async () => {
    throw new Error('Unexpected wait');
  },
};
const dependencies = (
  fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ result: 'success', data: [] })),
) => {
  const config = loadRuntimeConfig({ INFOMANIAK_API_TOKEN: 'test' });
  const bucket = new TokenBucket(idleClock);
  const createGateway = ({ token, base }: { token: string; base?: string }) =>
    new InfomaniakGateway({
      token,
      base,
      timeoutMs: 1000,
      bucket,
      fetch: fetcher,
      clock: idleClock,
      random: () => 0,
      utcNow: () => 0,
    });
  return {
    config,
    clock: idleClock,
    createGateway,
    gateway: createGateway({ token: config.token }),
    fetcher,
  };
};

async function rpc(
  server: ReturnType<typeof createModernServer>,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await server.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Method': method,
        ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: { [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_CAPABILITIES_META_KEY]: {} },
        },
      }),
    }),
  );
  expect(response.headers.get('mcp-session-id')).toBeNull();
  const body = await response.json();
  expect(body.error, JSON.stringify(body)).toBeUndefined();
  return body.result;
}

describe('walking skeleton', () => {
  it('discovers and calls both products through the official client with in-process fetch', async () => {
    const driveCall = vi.spyOn(DriveListAdapter.prototype, 'listDrives');
    const calendarCall = vi.spyOn(CalendarCreateAdapter.prototype, 'createEvent');
    const driveResponse = {
      result: 'success',
      data: [{ id: 9, name: 'Équipe', account_id: 123, size_used: 12, size: 1000 }],
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      switch (String(url)) {
        case 'https://api.infomaniak.com/2/drive?account_id=123':
          return Response.json(driveResponse);
        case 'https://api.infomaniak.com/2/profile':
          return Response.json({ result: 'success', data: { email: 'owner@example.test' } });
        case 'https://api.infomaniak.com/1/calendar/pim/event':
          return Response.json(eventResponse);
        default:
          throw new Error(`Unexpected request: ${url}`);
      }
    });
    const server = await createRuntime(
      { INFOMANIAK_API_TOKEN: 'test' },
      {
        fetch: fetcher,
        clock: {
          now: () => 0,
          wait: async () => {
            throw new Error('Unexpected wait');
          },
        },
        pattern: positivePattern,
      },
    );
    const requests: { method: string; params?: { name?: string } }[] = [];
    const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      fetch: async (url, init) => {
        const request = new Request(url, init);
        expect(request.method).toBe('POST');
        expect(request.headers.get('mcp-session-id')).toBeNull();
        const message = await request.clone().json();
        expect(message.params._meta[PROTOCOL_VERSION_META_KEY]).toBe('2026-07-28');
        requests.push(message);
        const response = await server.fetch(request);
        expect(response.headers.get('mcp-session-id')).toBeNull();
        if (message.method === 'tools/call') {
          // The official client unwraps the modern result envelope before returning CallToolResult.
          const body = await response.clone().json();
          expect(body.result.resultType).toBe('complete');
        }
        return response;
      },
    });
    const client = new Client(
      { name: 'walking-skeleton-test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe('modern');
      expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
      const discover = await client.discover();
      expect(discover).toHaveProperty('_meta');
      const list = await client.listTools();
      expect(list.tools.map((tool) => tool.name)).toEqual([
        createEventContract.name,
        listDrivesContract.name,
      ]);
      for (const tool of list.tools) {
        expect(tool.outputSchema).toMatchObject({ type: 'object' });
        expect(tool._meta).toHaveProperty('classification');
      }
      const meta = {
        'io.modelcontextprotocol/serverInfo': { name: 'infomaniak-mcp-server', version: '1.1.0' },
      };
      expect(
        await client.callTool({ name: listDrivesContract.name, arguments: { account_id: 123 } }),
      ).toEqual({
        content: [{ type: 'text', text: JSON.stringify(driveResponse, null, 2) }],
        structuredContent: {
          drives: [{ id: 9, name: 'Équipe', accountId: 123, usedBytes: 12, capacityBytes: 1000 }],
          displayText: JSON.stringify(driveResponse, null, 2),
        },
        _meta: meta,
      });
      expect(await client.callTool({ name: createEventContract.name, arguments: command })).toEqual(
        {
          content: [{ type: 'text', text: JSON.stringify(eventResponse, null, 2) }],
          structuredContent: {
            event: {
              id: 42,
              calendarId: '7',
              title: 'Meeting',
              start: eventResponse.data.start,
              end: eventResponse.data.end,
            },
            displayText: JSON.stringify(eventResponse, null, 2),
          },
          _meta: meta,
        },
      );
      expect(requests[0].method).toBe('server/discover');
      expect(
        requests
          .filter((request) => request.method === 'tools/call')
          .map((request) => request.params?.name),
      ).toEqual([listDrivesContract.name, createEventContract.name]);
      expect(
        requests.every((request) =>
          ['server/discover', 'tools/list', 'tools/call'].includes(request.method),
        ),
      ).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(driveCall).toHaveBeenCalledExactlyOnceWith(123);
      expect(calendarCall).toHaveBeenCalledExactlyOnceWith(command);
    } finally {
      driveCall.mockRestore();
      calendarCall.mockRestore();
      await client.close();
      await server.close();
    }
  });

  it('composes both products with a shared bucket and preserves kDrive text through HTTP doubles', async () => {
    const driveResponse = {
      data: [{ name: 'Équipe', id: 9, size: 1000, size_used: 12, account_id: 123, extra: true }],
      result: 'success',
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      switch (String(url)) {
        case 'https://api.infomaniak.com/2/drive?account_id=123':
          return Response.json(driveResponse);
        case 'https://api.infomaniak.com/2/profile':
          return Response.json({ result: 'success', data: { email: 'owner@example.test' } });
        case 'https://api.infomaniak.com/1/calendar/pim/event':
          return Response.json(eventResponse);
        default:
          throw new Error(`Unexpected request: ${url}`);
      }
    });
    let now = 0;
    const wait = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const server = await createRuntime(
      { INFOMANIAK_API_TOKEN: 'drive-token', INFOMANIAK_CALENDAR_TOKEN: 'calendar-token' },
      { fetch: fetcher, clock: { now: () => now, wait }, pattern: positivePattern },
    );
    try {
      await rpc(server, 'server/discover');
      const call = { name: listDrivesContract.name, arguments: { account_id: 123 } };
      const result = await rpc(server, 'tools/call', call);
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(driveResponse, null, 2) }],
        structuredContent: {
          drives: [{ id: 9, name: 'Équipe', accountId: 123, usedBytes: 12, capacityBytes: 1000 }],
          displayText: JSON.stringify(driveResponse, null, 2),
        },
        resultType: 'complete',
        _meta: {
          'io.modelcontextprotocol/serverInfo': { name: 'infomaniak-mcp-server', version: '1.1.0' },
        },
      });
      await Promise.all(Array.from({ length: 59 }, () => rpc(server, 'tools/call', call)));
      expect(wait).not.toHaveBeenCalled();
      expect(
        await rpc(server, 'tools/call', { name: createEventContract.name, arguments: command }),
      ).toMatchObject({
        content: [{ type: 'text', text: JSON.stringify(eventResponse, null, 2) }],
        structuredContent: { event: { id: 42, calendarId: '7', title: 'Meeting' } },
        resultType: 'complete',
        _meta: {},
      });
      expect(fetcher).toHaveBeenCalledTimes(62);
      expect(wait.mock.calls).toEqual([[1000], [1000]]);
      expect(fetcher.mock.calls[0][1]?.headers).toHaveProperty(
        'Authorization',
        'Bearer drive-token',
      );
      expect(fetcher.mock.calls[60][1]?.headers).toHaveProperty(
        'Authorization',
        'Bearer calendar-token',
      );
    } finally {
      await server.close();
    }
  });

  it('discovers sorted tools without initialize and calls the drive application port', async () => {
    const deps = dependencies();
    const module = await discoverFeatureModules(positivePattern, deps);
    const server = createModernServer(module, policy);
    try {
      const discover = await rpc(server, 'server/discover');
      expect(discover).toHaveProperty('_meta');
      const list = await rpc(server, 'tools/list');
      expect(list).toMatchObject({ ttlMs: 60000, cacheScope: 'private' });
      expect(list.tools.map((tool: { name: string }) => tool.name)).toEqual([
        'infomaniak_calendar_create_event',
        'infomaniak_list_kdrives',
      ]);
      for (const tool of list.tools) {
        expect(tool.outputSchema).toMatchObject({ type: 'object' });
        expect(tool._meta).toHaveProperty('classification');
      }
      const result = await rpc(server, 'tools/call', {
        name: listDrivesContract.name,
        arguments: { account_id: 123 },
      });
      expect(result).toMatchObject({
        resultType: 'complete',
        structuredContent: { drives: [] },
        content: [{ type: 'text', text: '{\n  "result": "success",\n  "data": []\n}' }],
      });
      expect(result).toHaveProperty('_meta');
      expect(deps.fetcher).toHaveBeenCalledWith(
        'https://api.infomaniak.com/2/drive?account_id=123',
        expect.anything(),
      );
    } finally {
      await server.close();
    }
  });

  it('creates a calendar event through MCP, application, adapter and HTTP double with unchanged text', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
      String(url).endsWith('/2/profile')
        ? Response.json({
            result: 'success',
            data: { email: 'owner@example.test', display_name: 'Owner' },
          })
        : Response.json(eventResponse),
    );
    const server = createModernServer(
      composeFeatureModules([feature], dependencies(fetcher)),
      policy,
    );
    try {
      await rpc(server, 'server/discover');
      const result = await rpc(server, 'tools/call', {
        name: createEventContract.name,
        arguments: command,
      });
      expect(result).toMatchObject({
        resultType: 'complete',
        content: [{ type: 'text', text: JSON.stringify(eventResponse, null, 2) }],
        structuredContent: { event: { id: 42, calendarId: '7', title: 'Meeting' } },
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][0]).toBe('https://api.infomaniak.com/1/calendar/pim/event');
      expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
        title: 'Meeting',
        start: '2026-09-04 12:00:00',
        end: '2026-09-04 13:00:00',
        description: '',
        freebusy: 'busy',
        type: 'event',
        calendar_id: '7',
        fullday: false,
        private: false,
        timezone_start: 'Europe/Zurich',
        timezone_end: 'Europe/Zurich',
        attendees: [
          {
            address: 'guest@example.test',
            name: 'guest@example.test',
            className: 'Attendee',
            organizer: false,
            state: 'NEEDS-ACTION',
          },
          {
            address: 'owner@example.test',
            name: 'Owner',
            className: 'Attendee',
            organizer: true,
            state: 'ACCEPTED',
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it.each([
    ['read_only', { ...policy, readOnly: true }, {}],
    ['raw_api_disabled', policy, { rawApi: true }],
    ['experimental_disabled', policy, { experimental: true }],
  ])(
    'enforces %s using metadata before any handler or input validation',
    async (reason, context, metadata) => {
      const handle = vi.fn();
      const contract = { ...createEventContract, ...metadata, name: 'arbitrary_name' };
      const module = createFeatureModule([{ contract, handle }]);
      expect(await module.invoke(contract.name, null, context)).toMatchObject({
        content: [{ type: 'text', text: `[POLICY_DENIED] ${reason}: arbitrary_name` }],
        structuredContent: { error: { code: 'POLICY_DENIED', reason, tool: 'arbitrary_name' } },
        isError: true,
      });
      expect(handle).not.toHaveBeenCalled();
    },
  );

  it('returns a read-only denial through MCP with zero outgoing HTTP calls', async () => {
    const deps = dependencies();
    const calendarCall = vi.spyOn(CalendarCreateAdapter.prototype, 'createEvent');
    const server = createModernServer(
      composeFeatureModules([feature], deps),
      { ...policy, readOnly: true },
      1234,
    );
    try {
      expect(await rpc(server, 'tools/list')).toMatchObject({ ttlMs: 1234, cacheScope: 'private' });
      expect(
        await rpc(server, 'tools/call', { name: createEventContract.name, arguments: command }),
      ).toMatchObject({
        isError: true,
        content: [
          { type: 'text', text: '[POLICY_DENIED] read_only: infomaniak_calendar_create_event' },
        ],
        structuredContent: {
          error: { code: 'POLICY_DENIED', reason: 'read_only', tool: createEventContract.name },
        },
      });
      expect(deps.fetcher).not.toHaveBeenCalled();
      expect(calendarCall).not.toHaveBeenCalled();
    } finally {
      calendarCall.mockRestore();
      await server.close();
    }
  });

  it('rejects duplicate tools and missing handlers during composition', () => {
    expect(() => composeFeatureModules([feature, feature], dependencies())).toThrow(
      'Duplicate tool',
    );
    expect(() =>
      composeFeatureModules([{ tools: feature.tools, createHandlers: () => ({}) }], dependencies()),
    ).toThrow('Missing handler');
  });

  it('rejects initialize, GET SSE and event resumption', async () => {
    const server = createModernServer(composeFeatureModules([feature], dependencies()), policy);
    try {
      const initialize = await server.fetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        }),
      );
      expect(initialize.status).toBeGreaterThanOrEqual(400);
      const sse = await server.fetch(
        new Request('http://localhost/mcp', {
          headers: { Accept: 'text/event-stream', 'Last-Event-ID': 'old' },
        }),
      );
      expect(sse.status).toBeGreaterThanOrEqual(400);
    } finally {
      await server.close();
    }
  });

  it('validates and snapshots runtime environment without reading it during invocation', () => {
    const env = { INFOMANIAK_API_TOKEN: 'test', MCP_TOOLS_TTL_MS: '1234' };
    const config = loadRuntimeConfig(env);
    env.INFOMANIAK_API_TOKEN = 'changed';
    expect(config.token).toBe('test');
    expect(config.toolsTtlMs).toBe(1234);
    expect(() =>
      loadRuntimeConfig({ INFOMANIAK_API_TOKEN: 'secret', MCP_TOOLS_TTL_MS: '-1' }),
    ).toThrow('Invalid runtime configuration: MCP_TOOLS_TTL_MS');
  });
});

describe('generic feature discovery', () => {
  it('discovers an empty fixture catalogue without advertising tools', async () => {
    const directory = 'test/fixtures/features/empty-directory';
    const pattern = `${directory}/**/*.feature.ts`;
    expect(readdirSync(directory, { recursive: true })).toEqual(['.gitkeep']);
    expect((await discoverFeatureModules(pattern, dependencies())).tools).toEqual([]);
    const server = await createRuntime(
      { INFOMANIAK_API_TOKEN: 'test' },
      { pattern, fetch: dependencies().fetcher, clock: idleClock },
    );
    try {
      expect((await rpc(server, 'server/discover')).capabilities.tools).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('advertises tools when fixture modules are discovered', async () => {
    expect(
      (await discoverFeatureModules(positivePattern, dependencies())).tools.map(
        (tool) => tool.name,
      ),
    ).toEqual([createEventContract.name, listDrivesContract.name]);
    const server = await createRuntime(
      { INFOMANIAK_API_TOKEN: 'test' },
      { pattern: positivePattern, fetch: dependencies().fetcher, clock: idleClock },
    );
    try {
      expect((await rpc(server, 'server/discover')).capabilities.tools).toEqual({
        listChanged: true,
      });
    } finally {
      await server.close();
    }
  });

  it.each(['empty', 'absent'])(
    'discovers an empty catalogue for %s directories',
    async (directory) => {
      expect(
        (
          await discoverFeatureModules(
            `test/fixtures/features/${directory}/**/*.feature.ts`,
            dependencies(),
          )
        ).tools,
      ).toEqual([]);
    },
  );

  it.each([
    ['duplicate', 'Duplicate tool'],
    ['missing', 'Missing handler'],
    ['broken', 'Fixture loading failure'],
  ])('rejects %s during discovery', async (directory, message) => {
    await expect(
      discoverFeatureModules(`test/fixtures/features/${directory}/**/*.feature.ts`, dependencies()),
    ).rejects.toThrow(message);
  });

  it('keeps explicit missing module errors', async () => {
    await expect(
      discoverFeatureModules('test/fixtures/features/absent.feature.ts', dependencies()),
    ).rejects.toThrow();
  });

  it('calls each factory once per composition without provider calls and sorts independently of files', async () => {
    const deps = dependencies();
    const driveFactory = vi.spyOn(driveFeature, 'createHandlers');
    const calendarFactory = vi.spyOn(calendarFeature, 'createHandlers');
    try {
      for (const definitions of [
        [driveFeature, calendarFeature],
        [calendarFeature, driveFeature],
      ]) {
        const module = composeFeatureModules(definitions, deps);
        expect(module.tools.map((tool) => tool.name)).toEqual([
          createEventContract.name,
          listDrivesContract.name,
        ]);
      }
      expect(driveFactory).toHaveBeenCalledTimes(2);
      expect(calendarFactory).toHaveBeenCalledTimes(2);
      const module = await discoverFeatureModules(positivePattern, deps);
      expect(module.tools.map((tool) => tool.name)).toEqual([
        createEventContract.name,
        listDrivesContract.name,
      ]);
      expect(driveFactory).toHaveBeenCalledTimes(3);
      expect(calendarFactory).toHaveBeenCalledTimes(3);
      expect(deps.fetcher).not.toHaveBeenCalled();
    } finally {
      driveFactory.mockRestore();
      calendarFactory.mockRestore();
    }
  });

  it('loads an additional module without changing main and forwards factory base, timeout, UTC, random and clock', async () => {
    let now = 0;
    const wait = vi.fn(async (ms: number) => {
      now += ms;
    });
    const random = vi.fn(() => 0.5);
    const utcNow = vi.fn(() => Date.parse('2026-09-04T00:00:00Z'));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { 'Retry-After': 'Fri, 04 Sep 2026 00:00:02 GMT' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const server = await createRuntime(
      { INFOMANIAK_API_TOKEN: 'test', INFOMANIAK_TIMEOUT_MS: '1234' },
      {
        pattern: 'test/fixtures/features/added/**/*.feature.ts',
        fetch: fetcher,
        clock: { now: () => now, wait },
        random,
        utcNow,
      },
    );
    try {
      expect(fetcher).not.toHaveBeenCalled();
      expect(
        (await rpc(server, 'tools/list')).tools.map((tool: { name: string }) => tool.name),
      ).toEqual(['fixture_extra', createEventContract.name, listDrivesContract.name]);
      expect(
        await rpc(server, 'tools/call', { name: 'fixture_extra', arguments: {} }),
      ).toMatchObject({ structuredContent: { ok: true } });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(fetcher.mock.calls[0][0]).toBe('https://fixture.example/extra');
      expect(wait.mock.calls).toEqual([[2000], [1500]]);
      expect(random).toHaveBeenCalledTimes(1);
      expect(utcNow).toHaveBeenCalled();
      expect(timeout).toHaveBeenCalledWith(1234);
    } finally {
      timeout.mockRestore();
      await server.close();
    }
  });
});

describe('optional runtime block and generic selection', () => {
  it.each([
    'https://chat.example.test',
    'http://chat.example.test',
    'chat.example.test/path',
    'user:secret@chat.example.test',
    'chat.example.test?token=secret',
    'chat.example.test#secret',
    'chat.example.test/',
    ' chat.example.test',
    'chat.example.test\n',
    '-chat.example.test',
    'chat-.example.test',
    'chat..example.test',
    'localhost',
    'chat.example.test:123456',
    '',
  ])('rejects an invalid bare host without echoing it: %j', (host) => {
    expect(() =>
      loadRuntimeConfig({
        INFOMANIAK_API_TOKEN: 'main-secret',
        KCHAT_HOST: host,
        KCHAT_TOKEN: 'chat-secret',
      }),
    ).toThrow('Invalid runtime configuration: KCHAT_HOST');
    try {
      loadRuntimeConfig({
        INFOMANIAK_API_TOKEN: 'main-secret',
        KCHAT_HOST: host,
        KCHAT_TOKEN: 'chat-secret',
      });
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });

  it.each(['chat.example.test', 'CHAT.example.test', 'chat.example.test:8443'])(
    'accepts baseline bare host %s',
    (host) => {
      expect(
        loadRuntimeConfig({
          INFOMANIAK_API_TOKEN: 'main-secret',
          KCHAT_HOST: host,
          KCHAT_TOKEN: 'chat-secret',
        }).kchat,
      ).toEqual({ host, token: 'chat-secret' });
    },
  );

  it.each([{}, { KCHAT_HOST: 'chat.example.test' }, { KCHAT_TOKEN: 'chat-secret' }])(
    'keeps incomplete optional configuration absent: %j',
    (extra) => {
      expect(
        loadRuntimeConfig({ INFOMANIAK_API_TOKEN: 'main-secret', ...extra }).kchat,
      ).toBeUndefined();
    },
  );

  it('rejects an explicitly empty chat token without exposing secrets', () => {
    expect(() =>
      loadRuntimeConfig({
        INFOMANIAK_API_TOKEN: 'main-secret',
        KCHAT_HOST: 'chat.example.test',
        KCHAT_TOKEN: '',
      }),
    ).toThrow('Invalid runtime configuration: KCHAT_TOKEN');
  });

  it('snapshots and freezes the optional block independently of subsequent environment mutations', () => {
    const env = {
      INFOMANIAK_API_TOKEN: 'main-secret',
      KCHAT_HOST: 'chat.example.test',
      KCHAT_TOKEN: 'chat-secret',
    };
    const config = loadRuntimeConfig(env);
    env.KCHAT_HOST = 'other.example.test';
    env.KCHAT_TOKEN = 'changed';
    expect(config.kchat).toEqual({ host: 'chat.example.test', token: 'chat-secret' });
    expect(Object.isFrozen(config.kchat)).toBe(true);
  });

  it('selects once before handlers, using declared contracts and binding only selected names', async () => {
    const deps = dependencies();
    const first = { ...listDrivesContract, name: 'z_selected' };
    const second = { ...listDrivesContract, name: 'a_hidden' };
    const calls: string[] = [];
    const selectTools = vi.fn((actual: typeof deps) => {
      expect(actual).toBe(deps);
      calls.push('select');
      return [{ ...first, classification: 'destructive' as const }];
    });
    const createHandlers = vi.fn(() => {
      calls.push('handlers');
      return { z_selected: async () => ({ drives: [], displayText: 'ok' }) };
    });
    const module = composeFeatureModules(
      [{ tools: [first, second], selectTools, createHandlers }],
      deps,
    );
    expect(calls).toEqual(['select', 'handlers']);
    expect(selectTools).toHaveBeenCalledTimes(1);
    expect(createHandlers).toHaveBeenCalledTimes(1);
    expect(module.tools).toEqual([first]);
    await expect(module.invoke(second.name, {}, policy)).rejects.toThrow('Unknown tool');
    expect(
      (await module.invoke(first.name, { account_id: 1 }, { ...policy, readOnly: true })).isError,
    ).toBeUndefined();
    expect(selectTools).toHaveBeenCalledTimes(1);
  });

  it('selects no tools without requiring handlers for the hidden catalogue', async () => {
    const module = composeFeatureModules(
      [{ tools: feature.tools, selectTools: () => [], createHandlers: () => ({}) }],
      dependencies(),
    );
    expect(module.tools).toEqual([]);
    for (const tool of feature.tools)
      await expect(module.invoke(tool.name, {}, policy)).rejects.toThrow('Unknown tool');
  });

  it.each(['undeclared', 'duplicate', 'missing'])('rejects %s selections', (kind) => {
    const contract = listDrivesContract;
    const selected =
      kind === 'undeclared'
        ? [{ ...contract, name: 'not_declared' }]
        : kind === 'duplicate'
          ? [contract, contract]
          : [contract];
    expect(() =>
      composeFeatureModules(
        [{ tools: [contract], selectTools: () => selected, createHandlers: () => ({}) }],
        dependencies(),
      ),
    ).toThrow(
      kind === 'undeclared'
        ? 'Undeclared tool'
        : kind === 'duplicate'
          ? 'Duplicate tool'
          : 'Missing handler',
    );
  });

  it('rejects duplicate selected names across modules', () => {
    const definition = { ...feature, selectTools: () => feature.tools };
    expect(() => composeFeatureModules([definition, definition], dependencies())).toThrow(
      'Duplicate tool',
    );
  });
});
