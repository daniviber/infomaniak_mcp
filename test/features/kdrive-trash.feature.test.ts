import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createTrashFeature, tools } from '../../src/application/drive/trash.feature.js';
import {
  PAGE_LIMIT_MIN,
  PAGE_LIMIT_MAX,
  PAGE_LIMIT_DEFAULT,
} from '../../src/application/drive/navigation.feature.js';
import type { DriveTrashPort } from '../../src/application/drive/trash.port.js';
import { KDriveTrashAdapter } from '../../src/adapters/outbound/infomaniak/kdrive-trash.adapter.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';
import * as feature from '../../src/features/kdrive-trash.feature.js';
import { composeFeatureModules } from '../../src/main/discover-feature-modules.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/kdrive-trash.json', import.meta.url), 'utf8'),
);
const policy = { readOnly: false, allowRawApi: false, allowExperimental: false };
const input = { drive_id: 9, file_id: 42 };
const cases = [
  {
    name: 'infomaniak_list_kdrive_trash',
    method: 'GET',
    path: '/3/drive/9/trash?limit=50',
    input: { drive_id: 9 },
    dto: fixture.page,
    output: {
      items: [
        {
          id: 42,
          name: 'été.txt',
          type: 'file',
          sizeBytes: 3,
          parentId: 7,
          mimeType: 'text/plain',
        },
      ],
      hasMore: true,
      cursor: 'next/+?=',
    },
  },
  {
    name: 'infomaniak_restore_kdrive_file',
    method: 'POST',
    path: '/2/drive/9/trash/42/restore',
    input,
    dto: fixture.mutation,
    output: { driveId: 9, fileId: 42, operation: 'restore', success: true },
  },
  {
    name: 'infomaniak_delete_kdrive_trashed_file_permanently',
    method: 'DELETE',
    path: '/2/drive/9/trash/42',
    input,
    dto: fixture.mutation,
    output: { driveId: 9, fileId: 42, operation: 'permanentDelete', success: true },
  },
  {
    name: 'infomaniak_empty_kdrive_trash',
    method: 'DELETE',
    path: '/2/drive/9/trash',
    input: { drive_id: 9 },
    dto: fixture.mutation,
    output: { driveId: 9, operation: 'empty', success: true },
  },
];
function harness(dto: unknown = fixture.mutation) {
  let now = 0;
  const clock = {
    now: () => now,
    wait: vi.fn(async (ms: number) => {
      now += ms;
    }),
  };
  const fetchDouble = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(dto));
  const gateway = new InfomaniakGateway({
    token: 'fixture-only',
    timeoutMs: 1000,
    bucket: new TokenBucket(clock),
    fetch: fetchDouble,
    clock,
    random: () => 0,
    utcNow: () => 0,
  });
  const adapter = new KDriveTrashAdapter(gateway);
  return { clock, fetchDouble, gateway, adapter, module: createTrashFeature(adapter) };
}
function portDouble() {
  return {
    list: vi.fn(),
    restore: vi.fn(),
    permanentDelete: vi.fn(),
    empty: vi.fn(),
  } satisfies DriveTrashPort;
}
function denied(name: string) {
  return {
    content: [{ type: 'text', text: `[POLICY_DENIED] read_only: ${name}` }],
    structuredContent: { error: { code: 'POLICY_DENIED', reason: 'read_only', tool: name } },
    isError: true,
    resultType: 'complete',
    _meta: {},
  };
}

describe('kDrive trash', () => {
  it('exposes the four frozen names with explicit policy and pagination contracts', () => {
    expect(tools.map((t) => t.name)).toEqual(cases.map((c) => c.name));
    expect(tools.map((t) => t.classification)).toEqual([
      'read',
      'write',
      'destructive',
      'destructive',
    ]);
    expect(tools.map((t) => t.idempotent)).toEqual([true, false, false, false]);
    expect(tools[0].limits).toEqual({
      pageLimitMin: PAGE_LIMIT_MIN,
      pageLimitMax: PAGE_LIMIT_MAX,
      pageLimitDefault: PAGE_LIMIT_DEFAULT,
    });
  });
  it.each(cases)('serves $name through the gateway with validated domain JSON', async (c) => {
    const h = harness(c.dto);
    const result = await h.module.invoke(c.name, c.input, policy);
    expect(result.structuredContent).toEqual(c.output);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(result.structuredContent, null, 2) },
    ]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_DTO');
    expect(h.fetchDouble).toHaveBeenCalledTimes(1);
    expect(h.fetchDouble).toHaveBeenCalledWith(
      `https://api.infomaniak.com${c.path}`,
      expect.objectContaining({ method: c.method, body: undefined }),
    );
  });
  it.each(cases)('auto-composes $name', async (c) => {
    const h = harness(c.dto);
    const config = loadRuntimeConfig({ INFOMANIAK_API_TOKEN: 'fixture-only' });
    const module = composeFeatureModules([feature], {
      gateway: h.gateway,
      clock: h.clock,
      config,
      createGateway: () => h.gateway,
    });
    expect((await module.invoke(c.name, c.input, policy)).structuredContent).toEqual(c.output);
  });
  it('restores into an explicit directory', async () => {
    const h = harness();
    await h.module.invoke(cases[1].name, { ...input, destination_directory_id: 7 }, policy);
    expect(h.fetchDouble.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ destination_directory_id: 7 }),
    );
  });
  it('forwards an opaque cursor and bounds and terminates pagination', async () => {
    const h = harness(fixture.lastPage);
    const result = await h.module.invoke(
      cases[0].name,
      { drive_id: 9, cursor: fixture.page.cursor, limit: PAGE_LIMIT_MAX },
      { ...policy, readOnly: true },
    );
    const url = new URL(String(h.fetchDouble.mock.calls[0][0]));
    expect(url.searchParams.get('cursor')).toBe(fixture.page.cursor);
    expect(url.searchParams.get('limit')).toBe(String(PAGE_LIMIT_MAX));
    expect(result.structuredContent).toEqual({ items: [], hasMore: false });
  });
  it.each(cases.slice(1))(
    'denies $name before any port call even with invalid input',
    async (c) => {
      const port = portDouble();
      const module = createTrashFeature(port);
      for (const args of [c.input, null])
        expect(await module.invoke(c.name, args, { ...policy, readOnly: true })).toEqual(
          denied(c.name),
        );
      for (const method of Object.values(port)) expect(method).not.toHaveBeenCalled();
    },
  );
  it.each(cases.slice(1))(
    'denies $name before adapter and fetch, including auto-composition',
    async (c) => {
      const h = harness();
      const spies = [
        vi.spyOn(h.adapter, 'list'),
        vi.spyOn(h.adapter, 'restore'),
        vi.spyOn(h.adapter, 'permanentDelete'),
        vi.spyOn(h.adapter, 'empty'),
      ];
      const readOnly = { ...policy, readOnly: true };
      expect(await h.module.invoke(c.name, c.input, readOnly)).toEqual(denied(c.name));
      const config = {
        ...loadRuntimeConfig({ INFOMANIAK_API_TOKEN: 'fixture-only' }),
        policy: readOnly,
      };
      const composed = composeFeatureModules([feature], {
        gateway: h.gateway,
        clock: h.clock,
        config,
        createGateway: () => h.gateway,
      });
      expect(await composed.invoke(c.name, c.input, readOnly)).toEqual(denied(c.name));
      expect(await feature.createHandlers({ gateway: h.gateway, config })[c.name](c.input)).toEqual(
        denied(c.name).structuredContent,
      );
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(h.fetchDouble).not.toHaveBeenCalled();
      expect(h.clock.wait).not.toHaveBeenCalled();
    },
  );
  for (const c of cases.slice(2)) {
    it.each([429, 500, 503, 'network'])(`${c.name} never retries %s`, async (status) => {
      const h = harness();
      if (typeof status === 'number')
        h.fetchDouble.mockImplementation(
          async () => new Response('', { status, headers: { 'Retry-After': '1' } }),
        );
      else h.fetchDouble.mockRejectedValue(new Error('network'));
      await expect(h.module.invoke(c.name, c.input, policy)).rejects.toThrow('Infomaniak');
      expect(h.fetchDouble).toHaveBeenCalledTimes(1);
      expect(h.clock.wait).not.toHaveBeenCalled();
    });
  }
  it.each(cases)('rejects invalid output for $name', async (c) => {
    const h = harness({ result: 'failure', data: [] });
    await expect(h.module.invoke(c.name, c.input, policy)).rejects.toThrow(
      'Invalid Infomaniak response',
    );
    expect(h.fetchDouble).toHaveBeenCalledTimes(1);
  });
  it.each([
    { result: 'success', data: [{}] },
    { result: 'success', data: [], has_more: true },
    { result: 'success', data: [], has_more: true, cursor: '' },
  ])('rejects malformed list DTO %j', async (dto) => {
    const h = harness(dto);
    await expect(h.module.invoke(cases[0].name, { drive_id: 9 }, policy)).rejects.toThrow();
  });
  it.each([PAGE_LIMIT_MIN - 1, PAGE_LIMIT_MAX + 1, 1.5, '50'])(
    'rejects invalid limit %s before the port',
    async (limit) => {
      const port = portDouble();
      await expect(
        createTrashFeature(port).invoke(cases[0].name, { drive_id: 9, limit }, policy),
      ).rejects.toThrow();
      expect(port.list).not.toHaveBeenCalled();
    },
  );
  it.each(cases)('rejects invalid drive id for $name without fetch', async (c) => {
    const h = harness(c.dto);
    await expect(h.module.invoke(c.name, { ...c.input, drive_id: 0 }, policy)).rejects.toThrow();
    expect(h.fetchDouble).not.toHaveBeenCalled();
  });
  it.each([1, 2])('rejects invalid file id for tool index %s', async (index) => {
    const h = harness();
    await expect(
      h.module.invoke(cases[index].name, { ...input, file_id: -1 }, policy),
    ).rejects.toThrow();
    expect(h.fetchDouble).not.toHaveBeenCalled();
  });
  it('validates port output before rendering', async () => {
    const port = portDouble();
    port.empty.mockResolvedValue({ driveId: 9, operation: 'empty', success: false });
    await expect(
      createTrashFeature(port).invoke(cases[3].name, { drive_id: 9 }, policy),
    ).rejects.toThrow();
  });
});

// Relevé /3/drive/{id}/trash: integer Unix dates; deletion metadata is not consumed.
it('FIX-12B parses observed trash types and converts dates to UTC', async () => {
  const app = harness(fixture.observed);
  const result = await app.module.invoke('infomaniak_list_kdrive_trash', { drive_id: 9 }, policy);
  expect(result.structuredContent).toStrictEqual({
    items: [
      {
        id: 42,
        name: 'été.txt',
        type: 'file',
        sizeBytes: 3,
        mimeType: 'text/plain',
        createdAt: '1970-01-01T00:00:10.000Z',
        addedAt: '1970-01-01T00:00:15.000Z',
        modifiedAt: '1970-01-01T00:00:20.000Z',
      },
    ],
    hasMore: false,
  });
  expect(result.content).toEqual([
    { type: 'text', text: JSON.stringify(result.structuredContent, null, 2) },
  ]);
});
