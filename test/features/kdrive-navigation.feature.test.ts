import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as feature from '../../src/features/kdrive-navigation.feature.js';
import {
  createNavigationBindings,
  PAGE_LIMIT_MIN,
  PAGE_LIMIT_MAX,
  PAGE_LIMIT_DEFAULT,
} from '../../src/application/drive/navigation.feature.js';
import type { DriveNavigationPort } from '../../src/application/drive/navigation.port.js';
import { createFeatureModule } from '../../src/application/feature-module.js';
import { discoverFeatureModules } from '../../src/main/discover-feature-modules.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/kdrive-navigation.json', import.meta.url), 'utf8'),
);
const drive = { id: 9, name: 'Équipe', accountId: 123, usedBytes: 12, capacityBytes: 1000 };
const file = {
  id: 42,
  name: 'rapport.txt',
  type: 'file',
  sizeBytes: 12,
  createdAt: 10,
  modifiedAt: 20,
  addedAt: 15,
  parentId: 1,
  mimeType: 'text/plain',
  extensionType: 'text',
  path: '/rapport.txt',
  visibility: 'private',
  status: 'active',
  isFavorite: true,
};
const directory = { id: 43, name: 'Archives', type: 'dir', parentId: 1 };
const policy = { readOnly: true, allowRawApi: false, allowExperimental: false };
const success = (data: unknown, page = {}) => ({
  result: 'success',
  data,
  ...page,
  provider_secret: 'RAW_SECRET',
});
const cases = [
  {
    name: 'infomaniak_list_kdrives',
    input: { account_id: 123 },
    dto: success([fixture.drive]),
    output: { drives: [drive] },
    path: '/2/drive',
    query: { account_id: '123' },
  },
  {
    name: 'infomaniak_get_kdrive',
    input: { drive_id: 9 },
    dto: success(fixture.drive),
    output: { drive },
    path: '/2/drive/9',
    query: {},
  },
  {
    name: 'infomaniak_list_kdrive_files',
    input: { drive_id: 9 },
    dto: success([fixture.file, fixture.directory], { has_more: true, cursor: fixture.cursor }),
    output: { items: [file, directory], hasMore: true, cursor: fixture.cursor },
    path: '/3/drive/9/files/1/files',
    query: { limit: '50', with: 'path,capabilities,is_favorite,sharelink' },
  },
  {
    name: 'infomaniak_get_kdrive_file',
    input: { drive_id: 9, file_id: 42 },
    dto: success(fixture.file),
    output: { item: file },
    path: '/3/drive/9/files/42',
    query: { with: 'path,capabilities,is_favorite,sharelink,users,version' },
  },
  {
    name: 'infomaniak_search_kdrive_files',
    input: { drive_id: 9, query: 'rapport é' },
    dto: success([fixture.file], { has_more: false, cursor: null }),
    output: { items: [file], hasMore: false },
    path: '/3/drive/9/files/search',
    query: { query: 'rapport é', limit: '50', with: 'path' },
  },
];

async function setup() {
  let now = 0;
  const wait = vi.fn(async (ms: number) => {
    now += ms;
  });
  const clock = { now: () => now, wait };
  const fetcher = vi.fn<typeof fetch>();
  const config = loadRuntimeConfig({
    INFOMANIAK_API_TOKEN: 'TOKEN_SECRET',
    INFOMANIAK_TIMEOUT_MS: '1234',
    INFOMANIAK_READ_ONLY: 'true',
  });
  const gateway = new InfomaniakGateway({
    token: config.token,
    timeoutMs: config.timeoutMs,
    fetch: fetcher,
    clock,
    bucket: new TokenBucket(clock),
    random: () => 0,
    utcNow: () => 0,
  });
  const deps = { gateway, config, clock, createGateway: vi.fn(() => gateway) };
  const module = await discoverFeatureModules('src/features/kdrive-navigation.feature.ts', deps);
  return { module, fetcher, wait, deps };
}

function assertRequest(
  fetcher: Awaited<ReturnType<typeof setup>>['fetcher'],
  path: string,
  query: Record<string, string>,
  index = 0,
) {
  const [url, init] = fetcher.mock.calls[index];
  const parsed = new URL(String(url));
  expect(parsed.origin).toBe('https://api.infomaniak.com');
  expect(parsed.pathname).toBe(path);
  expect(Object.fromEntries(parsed.searchParams)).toEqual(query);
  expect(init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer TOKEN_SECRET' } });
  expect(init?.body).toBeUndefined();
}

describe('kDrive navigation', () => {
  it('discovers exactly the five preserved names without HTTP or another gateway', async () => {
    const { module, fetcher, deps } = await setup();
    expect(module.tools.map((tool) => tool.name)).toEqual(cases.map((entry) => entry.name).sort());
    expect(feature.tools).toHaveLength(5);
    for (const tool of module.tools) {
      expect(tool).toMatchObject({
        classification: 'read',
        rawApi: false,
        experimental: false,
        idempotent: true,
      });
      expect(z.toJSONSchema(tool.outputSchema)).toMatchObject({ type: 'object' });
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(deps.createGateway).not.toHaveBeenCalled();
    expect([PAGE_LIMIT_MIN, PAGE_LIMIT_MAX, PAGE_LIMIT_DEFAULT]).toEqual([1, 200, 50]);
  });

  it.each(cases)(
    '$name maps validated DTOs to domain and identical indented text',
    async (entry) => {
      const { module, fetcher } = await setup();
      fetcher.mockResolvedValueOnce(Response.json(entry.dto));
      const result = await module.invoke(entry.name, entry.input, policy);
      expect(result.structuredContent).toEqual(entry.output);
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify(entry.output, null, 2) },
      ]);
      expect(JSON.stringify(result)).not.toMatch(
        /RAW_SECRET|TOKEN_SECRET|provider_secret|account_id|size_used|last_modified_at/,
      );
      assertRequest(fetcher, entry.path, entry.query);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('invokes all five application port operations with validated defaults', async () => {
    const port: DriveNavigationPort = {
      listDrives: vi.fn().mockResolvedValue({ drives: [drive] }),
      getDrive: vi.fn().mockResolvedValue({ drive }),
      listItems: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
      getItem: vi.fn().mockResolvedValue({ item: file }),
      search: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    const module = createFeatureModule(createNavigationBindings(port));
    for (const entry of cases) await module.invoke(entry.name, entry.input, policy);
    expect(port.listDrives).toHaveBeenCalledExactlyOnceWith(123);
    expect(port.getDrive).toHaveBeenCalledExactlyOnceWith(9);
    expect(port.listItems).toHaveBeenCalledExactlyOnceWith(9, 1, { limit: 50 });
    expect(port.getItem).toHaveBeenCalledExactlyOnceWith(9, 42);
    expect(port.search).toHaveBeenCalledExactlyOnceWith(9, 'rapport é', { limit: 50 });
  });

  for (const entry of [cases[2], cases[4]]) {
    it.each([1, 200])(
      `${entry.name} accepts limit %i and preserves opaque cursors across pages`,
      async (limit) => {
        const { module, fetcher } = await setup();
        fetcher
          .mockResolvedValueOnce(
            Response.json(success([fixture.file], { has_more: true, cursor: fixture.cursor })),
          )
          .mockResolvedValueOnce(Response.json(success([], { has_more: false, cursor: null })));
        const first = await module.invoke(entry.name, { ...entry.input, limit }, policy);
        const second = await module.invoke(
          entry.name,
          { ...entry.input, limit, cursor: first.structuredContent.cursor },
          policy,
        );
        expect(first.structuredContent).toEqual({
          items: [file],
          hasMore: true,
          cursor: fixture.cursor,
        });
        expect(second.structuredContent).toEqual({ items: [], hasMore: false });
        assertRequest(
          fetcher,
          entry.path,
          { ...entry.query, limit: String(limit), cursor: fixture.cursor },
          1,
        );
        expect(fetcher).toHaveBeenCalledTimes(2);
      },
    );
    it.each([0, 201, -1, 1.5, '50', null])(
      `${entry.name} rejects invalid limit %s before HTTP`,
      async (limit) => {
        const { module, fetcher } = await setup();
        await expect(
          module.invoke(entry.name, { ...entry.input, limit }, policy),
        ).rejects.toThrow();
        expect(fetcher).not.toHaveBeenCalled();
      },
    );
  }

  it('forwards directory, sorting, search scope and modification filters', async () => {
    const { module, fetcher } = await setup();
    fetcher.mockImplementation(async () => Response.json(success([])));
    await module.invoke(
      cases[2].name,
      { drive_id: 9, directory_id: 43, type: 'dir', order_by: 'added_at', order: 'desc' },
      policy,
    );
    assertRequest(fetcher, '/3/drive/9/files/43/files', {
      ...cases[2].query,
      'type[]': 'dir',
      order_by: 'added_at',
      order: 'desc',
    });
    await module.invoke(
      cases[4].name,
      {
        drive_id: 9,
        query: 'a & b',
        directory_id: 43,
        depth: 'unlimited',
        type: 'file',
        modified_after: '2025-01-01',
        modified_before: '2026-01-01',
      },
      policy,
    );
    assertRequest(
      fetcher,
      cases[4].path,
      {
        ...cases[4].query,
        query: 'a & b',
        directory_id: '43',
        depth: 'unlimited',
        'types[]': 'file',
        modified_at: 'custom',
        modified_after: '2025-01-01',
        modified_before: '2026-01-01',
      },
      1,
    );
  });

  it.each([
    [cases[0], { account_id: 0 }],
    [cases[1], { drive_id: '../2' }],
    [cases[2], { drive_id: 9, directory_id: -1 }],
    [cases[3], { drive_id: 9, file_id: 1.5 }],
    [cases[4], { drive_id: 9, query: '' }],
    [cases[2], { drive_id: 9, cursor: '' }],
    [cases[2], { drive_id: 9, type: 'other' }],
  ])('rejects malformed inputs before HTTP (%j)', async (entry, input) => {
    const { module, fetcher } = await setup();
    await expect(module.invoke(entry.name, input, policy)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(cases)('$name rejects invalid DTOs without leaking the response', async (entry) => {
    const { module, fetcher } = await setup();
    fetcher.mockResolvedValueOnce(Response.json(success({ invalid: 'RAW_SECRET' })));
    await expect(module.invoke(entry.name, entry.input, policy)).rejects.toThrow(
      /^Invalid Infomaniak response$/,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    success([{ ...fixture.file, type: 'unknown' }]),
    success([{ ...fixture.file, size: -1 }]),
    success([{ ...fixture.file, last_modified_at: 'RAW_SECRET' }]),
    success([], { has_more: true }),
    success([], { has_more: true, cursor: null }),
    success([], { has_more: 'true', cursor: 'next' }),
    { result: 'error', data: [] },
  ])('rejects malformed page DTO %j without retry', async (dto) => {
    const { module, fetcher, wait } = await setup();
    fetcher.mockResolvedValueOnce(Response.json(dto));
    await expect(module.invoke(cases[2].name, cases[2].input, policy)).rejects.toThrow(
      /^Invalid Infomaniak response$/,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  for (const entry of cases) {
    it.each([429, 503, 'timeout'])(
      `${entry.name} recovers from %s through injected gateway backoff`,
      async (failure) => {
        const { module, fetcher, wait } = await setup();
        const timeout = vi.spyOn(AbortSignal, 'timeout');
        if (failure === 'timeout')
          fetcher.mockRejectedValueOnce(new DOMException('TOKEN_SECRET', 'TimeoutError'));
        else
          fetcher.mockResolvedValueOnce(
            new Response('RAW_SECRET', { status: failure, headers: { 'Retry-After': '2' } }),
          );
        fetcher.mockResolvedValueOnce(Response.json(entry.dto));
        try {
          expect((await module.invoke(entry.name, entry.input, policy)).structuredContent).toEqual(
            entry.output,
          );
          expect(fetcher).toHaveBeenCalledTimes(2);
          expect(wait.mock.calls).toEqual([[failure === 429 ? 2000 : 500]]);
          expect(timeout).toHaveBeenCalledWith(1234);
          assertRequest(fetcher, entry.path, entry.query, 1);
        } finally {
          timeout.mockRestore();
        }
      },
    );
  }

  it.each([429, 500, 503, 'timeout'])(
    'stops after three attempts for persistent %s',
    async (failure) => {
      const { module, fetcher, wait } = await setup();
      if (failure === 'timeout')
        fetcher.mockRejectedValue(new DOMException('TOKEN_SECRET', 'TimeoutError'));
      else fetcher.mockImplementation(async () => new Response('RAW_SECRET', { status: failure }));
      await expect(module.invoke(cases[2].name, cases[2].input, policy)).rejects.toThrow(
        failure === 'timeout'
          ? /^Infomaniak request failed$/
          : new RegExp(`^Infomaniak HTTP ${failure}$`),
      );
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(wait.mock.calls).toEqual([[500], [1000]]);
    },
  );

  it.each([401, 403, 404])('does not retry HTTP %i', async (status) => {
    const { module, fetcher, wait } = await setup();
    fetcher.mockResolvedValueOnce(new Response('TOKEN_SECRET RAW_SECRET', { status }));
    await expect(module.invoke(cases[3].name, cases[3].input, policy)).rejects.toThrow(
      `Infomaniak HTTP ${status}`,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
