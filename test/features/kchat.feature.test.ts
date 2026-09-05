import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { createChatFeature, tools } from '../../src/application/chat/chat.feature.js';
import type { ChatPort } from '../../src/application/chat/chat.port.js';
import { KChatAdapter } from '../../src/adapters/outbound/kchat/kchat.adapter.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { discoverFeatureModules } from '../../src/main/discover-feature-modules.js';
import { createRuntime } from '../../src/main/index.js';
import { createModernServer } from '../../src/adapters/inbound/mcp/modern-server.js';

const fixture = JSON.parse(readFileSync('test/fixtures/kchat.json', 'utf8'));
const endpoints = fixture.endpoints as {
  name: string;
  method: string;
  path: string;
  input: Record<string, unknown>;
  response: string;
  proof: string;
}[];
const policy = { readOnly: false, allowRawApi: false, allowExperimental: false };
const prefix = 'infomaniak_kchat_';
const configured = {
  INFOMANIAK_API_TOKEN: 'main-secret',
  INFOMANIAK_CALENDAR_TOKEN: 'calendar-secret',
  KCHAT_HOST: 'chat.example.test',
  KCHAT_TOKEN: 'chat-secret',
};
function dependencies(
  env: Record<string, string | undefined> = configured,
  response?: () => Response,
) {
  let now = 0;
  const clock = {
    now: () => now,
    wait: vi.fn(async (ms: number) => {
      now += ms;
    }),
  };
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (response) return response();
    const url = new URL(String(input));
    const endpoint = endpoints.find(
      (endpoint) => url.pathname === '/api/v4' + endpoint.path && init?.method === endpoint.method,
    );
    if (!endpoint) throw new Error('Unexpected offline request');
    return endpoint.response === 'deletion'
      ? new Response(null, { status: 204 })
      : Response.json(fixture.responses[endpoint.response]);
  });
  const config = loadRuntimeConfig(env);
  const bucket = new TokenBucket(clock);
  const createGateway = vi.fn(
    ({ token, base }: { token: string; base?: string }) =>
      new InfomaniakGateway({
        token,
        base,
        timeoutMs: config.timeoutMs,
        bucket,
        fetch: fetcher,
        clock,
        random: () => 0,
        utcNow: () => 0,
      }),
  );
  const gateway = createGateway({ token: config.token });
  createGateway.mockClear();
  return { gateway, createGateway, config, clock, fetcher };
}
async function setup(response?: () => Response) {
  const deps = dependencies(configured, response);
  const module = await discoverFeatureModules('src/features/kchat.feature.ts', deps);
  return { ...deps, module };
}
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
  return response.json();
}
const mapped = {
  user: {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.test',
    firstName: 'Alice',
    lastName: 'Example',
    nickname: 'Al',
  },
  team: { id: 't1', name: 'team', displayName: 'Team', type: 'O' },
  channel: {
    id: 'c1',
    name: 'general',
    displayName: 'General',
    type: 'O',
    teamId: 't1',
    header: 'Welcome',
    purpose: 'Discussion',
  },
  post: {
    id: 'p1',
    channelId: 'c1',
    userId: 'u1',
    message: 'Bonjour **équipe**',
    createdAt: 1000,
    updatedAt: 2000,
  },
};
const expected: Record<string, unknown> = {
  user: { user: mapped.user },
  users: { users: [mapped.user] },
  teams: { teams: [mapped.team] },
  channel: { channel: mapped.channel },
  channels: { channels: [mapped.channel] },
  direct: { channel: { ...mapped.channel, type: 'D', teamId: '' } },
  post: { post: mapped.post },
  posts: { order: ['p1'], posts: { p1: mapped.post } },
  deletion: { ok: true, action: 'delete_post', postId: 'p1' },
};

describe('kChat offline vertical slice', () => {
  it.each(endpoints)(
    '$name maps the documented DTO through MCP and the injected gateway',
    async (endpoint) => {
      const app = await setup();
      const server = createModernServer(app.module, policy);
      try {
        const result = (
          await rpc(server, 'tools/call', { name: endpoint.name, arguments: endpoint.input })
        ).result;
        expect(result.isError).toBeUndefined();
        expect(result.structuredContent).toEqual(expected[endpoint.response]);
        expect(result.content).toEqual([
          { type: 'text', text: JSON.stringify(result.structuredContent, null, 2) },
        ]);
        expect(JSON.stringify(result)).not.toMatch(
          /chat-secret|main-secret|calendar-secret|provider_only/,
        );
        expect(app.fetcher).toHaveBeenCalledTimes(1);
        const [url, init] = app.fetcher.mock.calls[0];
        expect(new URL(String(url)).origin).toBe('https://chat.example.test');
        expect(new URL(String(url)).pathname).toBe('/api/v4' + endpoint.path);
        expect(init?.method).toBe(endpoint.method);
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer chat-secret');
        expect(init?.redirect).toBe('error');
        expect(app.createGateway).toHaveBeenCalledExactlyOnceWith({
          token: 'chat-secret',
          base: 'https://chat.example.test/api/v4',
        });
      } finally {
        await server.close();
      }
    },
  );

  it('preserves baseline names, schemas and classification in the advertised catalogue', async () => {
    const app = await setup();
    const server = createModernServer(app.module, policy);
    try {
      const listed = (await rpc(server, 'tools/list')).result.tools;
      expect(listed.map((tool: { name: string }) => tool.name)).toEqual(
        endpoints.map((endpoint) => endpoint.name).sort(),
      );
      expect(listed).toHaveLength(13);
      for (const tool of listed) {
        const classification = tool.name.endsWith('delete_post')
          ? 'destructive'
          : ['create_post', 'create_direct'].some((name) => tool.name === prefix + name)
            ? 'write'
            : 'read';
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.outputSchema.type).toBe('object');
        expect(tool._meta).toMatchObject({ classification, rawApi: false, experimental: false });
        expect(tool.annotations).toMatchObject({
          readOnlyHint: classification === 'read',
          destructiveHint: classification === 'destructive',
          idempotentHint: classification === 'read',
        });
      }
    } finally {
      await server.close();
    }
  });

  it.each([false, true])(
    'discovers the existing six modules unchanged with configured=%s',
    async (enabled) => {
      const deps = dependencies(enabled ? configured : { INFOMANIAK_API_TOKEN: 'main-secret' });
      const module = await discoverFeatureModules('src/features/**/*.feature.ts', deps);
      const names = module.tools.map((tool) => tool.name);
      expect(
        readdirSync('src/features').filter((name) => name.endsWith('.feature.ts')),
      ).toHaveLength(7);
      expect(names).toHaveLength(enabled ? 59 : 46);
      expect(names).toEqual([...names].sort());
      expect(new Set(names).size).toBe(names.length);
      expect(names.filter((name) => name.startsWith(prefix))).toHaveLength(enabled ? 13 : 0);
      const without = await discoverFeatureModules(
        'src/features/**/*.feature.ts',
        dependencies({ INFOMANIAK_API_TOKEN: 'main-secret' }),
      );
      expect(names.filter((name) => !name.startsWith(prefix))).toEqual(
        without.tools.map((tool) => tool.name),
      );
      if (!enabled) {
        for (const contract of tools)
          await expect(module.invoke(contract.name, {}, policy)).rejects.toThrow('Unknown tool');
        expect(deps.createGateway).not.toHaveBeenCalled();
      }
      expect(deps.fetcher).not.toHaveBeenCalled();
      expect(tools).toHaveLength(13);
    },
  );

  it('captures config once in main and shares quota across the main and chat gateways', async () => {
    const env = { ...configured };
    let reads = 0;
    Object.defineProperty(env, 'KCHAT_TOKEN', {
      get: () => {
        reads++;
        return 'chat-secret';
      },
      enumerable: true,
    });
    let now = 0;
    const wait = vi.fn(async (ms: number) => {
      now += ms;
    });
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/api/v4/')
        ? Response.json(fixture.responses.user)
        : Response.json({ result: 'success', data: [] }),
    );
    const server = await createRuntime(env, {
      pattern: 'src/features/**/*.feature.ts',
      fetch: fetcher,
      clock: { now: () => now, wait },
    });
    env.KCHAT_HOST = 'changed.example.test';
    env.INFOMANIAK_API_TOKEN = 'changed';
    try {
      expect(reads).toBe(1);
      expect(fetcher).not.toHaveBeenCalled();
      expect((await rpc(server, 'tools/list')).result.tools).toHaveLength(59);
      const drive = await rpc(server, 'tools/call', {
        name: 'infomaniak_list_kdrives',
        arguments: { account_id: 123 },
      });
      expect(drive.result.isError).toBeUndefined();
      for (let i = 0; i < 60; i++) {
        const result = await rpc(server, 'tools/call', { name: prefix + 'get_me', arguments: {} });
        expect(result.result.structuredContent).toEqual({ user: mapped.user });
      }
      expect(reads).toBe(1);
      expect(wait.mock.calls).toEqual([[1000]]);
      expect(fetcher).toHaveBeenCalledTimes(61);
      expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe(
        'Bearer main-secret',
      );
      expect(String(fetcher.mock.calls[60][0])).toBe('https://chat.example.test/api/v4/users/me');
      expect(new Headers(fetcher.mock.calls[60][1]?.headers).get('Authorization')).toBe(
        'Bearer chat-secret',
      );
    } finally {
      await server.close();
    }
  });

  it('omits unconfigured tools from MCP and rejects their invocation without HTTP', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const server = await createRuntime(
      { INFOMANIAK_API_TOKEN: 'main-secret' },
      { pattern: 'src/features/**/*.feature.ts', fetch: fetcher },
    );
    try {
      expect((await rpc(server, 'tools/list')).result.tools).toHaveLength(46);
      for (const tool of tools) {
        const result = await rpc(server, 'tools/call', { name: tool.name, arguments: {} });
        expect(result.error ?? result.result?.isError).toBeTruthy();
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it.each(['create_post', 'create_direct', 'delete_post'])(
    'denies %s before port or input validation',
    async (name) => {
      const call = vi.fn();
      const port = {
        createPost: call,
        createDirect: call,
        deletePost: call,
      } as unknown as ChatPort;
      const module = createChatFeature(port);
      expect(await module.invoke(prefix + name, null, { ...policy, readOnly: true })).toMatchObject(
        {
          isError: true,
          content: [{ type: 'text', text: `[POLICY_DENIED] read_only: ${prefix + name}` }],
          structuredContent: {
            error: { code: 'POLICY_DENIED', reason: 'read_only', tool: prefix + name },
          },
        },
      );
      expect(call).not.toHaveBeenCalled();
    },
  );

  it.each(
    endpoints.filter(
      (endpoint) =>
        !['create_post', 'create_direct', 'delete_post'].some(
          (name) => endpoint.name === prefix + name,
        ),
    ),
  )('$name remains usable in read-only mode', async (endpoint) => {
    const app = await setup();
    expect(
      (await app.module.invoke(endpoint.name, endpoint.input, { ...policy, readOnly: true }))
        .structuredContent,
    ).toEqual(expected[endpoint.response]);
  });

  it.each([
    ['create_post', {}],
    ['create_post', { channel_id: 'c1', message: '' }],
    ['delete_post', { post_id: '' }],
    ['create_direct', { user_ids: ['u1'] }],
    ['create_direct', { user_ids: ['u1', 'u2', 'u3'] }],
    ['create_direct', { user_ids: ['u1', ''] }],
    ['get_channel_posts', { channel_id: 'c1', page: -1 }],
    ['get_channel_posts', { channel_id: 'c1', page: 0.5 }],
    ['get_channel_posts', { channel_id: 'c1', per_page: 0 }],
    ['get_channel_posts', { channel_id: 'c1', per_page: 201 }],
    ['search_users', { term: '' }],
    ['search_posts', { team_id: 't1', terms: '' }],
    ['search_posts', { team_id: 't1', terms: 'x', is_or_search: 1 }],
    ['list_channels', { team_id: 1 }],
    ['get_channel', { channel_id: '' }],
    ['list_users', { in_team_id: 1 }],
  ])('rejects invalid %s input before HTTP (%j)', async (name, input) => {
    const app = await setup();
    await expect(app.module.invoke(prefix + name, input, policy)).rejects.toThrow();
    expect(app.fetcher).not.toHaveBeenCalled();
  });

  it.each(endpoints.filter((endpoint) => endpoint.response !== 'deletion'))(
    '$name explicitly rejects an invalid DTO without leaking response secrets',
    async (endpoint) => {
      const app = await setup(() =>
        Response.json({ token: 'chat-secret', message: 'main-secret' }),
      );
      await expect(app.module.invoke(endpoint.name, endpoint.input, policy)).rejects.toThrow(
        'Invalid Infomaniak response',
      );
      expect(app.fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['id', 'channel_id', 'user_id', 'message'])(
    'requires mapped post field %s',
    async (field) => {
      const payload = { ...fixture.responses.post };
      delete payload[field];
      const app = await setup(() => Response.json(payload));
      await expect(
        app.module.invoke(prefix + 'create_post', { channel_id: 'c1', message: 'hello' }, policy),
      ).rejects.toThrow('Invalid Infomaniak response');
    },
  );

  it.each([
    ['get_me', {}, { id: 'u1' }, { user: { id: 'u1' } }],
    ['list_teams', {}, [{ id: 't1' }], { teams: [{ id: 't1' }] }],
    ['get_channel', { channel_id: 'c1' }, { id: 'c1' }, { channel: { id: 'c1' } }],
    [
      'create_post',
      { channel_id: 'c1', message: 'hello' },
      { id: 'p1', channel_id: 'c1', user_id: 'u1', message: 'hello' },
      { post: { id: 'p1', channelId: 'c1', userId: 'u1', message: 'hello' } },
    ],
  ])('accepts absent descriptive fields for %s', async (name, input, response, output) => {
    const app = await setup(() => Response.json(response));
    const result = await app.module.invoke(prefix + name, input, policy);
    expect(JSON.parse(JSON.stringify(result.structuredContent))).toEqual(output);
  });

  it.each([undefined, null, false, 42, 'chat-secret', { token: 'chat-secret' }])(
    'acknowledges deletion independently of the undocumented DTO %j',
    async (body) => {
      const app = await setup(() =>
        body === undefined ? new Response(null, { status: 204 }) : Response.json(body),
      );
      expect(
        (await app.module.invoke(prefix + 'delete_post', { post_id: 'p1' }, policy))
          .structuredContent,
      ).toEqual(expected.deletion);
    },
  );

  it.each(['create_post', 'create_direct', 'delete_post'])(
    'never retries non-idempotent %s on HTTP or transport failure',
    async (name) => {
      const endpoint = endpoints.find((endpoint) => endpoint.name === prefix + name)!;
      for (const status of [429, 503, 0]) {
        const app = await setup(() => {
          if (!status) throw Error('chat-secret');
          return new Response('chat-secret', { status });
        });
        await expect(app.module.invoke(endpoint.name, endpoint.input, policy)).rejects.toThrow(
          status ? `Infomaniak HTTP ${status}` : 'Infomaniak request failed',
        );
        expect(app.fetcher).toHaveBeenCalledTimes(1);
        expect(app.clock.wait).not.toHaveBeenCalled();
      }
    },
  );

  it('encodes identifiers, preserves input bodies, and sends query parameters with baseline defaults', async () => {
    const app = await setup(() => Response.json(fixture.responses.posts));
    await app.module.invoke(
      prefix + 'get_channel_posts',
      { channel_id: 'a/b?c#d', page: 0, per_page: 200 },
      policy,
    );
    expect(app.fetcher.mock.calls[0][0]).toBe(
      'https://chat.example.test/api/v4/channels/a%2Fb%3Fc%23d/posts?page=0&per_page=200',
    );
    await app.module.invoke(prefix + 'search_posts', { team_id: 'a/b', terms: 'a & b' }, policy);
    expect(app.fetcher.mock.calls[1][0]).toBe(
      'https://chat.example.test/api/v4/teams/a%2Fb/posts/search',
    );
    expect(JSON.parse(String(app.fetcher.mock.calls[1][1]?.body))).toEqual({
      terms: 'a & b',
      is_or_search: false,
    });
    const users = await setup(() => Response.json(fixture.responses.users));
    await users.module.invoke(
      prefix + 'list_users',
      { in_team_id: 'a/b', in_channel_id: 'c & d' },
      policy,
    );
    expect(users.fetcher.mock.calls[0][0]).toBe(
      'https://chat.example.test/api/v4/users?in_team=a%2Fb&in_channel=c+%26+d',
    );
    await users.module.invoke(prefix + 'list_users', {}, policy);
    expect(users.fetcher.mock.calls[1][0]).toBe('https://chat.example.test/api/v4/users');
    await users.module.invoke(prefix + 'search_users', { term: 'a & b' }, policy);
    expect(users.fetcher.mock.calls[2][1]?.method).toBe('POST');
    expect(JSON.parse(String(users.fetcher.mock.calls[2][1]?.body))).toEqual({ term: 'a & b' });
    const posts = await setup(() => Response.json(fixture.responses.post));
    for (const root of [undefined, '', 'p/0']) {
      await posts.module.invoke(
        prefix + 'create_post',
        {
          channel_id: 'c1',
          message: '**Hello**\nworld',
          ...(root === undefined ? {} : { root_id: root }),
        },
        policy,
      );
    }
    expect(posts.fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { channel_id: 'c1', message: '**Hello**\nworld' },
      { channel_id: 'c1', message: '**Hello**\nworld', root_id: '' },
      { channel_id: 'c1', message: '**Hello**\nworld', root_id: 'p/0' },
    ]);
    const direct = await setup(() => Response.json(fixture.responses.direct));
    await direct.module.invoke(prefix + 'create_direct', { user_ids: ['u/1', 'u2'] }, policy);
    expect(JSON.parse(String(direct.fetcher.mock.calls[0][1]?.body))).toEqual(['u/1', 'u2']);
  });

  it('validates the domain output before rendering even with an invalid port', async () => {
    const port = { getMe: async () => ({ user: { id: 3 } }) } as unknown as ChatPort;
    await expect(createChatFeature(port).invoke(prefix + 'get_me', {}, policy)).rejects.toThrow();
  });

  it('enforces read-only through MCP with no adapter or HTTP call', async () => {
    const app = await setup();
    const call = vi.spyOn(KChatAdapter.prototype, 'createPost');
    const server = createModernServer(app.module, { ...policy, readOnly: true });
    try {
      const result = (
        await rpc(server, 'tools/call', {
          name: prefix + 'create_post',
          arguments: { channel_id: 'c1', message: 'hello' },
        })
      ).result;
      expect(result).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: `[POLICY_DENIED] read_only: ${prefix}create_post` }],
        structuredContent: {
          error: { code: 'POLICY_DENIED', reason: 'read_only', tool: prefix + 'create_post' },
        },
      });
      expect(call).not.toHaveBeenCalled();
      expect(app.fetcher).not.toHaveBeenCalled();
    } finally {
      call.mockRestore();
      await server.close();
    }
  });
});
