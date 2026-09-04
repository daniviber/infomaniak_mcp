import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { createFeatureModule } from '../../src/application/feature-module.js';
import { createEventContract } from '../../src/application/calendar/create-event.js';
import { listDrivesContract } from '../../src/application/drive/list-drives.js';
import { createModernServer } from '../../src/adapters/inbound/mcp/modern-server.js';
import { CalendarCreateAdapter } from '../../src/adapters/outbound/infomaniak/calendar-create.adapter.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';
import {
  composeFeatureModules,
  discoverFeatureModules,
} from '../../src/main/discover-feature-modules.js';
import * as feature from '../../src/features/walking-skeleton.feature.js';
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
const ports = () => ({
  drive: {
    listDrives: vi.fn(async () => ({
      drives: [],
      displayText: '{\n  "result": "success",\n  "data": []\n}',
    })),
  },
  calendar: { createEvent: vi.fn() },
});

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
      { fetch: fetcher, clock: { now: () => now, wait }, pattern: 'src/features/**/*.feature.ts' },
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
    const dependencies = ports();
    const module = await discoverFeatureModules('src/features/**/*.feature.ts', dependencies);
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
      expect(dependencies.drive.listDrives).toHaveBeenCalledWith(123);
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
    const gateway = new InfomaniakGateway({
      token: 'test',
      timeoutMs: 1000,
      bucket: new TokenBucket({
        now: () => 0,
        wait: async () => {
          throw new Error('Unexpected wait');
        },
      }),
      fetch: fetcher,
    });
    const server = createModernServer(
      composeFeatureModules([feature], {
        ...ports(),
        calendar: new CalendarCreateAdapter(gateway),
      }),
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

  it('returns a read-only denial through MCP with zero port calls', async () => {
    const dependencies = ports();
    const server = createModernServer(
      composeFeatureModules([feature], dependencies),
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
      expect(dependencies.calendar.createEvent).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('rejects duplicate tools and missing handlers during composition', () => {
    expect(() => composeFeatureModules([feature, feature], ports())).toThrow('Duplicate tool');
    expect(() => composeFeatureModules([{ tools: feature.tools, handlers: {} }], ports())).toThrow(
      'Missing handler',
    );
  });

  it('rejects initialize, GET SSE and event resumption', async () => {
    const server = createModernServer(composeFeatureModules([feature], ports()), policy);
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
