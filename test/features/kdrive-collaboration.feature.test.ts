import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createCollaborationBindings,
  tools,
} from '../../src/application/drive/collaboration.feature.js';
import type { DriveCollaborationPort } from '../../src/application/drive/collaboration.port.js';
import { createFeatureModule } from '../../src/application/feature-module.js';
import { discoverFeatureModules } from '../../src/main/discover-feature-modules.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import {
  PAGE_LIMIT_MIN,
  PAGE_LIMIT_MAX,
  PAGE_LIMIT_DEFAULT,
} from '../../src/application/drive/navigation.feature.js';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/kdrive-collaboration.json', import.meta.url), 'utf8'),
);
const policy = { readOnly: false, allowRawApi: false, allowExperimental: false };
const fileInput = { drive_id: 9, file_id: 42 };
const link = {
  url: 'https://example.test/share/abc',
  right: 'public',
  fileId: 42,
  validUntil: null,
};
const item = {
  id: 42,
  name: 'rapport.txt',
  type: 'file',
  sizeBytes: 12,
  parentId: 1,
  path: '/rapport.txt',
  isFavorite: true,
};
const member = { id: 8, right: 'read', type: 'invitation' };
const success = (data: unknown, page = {}) => ({
  result: 'success',
  data,
  ...page,
  secret: 'PRIVATE_VALUE',
});
const ack = (action: string) => ({ ok: true, action, fileId: 42 });
const cases = [
  {
    name: 'infomaniak_get_kdrive_share_link',
    method: 'GET',
    path: '/2/drive/9/files/42/link',
    input: fileInput,
    dto: fixture.link,
    output: { link },
    query: {},
    body: undefined,
    operation: 'getShareLink',
  },
  {
    name: 'infomaniak_share_kdrive_file',
    method: 'POST',
    path: '/2/drive/9/files/42/link',
    input: { ...fileInput, right: 'public' },
    dto: fixture.link,
    output: { link },
    query: {},
    body: { right: 'public' },
    operation: 'createShareLink',
  },
  {
    name: 'infomaniak_update_kdrive_share_link',
    method: 'PUT',
    path: '/2/drive/9/files/42/link',
    input: { ...fileInput, can_download: false },
    dto: true,
    output: ack('updateShareLink'),
    query: {},
    body: { can_download: false },
    operation: 'updateShareLink',
  },
  {
    name: 'infomaniak_delete_kdrive_share_link',
    method: 'DELETE',
    path: '/2/drive/9/files/42/link',
    input: fileInput,
    dto: null,
    output: ack('deleteShareLink'),
    query: {},
    body: undefined,
    operation: 'deleteShareLink',
  },
  {
    name: 'infomaniak_list_kdrive_file_access',
    method: 'GET',
    path: '/2/drive/9/files/42/access',
    input: fileInput,
    dto: fixture.access,
    output: {
      access: [
        { id: 0, right: 'manage', type: 'team' },
        { id: 7, right: 'write', type: 'user' },
        member,
      ],
    },
    query: { with: 'user', no_avatar_default: '1' },
    body: undefined,
    operation: 'listAccess',
  },
  {
    name: 'infomaniak_invite_kdrive_access',
    method: 'POST',
    path: '/2/drive/9/files/42/access/invitations',
    input: { ...fileInput, emails: ['a@example.test'], right: 'read' },
    dto: fixture.invitations,
    output: { invitations: [member] },
    query: { lang: 'en' },
    body: { emails: ['a@example.test'], right: 'read' },
    operation: 'inviteAccess',
  },
  {
    name: 'infomaniak_list_kdrive_favorites',
    method: 'GET',
    path: '/3/drive/9/files/favorites',
    input: { drive_id: 9 },
    dto: [fixture.item],
    output: { items: [item], hasMore: false },
    query: { limit: '50', with: 'path' },
    body: undefined,
    operation: 'listFavorites',
  },
  {
    name: 'infomaniak_add_kdrive_favorite',
    method: 'POST',
    path: '/2/drive/9/files/42/favorite',
    input: fileInput,
    dto: {},
    output: ack('addFavorite'),
    query: {},
    body: undefined,
    operation: 'addFavorite',
  },
  {
    name: 'infomaniak_remove_kdrive_favorite',
    method: 'DELETE',
    path: '/2/drive/9/files/42/favorite',
    input: fileInput,
    dto: 'PRIVATE_VALUE',
    output: ack('removeFavorite'),
    query: {},
    body: undefined,
    operation: 'removeFavorite',
  },
  {
    name: 'infomaniak_list_kdrive_recents',
    method: 'GET',
    path: '/3/drive/9/files/recents',
    input: { drive_id: 9, type: 'file' },
    dto: [fixture.item],
    output: { items: [item], hasMore: false },
    query: { limit: '50', with: 'path', 'type[]': 'file' },
    body: undefined,
    operation: 'recents',
  },
  {
    name: 'infomaniak_list_kdrive_shared_with_me',
    method: 'GET',
    path: '/3/drive/9/files/shared_with_me',
    input: { drive_id: 9, type: 'dir' },
    dto: [],
    output: { items: [], hasMore: false },
    query: { limit: '50', 'type[]': 'dir' },
    body: undefined,
    operation: 'sharedWithMe',
  },
  {
    name: 'infomaniak_get_kdrive_activity',
    method: 'GET',
    path: '/3/drive/9/files/activities',
    input: { drive_id: 9 },
    dto: [fixture.activity],
    output: { items: [{ id: 10, action: 'file_update', createdAt: 123 }], hasMore: false },
    query: { limit: '50', with: 'file,user', no_avatar_default: '1' },
    body: undefined,
    operation: 'activity',
  },
];
async function setup(readOnly = false) {
  let now = 0;
  const wait = vi.fn(async (ms: number) => {
    now += ms;
  });
  const clock = { now: () => now, wait };
  const fetcher = vi.fn<typeof fetch>();
  const config = loadRuntimeConfig({
    INFOMANIAK_API_TOKEN: 'SYNTHETIC_SECRET',
    INFOMANIAK_READ_ONLY: String(readOnly),
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
  const module = await discoverFeatureModules('src/features/kdrive-collaboration.feature.ts', deps);
  return { module, fetcher, wait, deps };
}

describe('kDrive collaboration', () => {
  it('discovers all twelve baseline names with explicit classifications', async () => {
    const { module, fetcher, deps } = await setup();
    expect(module.tools.map((t) => t.name)).toEqual(cases.map((c) => c.name).sort());
    expect(tools).toHaveLength(12);
    for (const [index, tool] of tools.entries()) {
      expect(tool.classification).toBe(
        index === 3 ? 'destructive' : cases[index].method === 'GET' ? 'read' : 'write',
      );
      expect(tool.idempotent).toBe(cases[index].method === 'GET');
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(deps.createGateway).not.toHaveBeenCalled();
  });
  it.each(cases)(
    '$name maps only validated domain fields and sends the baseline request',
    async (c) => {
      const { module, fetcher } = await setup();
      fetcher.mockResolvedValueOnce(Response.json(success(c.dto)));
      const result = await module.invoke(c.name, c.input, policy);
      expect(result.structuredContent).toEqual(c.output);
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(c.output, null, 2) }]);
      expect(JSON.stringify(result)).not.toMatch(
        /PRIVATE_VALUE|SYNTHETIC_SECRET|file_id|created_at/,
      );
      const [url, init] = fetcher.mock.calls[0];
      const parsed = new URL(String(url));
      expect(parsed.origin).toBe('https://api.infomaniak.com');
      expect(parsed.pathname).toBe(c.path);
      expect(Object.fromEntries(parsed.searchParams)).toEqual(c.query);
      expect(init?.method).toBe(c.method);
      expect(init?.body === undefined ? undefined : JSON.parse(String(init.body))).toEqual(c.body);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each(cases.filter((c) => c.method !== 'GET'))(
    '$name is denied before the port even with invalid input',
    async (c) => {
      const port = Object.fromEntries(
        cases.map((c) => [c.operation, vi.fn()]),
      ) as unknown as DriveCollaborationPort;
      const module = createFeatureModule(createCollaborationBindings(port));
      const result = await module.invoke(c.name, null, { ...policy, readOnly: true });
      expect(result.content).toEqual([
        { type: 'text', text: `[POLICY_DENIED] read_only: ${c.name}` },
      ]);
      expect(result.structuredContent).toEqual({
        error: { code: 'POLICY_DENIED', reason: 'read_only', tool: c.name },
      });
      for (const handler of Object.values(port)) expect(handler).not.toHaveBeenCalled();
      const discovered = await setup(true);
      expect(
        (await discovered.module.invoke(c.name, c.input, { ...policy, readOnly: true })).isError,
      ).toBe(true);
      expect(discovered.fetcher).not.toHaveBeenCalled();
    },
  );
  for (const c of cases.filter((c) => 'limit' in c.query)) {
    it.each([PAGE_LIMIT_MIN, PAGE_LIMIT_MAX])(
      `${c.name} preserves opaque cursors at limit %i`,
      async (limit) => {
        const { module, fetcher } = await setup();
        fetcher
          .mockResolvedValueOnce(
            Response.json(success(c.dto, { has_more: true, cursor: fixture.cursor })),
          )
          .mockResolvedValueOnce(Response.json(success([], { has_more: false, cursor: null })));
        const first = await module.invoke(c.name, { ...c.input, limit }, policy);
        expect(first.structuredContent).toEqual({
          ...c.output,
          hasMore: true,
          cursor: fixture.cursor,
        });
        const second = await module.invoke(
          c.name,
          { ...c.input, limit, cursor: first.structuredContent.cursor },
          policy,
        );
        expect(second.structuredContent).toEqual({ items: [], hasMore: false });
        const url = new URL(String(fetcher.mock.calls[1][0]));
        expect(url.searchParams.get('cursor')).toBe(fixture.cursor);
        expect(url.searchParams.get('limit')).toBe(String(limit));
        expect(tools.find((t) => t.name === c.name)?.limits).toEqual({
          pageLimitMin: PAGE_LIMIT_MIN,
          pageLimitMax: PAGE_LIMIT_MAX,
          pageLimitDefault: PAGE_LIMIT_DEFAULT,
        });
      },
    );
    it.each([0, 201, 1.5, '50', null])(`${c.name} rejects limit %s before HTTP`, async (limit) => {
      const { module, fetcher } = await setup();
      await expect(module.invoke(c.name, { ...c.input, limit }, policy)).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    });
    it.each([{ has_more: true }, { has_more: true, cursor: null }, { has_more: 'true' }])(
      `${c.name} rejects malformed pagination %j`,
      async (page) => {
        const { module, fetcher, wait } = await setup();
        fetcher.mockResolvedValueOnce(Response.json(success([], page)));
        await expect(module.invoke(c.name, c.input, policy)).rejects.toThrow(
          /^Invalid Infomaniak response: /,
        );
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(wait).not.toHaveBeenCalled();
      },
    );
  }
  it.each(['read', 'write', 'manage'])('accepts invitation right %s', async (right) => {
    const { module, fetcher } = await setup();
    fetcher.mockResolvedValueOnce(Response.json(success([{ id: 8, right }])));
    expect(
      (
        await module.invoke(
          cases[5].name,
          { ...cases[5].input, right, message: 'hello', lang: 'fr' },
          policy,
        )
      ).structuredContent,
    ).toEqual({ invitations: [{ id: 8, right, type: 'invitation' }] });
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('lang')).toBe('fr');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      right,
      message: 'hello',
    });
  });
  it.each(['public', 'inherit', 'password'])(
    'accepts link right %s without exposing password',
    async (right) => {
      const { module, fetcher } = await setup();
      fetcher.mockResolvedValueOnce(Response.json(success({ ...fixture.link, right })));
      const result = await module.invoke(
        cases[1].name,
        { ...fileInput, right, password: 'PRIVATE_VALUE' },
        policy,
      );
      expect(result.structuredContent).toEqual({ link: { ...link, right } });
      expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE');
    },
  );
  it.each([
    [1, { ...fileInput, right: 'admin' }],
    [1, { ...fileInput, right: 'password' }],
    [2, { ...fileInput, right: 'password' }],
    [5, { ...cases[5].input, right: 'owner' }],
    [5, { ...cases[5].input, emails: [] }],
    [5, { ...cases[5].input, emails: ['invalid'] }],
    [0, { ...fileInput, drive_id: '../2' }],
    [0, { ...fileInput, file_id: 0 }],
    [9, { drive_id: 9, type: 'other' }],
    [6, { drive_id: 9, cursor: '' }],
  ] as const)('rejects malformed input %j before HTTP', async (index, input) => {
    const { module, fetcher } = await setup();
    await expect(module.invoke(cases[index].name, input, policy)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(cases)('$name rejects a failed envelope with expurgated error', async (c) => {
    const { module, fetcher, wait } = await setup();
    fetcher.mockResolvedValueOnce(Response.json({ result: 'error', data: 'SYNTHETIC_SECRET' }));
    await expect(module.invoke(c.name, c.input, policy)).rejects.toThrow(
      /^Invalid Infomaniak response: /,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
  it.each([0, 1, 4, 5, 6, 9, 10, 11])('rejects invalid DTO for case %i', async (index) => {
    const c = cases[index];
    const { module, fetcher } = await setup();
    fetcher.mockResolvedValueOnce(Response.json(success({ invalid: 'SYNTHETIC_SECRET' })));
    await expect(module.invoke(c.name, c.input, policy)).rejects.toThrow(
      /^Invalid Infomaniak response: /,
    );
  });
  it.each([
    { teams: [{ id: 1, right: 'admin' }], users: [], invitations: [] },
    { teams: [], users: [{ right: 'read' }], invitations: [] },
    { teams: [], users: [], invitations: [{ id: 'secret', right: 'read' }] },
  ])('rejects invalid access fields %j', async (dto) => {
    const { module, fetcher } = await setup();
    fetcher.mockResolvedValueOnce(Response.json(success(dto)));
    await expect(module.invoke(cases[4].name, fileInput, policy)).rejects.toThrow(
      /^Invalid Infomaniak response: /,
    );
  });
  it('maps file activity with the file route and drops actor data', async () => {
    const { module, fetcher } = await setup();
    fetcher.mockResolvedValueOnce(
      Response.json(success([{ ...fixture.activity, file: fixture.item }])),
    );
    const result = await module.invoke(cases[11].name, fileInput, policy);
    expect(result.structuredContent).toEqual({
      items: [{ id: 10, action: 'file_update', createdAt: 123, file: item }],
      hasMore: false,
    });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/3/drive/9/files/42/activities');
    expect(url.searchParams.get('with')).toBe('user');
  });
  for (const c of cases) {
    it.each([429, 503, 'timeout'])(
      `${c.name} uses gateway retry policy for %s`,
      async (failure) => {
        const { module, fetcher, wait } = await setup();
        if (failure === 'timeout') fetcher.mockRejectedValue(new Error('SYNTHETIC_SECRET'));
        else
          fetcher.mockImplementation(
            async () =>
              new Response('PRIVATE_VALUE', {
                status: Number(failure),
                headers: { 'Retry-After': '2' },
              }),
          );
        await expect(module.invoke(c.name, c.input, policy)).rejects.toThrow(
          failure === 'timeout'
            ? /^Infomaniak request failed$/
            : new RegExp(`^Infomaniak HTTP ${failure}$`),
        );
        expect(fetcher).toHaveBeenCalledTimes(c.method === 'GET' ? 3 : 1);
        expect(wait.mock.calls).toEqual(
          c.method === 'GET' ? (failure === 429 ? [[2000], [2000]] : [[500], [1000]]) : [],
        );
      },
    );
  }
  it.each([401, 403, 404])('does not retry HTTP %i', async (status) => {
    const { module, fetcher, wait } = await setup();
    fetcher.mockResolvedValueOnce(new Response('PRIVATE_VALUE', { status }));
    await expect(module.invoke(cases[0].name, fileInput, policy)).rejects.toThrow(
      new RegExp(`^Infomaniak HTTP ${status}$`),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
