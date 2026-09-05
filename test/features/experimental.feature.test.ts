import { readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import fixtureJson from '../fixtures/experimental.json';
import * as feature from '../../src/features/experimental.feature.js';
import {
  createExperimentalBindings,
  endpoints,
} from '../../src/application/experimental/experimental.feature.js';
import { experimentalPolicy } from '../../src/application/experimental/experimental-policy.js';
import { createFeatureModule } from '../../src/application/feature-module.js';
import { ExperimentalAdapter } from '../../src/adapters/outbound/infomaniak/experimental.adapter.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';
import {
  composeFeatureModules,
  discoverFeatureModules,
  type FeatureDefinition,
} from '../../src/main/discover-feature-modules.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createModernServer } from '../../src/adapters/inbound/mcp/modern-server.js';
import { policyErrorSchema, type InvocationContext } from '../../src/domain/tool-contract.js';
import type { EntityKind } from '../../src/domain/experimental/endpoint-proof.js';

interface Example {
  name: string;
  method: string;
  path: string;
  proof: string;
  responseProof: string;
  source: { path: string; revision: string; line: number };
  input: Record<string, unknown>;
  response: EntityKind | 'raw' | 'acknowledgement';
  outputKey?: string;
  list?: boolean;
  body?: unknown;
  query?: Record<string, string | number | boolean>;
  providerResponse: unknown;
  domainOutput: Record<string, unknown>;
}
const fixture = fixtureJson as unknown as {
  endpoints: Example[];
  entities: Record<EntityKind, { dto: Record<string, unknown>; minimal: Record<string, unknown> }>;
};
const enabled = { readOnly: false, allowRawApi: true, allowExperimental: true };
const rawName = 'infomaniak_api_call';
const rawExample = fixture.endpoints.find((v) => v.name === rawName)!;
const ordinaryExamples = fixture.endpoints.filter((v) => v.response !== 'raw');
const typedExamples = ordinaryExamples.filter((v) => v.response !== 'acknowledgement');
function dependencies(
  policy: InvocationContext = enabled,
  response: unknown = { result: 'success', data: [] },
  kchat = false,
) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      response === undefined ? new Response(null, { status: 204 }) : Response.json(response),
    );
  const clock = {
    now: () => 0,
    wait: async () => {
      throw new Error('Unexpected retry');
    },
  };
  const bucket = new TokenBucket(clock);
  const config = loadRuntimeConfig({
    INFOMANIAK_API_TOKEN: 'configured-provider-token',
    INFOMANIAK_READ_ONLY: String(policy.readOnly),
    INFOMANIAK_ALLOW_EXPERIMENTAL: String(policy.allowExperimental),
    INFOMANIAK_ALLOW_RAW_API: String(policy.allowRawApi),
    ...(kchat ? { KCHAT_HOST: 'chat.example.test', KCHAT_TOKEN: 'synthetic' } : {}),
  });
  const createGateway = (options: { token: string; base?: string }) =>
    new InfomaniakGateway({
      ...options,
      timeoutMs: 1000,
      bucket,
      fetch: fetcher,
      clock,
      random: () => 0,
      utcNow: () => 0,
    });
  const gateway = createGateway({ token: config.token });
  return { config, clock, createGateway, gateway, fetcher };
}
function denied(result: unknown, reason: string, name: string) {
  expect(result).toEqual({
    content: [{ type: 'text', text: `[POLICY_DENIED] ${reason}: ${name}` }],
    structuredContent: policyErrorSchema.parse({
      error: { code: 'POLICY_DENIED', reason, tool: name },
    }),
    isError: true,
    resultType: 'complete',
    _meta: {},
  });
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

describe('experimental inventory and isolation', () => {
  it('retains exactly the baseline family names and endpoint proofs in the inventory', () => {
    expect(feature.tools.map((v) => v.name).sort()).toEqual(
      fixture.endpoints.map((v) => v.name).sort(),
    );
    expect(feature.tools).toHaveLength(26); // Local lot inventory only.
    for (const example of fixture.endpoints) {
      const contract = feature.tools.find((v) => v.name === example.name)!;
      expect(contract).toMatchObject({
        experimental: true,
        proof: example.proof,
        endpoint: {
          name: example.name,
          method: example.method,
          path: example.path,
          proof: example.proof,
          responseProof: example.responseProof,
          enabled: false,
          source: { path: example.source.path, revision: example.source.revision },
        },
      });
    }
    expect(endpoints).toHaveLength(fixture.endpoints.length);
  });

  const configurations = [false, true].flatMap((kchat) =>
    [false, true].flatMap((allowExperimental) =>
      [false, true].map((allowRawApi) => ({ kchat, allowExperimental, allowRawApi })),
    ),
  );
  it.each(configurations)(
    'composes a sorted, unique catalogue and rejects hidden calls: %j',
    async ({ kchat, allowExperimental, allowRawApi }) => {
      const deps = dependencies(
        { readOnly: false, allowExperimental, allowRawApi },
        undefined,
        kchat,
      );
      const module = await discoverFeatureModules('src/features/**/*.feature.ts', deps);
      const ordinaryDefinitions: FeatureDefinition[] = await Promise.all(
        readdirSync('src/features')
          .filter((name) => name.endsWith('.feature.ts') && name !== 'experimental.feature.ts')
          .map((name) => name.slice(0, -'.feature.ts'.length))
          .map((name) => import(`../../src/features/${name}.feature.ts`)),
      );
      const ordinary = composeFeatureModules(ordinaryDefinitions, deps);
      // Independent sources: discovered application catalogue vs ordinary modules + baseline fixture.
      const expectedExperimental = fixture.endpoints.filter(
        (v) => allowExperimental && (v.name !== rawName || allowRawApi),
      );
      const expectedNames = [
        ...ordinary.tools.map((v) => v.name),
        ...expectedExperimental.map((v) => v.name),
      ].sort();
      const names = module.tools.map((v) => v.name);
      expect(names).toEqual(expectedNames);
      expect(new Set(names).size).toBe(names.length);
      expect(module.tools.length - ordinary.tools.length).toBe(expectedExperimental.length);
      const handlers = feature.createHandlers(deps);
      for (const example of fixture.endpoints.filter((v) => !expectedExperimental.includes(v))) {
        expect(names).not.toContain(example.name);
        expect(handlers[example.name]).toBeUndefined();
        await expect(module.invoke(example.name, example.input, enabled)).rejects.toThrow(
          'Unknown tool',
        );
      }
      expect(deps.fetcher).not.toHaveBeenCalled();
    },
  );

  it('adds only raw when its second flag is enabled', () => {
    const single = feature
      .selectTools(dependencies({ ...enabled, allowRawApi: false }))
      .map((v) => v.name);
    const both = feature.selectTools(dependencies()).map((v) => v.name);
    expect(both.filter((name) => !single.includes(name))).toEqual([rawName]);
    expect(single.filter((name) => !both.includes(name))).toEqual([]);
  });

  it.each([false, true])('projects policy explicitly with readOnly=%s', (readOnly) => {
    for (const allowExperimental of [false, true])
      for (const allowRawApi of [false, true])
        expect(experimentalPolicy({ readOnly, allowExperimental, allowRawApi })).toEqual({
          enabled: allowExperimental,
          allowRawApi,
          readOnly,
        });
  });

  it.each(fixture.endpoints)(
    'denies inventory-only invocation of $name before adapter and HTTP',
    async (example) => {
      const context = { readOnly: false, allowRawApi: false, allowExperimental: false };
      const deps = dependencies(context);
      const adapter = new ExperimentalAdapter(deps.gateway);
      const port = vi.spyOn(adapter, 'execute');
      const gateway = vi.spyOn(deps.gateway, 'request');
      const withStatus = vi.spyOn(deps.gateway, 'requestWithStatus');
      const module = createFeatureModule(createExperimentalBindings(adapter));
      denied(
        await module.invoke(example.name, null, context),
        example.name === rawName ? 'raw_api_disabled' : 'experimental_disabled',
        example.name,
      );
      expect(port).not.toHaveBeenCalled();
      expect(gateway).not.toHaveBeenCalled();
      expect(withStatus).not.toHaveBeenCalled();
      expect(deps.fetcher).not.toHaveBeenCalled();
    },
  );
});

describe('experimental adapter and validated domain output', () => {
  it.each(fixture.endpoints)('maps $name through its auto-composed adapter', async (example) => {
    const deps = dependencies(enabled, example.providerResponse);
    const module = composeFeatureModules([feature], deps);
    const result = await module.invoke(
      example.name,
      { ...example.input, callerExtra: 'discard' },
      enabled,
    );
    expect(result.structuredContent).toEqual(example.domainOutput);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(result.structuredContent, null, 2) },
    ]);
    expect(result.isError).toBeUndefined();
    if (example.response !== 'raw') expect(JSON.stringify(result)).not.toContain('providerOnly');
    else expect(result.structuredContent.data).toEqual(example.providerResponse);
    expect(JSON.stringify(result)).not.toContain('synthetic-password');
    expect(deps.fetcher).toHaveBeenCalledTimes(1);
    const [address, init] = deps.fetcher.mock.calls[0];
    const url = new URL(String(address));
    expect(url.hostname).toBe(['api', 'infomaniak', 'com'].join('.'));
    const path =
      example.name === rawName
        ? String(example.input.endpoint)
        : example.path.replace(/\{([^}]+)\}/g, (_, key: string) =>
            encodeURIComponent(String(example.input[key])),
          );
    expect(url.pathname).toBe(path);
    expect(Object.fromEntries(url.searchParams)).toEqual(
      Object.fromEntries(Object.entries(example.query ?? {}).map(([k, v]) => [k, String(v)])),
    );
    expect(init?.method).toBe(example.method === 'input' ? example.input.method : example.method);
    expect(init?.redirect).toBe('error');
    expect(init?.body === undefined ? undefined : JSON.parse(String(init.body))).toEqual(
      example.body,
    );
  });

  it.each(typedExamples)(
    'accepts ancillary omissions and rejects malformed typed fields: $name',
    async (example) => {
      const minimal = fixture.entities[example.response as EntityKind].minimal;
      const deps = dependencies(enabled, {
        result: 'success',
        data: example.list ? [minimal] : minimal,
      });
      const module = composeFeatureModules([feature], deps);
      await expect(module.invoke(example.name, example.input, enabled)).resolves.toHaveProperty(
        'structuredContent',
      );
      // Entity identities are needed by the mapping; autoresponder has no identity and validates enabled when present.
      const bad =
        example.response === 'autoresponder' ? { enabled: 'yes' } : { ...minimal, id: null };
      deps.fetcher.mockResolvedValueOnce(
        Response.json({ result: 'success', data: example.list ? [bad] : bad }),
      );
      await expect(module.invoke(example.name, example.input, enabled)).rejects.toThrow(
        'Invalid Infomaniak response',
      );
      expect(deps.fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it.each(typedExamples)(
    'rejects missing or failed response envelopes for $name',
    async (example) => {
      for (const response of [
        { result: 'success' },
        { result: 'error', data: null },
        { data: [] },
      ]) {
        const deps = dependencies(enabled, response);
        await expect(
          composeFeatureModules([feature], deps).invoke(example.name, example.input, enabled),
        ).rejects.toThrow('Invalid Infomaniak response');
        expect(deps.fetcher).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each(ordinaryExamples.filter((v) => v.response === 'acknowledgement'))(
    'ignores every deserialized acknowledgement body for $name',
    async (example) => {
      for (const body of [null, 'ignored', { result: 'error', secret: 'ignored' }]) {
        const deps = dependencies(enabled, body);
        const result = await composeFeatureModules([feature], deps).invoke(
          example.name,
          example.input,
          enabled,
        );
        expect(result.structuredContent).toEqual(example.domainOutput);
        expect(deps.fetcher).toHaveBeenCalledTimes(1);
      }
      const deps = dependencies();
      deps.fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect(
        (await composeFeatureModules([feature], deps).invoke(example.name, example.input, enabled))
          .structuredContent,
      ).toEqual(example.domainOutput);
    },
  );

  it.each(typedExamples.filter((v) => v.method !== 'GET'))(
    'does not replace a typed mutation response with an acknowledgement: $name',
    async (example) => {
      const deps = dependencies(enabled, { result: 'success', data: null });
      await expect(
        composeFeatureModules([feature], deps).invoke(example.name, example.input, enabled),
      ).rejects.toThrow('Invalid Infomaniak response');
      expect(deps.fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['infomaniak_get_vps', { vps_id: 0 }],
    ['infomaniak_get_dedicated_server', { server_id: '7' }],
    ['infomaniak_get_domain', { account_id: 3, domain: '..' }],
    ['infomaniak_create_mailbox', { mail_id: 4, mailbox_name: 'info', password: 'short' }],
    ['infomaniak_add_mailbox_alias', { mail_id: 4, mailbox_id: 5, alias: 'invalid' }],
    ['infomaniak_create_email_redirection', { mail_id: 4, from: 'info@example.test', to: [] }],
    ['infomaniak_update_mailbox_autoresponder', { mail_id: 4, mailbox_id: 5, enabled: 'true' }],
  ])('rejects invalid input before HTTP for %s', async (name, input) => {
    const deps = dependencies();
    await expect(
      composeFeatureModules([feature], deps).invoke(name as string, input, enabled),
    ).rejects.toThrow();
    expect(deps.fetcher).not.toHaveBeenCalled();
  });
});

describe('raw and destructive policy at zero outgoing calls', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', undefined, null, '', 'get', 'HEAD', 'INVALID', 1])(
    'denies raw method %j in read-only before handler, port and HTTP',
    async (method) => {
      const context = { ...enabled, readOnly: true };
      const deps = dependencies(context);
      const adapter = new ExperimentalAdapter(deps.gateway);
      const port = vi.spyOn(adapter, 'execute');
      const gateway = vi.spyOn(deps.gateway, 'request');
      const bindings = createExperimentalBindings(adapter);
      const raw = bindings.find((v) => v.contract.rawApi)!;
      const handle = vi.spyOn(raw, 'handle');
      const module = createFeatureModule(bindings);
      denied(
        await module.invoke(rawName, { method, endpoint: '/2/synthetic' }, context),
        'read_only',
        rawName,
      );
      expect(handle).not.toHaveBeenCalled();
      expect(port).not.toHaveBeenCalled();
      expect(gateway).not.toHaveBeenCalled();
      expect(deps.fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(ordinaryExamples.filter((v) => v.method !== 'GET'))(
    'denies mutation $name before port and HTTP in read-only',
    async (example) => {
      const context = { ...enabled, readOnly: true };
      const deps = dependencies(context);
      const gateway = vi.spyOn(deps.gateway, 'request');
      denied(
        await composeFeatureModules([feature], deps).invoke(example.name, example.input, context),
        'read_only',
        example.name,
      );
      expect(gateway).not.toHaveBeenCalled();
      expect(deps.fetcher).not.toHaveBeenCalled();
    },
  );

  it('permits explicit raw GET in read-only and maps its response', async () => {
    const context = { ...enabled, readOnly: true };
    const deps = dependencies(context, rawExample.providerResponse);
    const result = await composeFeatureModules([feature], deps).invoke(
      rawName,
      rawExample.input,
      context,
    );
    expect(result.structuredContent).toEqual(rawExample.domainOutput);
    expect(result.isError).toBeUndefined();
    expect(deps.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'permits raw %s outside read-only and exposes the HTTP status and redacted JSON body',
    async (method) => {
      const deps = dependencies(enabled, { changed: true, secret: 'must not escape' });
      const result = await composeFeatureModules([feature], deps).invoke(
        rawName,
        { method, endpoint: '/2/synthetic', body: { value: 1 } },
        enabled,
      );
      expect(result.structuredContent).toEqual({
        method,
        endpoint: '/2/synthetic',
        status: 200,
        data: { changed: true, secret: '[REDACTED]' },
      });
      expect(result.content[0].text).toBe(JSON.stringify(result.structuredContent, null, 2));
      expect(deps.fetcher).toHaveBeenCalledTimes(1);
      expect(deps.fetcher.mock.calls[0][1]?.method).toBe(method);
    },
  );

  it.each([
    'https://example.test/1',
    '//example.test/1',
    '/1/..',
    '/1/.',
    '/1/%2e%2e',
    '/1/%252e%252e',
    '/1/x%2Fy',
    '/1/x%5cy',
    '/1/a\\b',
    '/1/a?b=c',
    '/1/a#b',
    '/1//a',
    '/1/a/',
    '',
    '1/account',
    '/1/\n',
    '/1/https:evil',
  ])('rejects unsafe raw path %j before HTTP', async (endpoint) => {
    const deps = dependencies();
    await expect(
      composeFeatureModules([feature], deps).invoke(rawName, { method: 'GET', endpoint }, enabled),
    ).rejects.toThrow();
    expect(deps.fetcher).not.toHaveBeenCalled();
  });

  it.each([{}, { method: 'get' }, { method: 'HEAD' }, { method: 1 }, { method: 'GET', body: {} }])(
    'rejects invalid raw inputs without a GET default: %j',
    async (input) => {
      const deps = dependencies();
      await expect(
        composeFeatureModules([feature], deps).invoke(
          rawName,
          { endpoint: '/2/synthetic', ...input },
          enabled,
        ),
      ).rejects.toThrow();
      expect(deps.fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([{ result: 'error', data: {} }, { result: 'success' }, ['unmapped'], null])(
    'exposes arbitrary raw JSON without interpreting an envelope: %j',
    async (response) => {
      const deps = dependencies(enabled, response);
      const result = await composeFeatureModules([feature], deps).invoke(
        rawName,
        rawExample.input,
        enabled,
      );
      expect(result.structuredContent).toEqual({
        method: 'GET',
        endpoint: '/2/synthetic',
        status: 200,
        data: response,
      });
      expect(result.content[0].text).toBe(JSON.stringify(result.structuredContent, null, 2));
      expect(deps.fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    'proves the second flag through MCP listing and invocation: raw=%s',
    async (allowRawApi) => {
      const context = { ...enabled, allowRawApi, readOnly: true };
      const deps = dependencies(context, rawExample.providerResponse);
      const server = createModernServer(composeFeatureModules([feature], deps), context);
      try {
        const listing = await rpc(server, 'tools/list');
        expect(listing.result.tools.some((v: { name: string }) => v.name === rawName)).toBe(
          allowRawApi,
        );
        if (!allowRawApi) {
          const result = await rpc(server, 'tools/call', {
            name: rawName,
            arguments: rawExample.input,
          });
          expect(result.error ?? result.result?.isError).toBeTruthy();
          expect(deps.fetcher).not.toHaveBeenCalled();
        } else {
          for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            const result = await rpc(server, 'tools/call', {
              name: rawName,
              arguments: { method, endpoint: '/2/synthetic' },
            });
            expect(result.result).toMatchObject({
              isError: true,
              content: [{ type: 'text', text: `[POLICY_DENIED] read_only: ${rawName}` }],
              structuredContent: {
                error: { code: 'POLICY_DENIED', reason: 'read_only', tool: rawName },
              },
            });
          }
          expect(deps.fetcher).not.toHaveBeenCalled();
          const result = await rpc(server, 'tools/call', {
            name: rawName,
            arguments: rawExample.input,
          });
          expect(result.result.structuredContent).toEqual(rawExample.domainOutput);
          expect(result.result.content[0].text).toBe(
            JSON.stringify(result.result.structuredContent, null, 2),
          );
          expect(deps.fetcher).toHaveBeenCalledTimes(1);
        }
      } finally {
        await server.close();
      }
    },
  );
});

describe('raw HTTP status and JSON exception (addenda 10/11)', () => {
  it.each(fixtureJson.rawStatusExamples)(
    'renders $method HTTP $status with four fields through MCP',
    async (example) => {
      const deps = dependencies();
      deps.fetcher.mockResolvedValueOnce(
        example.status === 204
          ? new Response(null, { status: 204 })
          : Response.json(example.body, { status: example.status }),
      );
      const server = createModernServer(composeFeatureModules([feature], deps), enabled);
      try {
        const result = await rpc(server, 'tools/call', {
          name: rawName,
          arguments: { method: example.method, endpoint: '/2/synthetic' },
        });
        expect(result.error).toBeUndefined();
        expect(result.result.isError).not.toBe(true);
        expect(result.result.structuredContent).toStrictEqual(example.output);
        expect(Object.keys(result.result.structuredContent).sort()).toEqual([
          'data',
          'endpoint',
          'method',
          'status',
        ]);
        expect(result.result.content).toEqual([
          { type: 'text', text: JSON.stringify(result.result.structuredContent, null, 2) },
        ]);
        expect(deps.fetcher).toHaveBeenCalledTimes(1);
        expect(deps.fetcher.mock.calls[0][1]?.method).toBe(example.method);
      } finally {
        await server.close();
      }
    },
  );

  it.each([null, false, 0, '', ['value', 1], { arbitrary: { body: true } }])(
    'preserves JSON %j without a DTO schema',
    async (data) => {
      const deps = dependencies(enabled, data);
      const result = await composeFeatureModules([feature], deps).invoke(
        rawName,
        rawExample.input,
        enabled,
      );
      expect(result.structuredContent).toStrictEqual({
        method: 'GET',
        endpoint: '/2/synthetic',
        status: 200,
        data,
      });
      expect(result.content[0].text).toBe(JSON.stringify(result.structuredContent, null, 2));
      expect(deps.fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'rejects malformed JSON for raw %s without exposing its contents',
    async (method) => {
      const deps = dependencies();
      deps.fetcher.mockResolvedValueOnce(new Response('configured-provider-token not JSON'));
      await expect(
        composeFeatureModules([feature], deps).invoke(
          rawName,
          { method, endpoint: '/2/synthetic' },
          enabled,
        ),
      ).rejects.toThrow('Invalid Infomaniak response');
      expect(deps.fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'redacts credentials recursively in raw %s JSON and text while preserving other data',
    async (method) => {
      const provider = {
        changed: true,
        nested: [{ password: 'provider-password', access_token: 'issued-credential', count: 3 }],
        credentials: { username: 'private-user', password: 'nested-password' },
        message:
          'configured-provider-token calendar-private-credential chat-private-credential provider-password issued-credential supplied-password',
        authorization: 'Bearer auth-credential',
        headerEcho: 'Bearer auth-credential',
        pem: '-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----',
        'configured-provider-token': 'key echo',
        safe: { status: 'updated', items: [0, false, null] },
      };
      const deps = dependencies(enabled, provider);
      const config = {
        ...deps.config,
        calendarToken: 'calendar-private-credential',
        kchat: { host: 'chat.example.test', token: 'chat-private-credential' },
      };
      const result = await composeFeatureModules([feature], { ...deps, config }).invoke(
        rawName,
        {
          method,
          endpoint: '/2/synthetic',
          query_params: { api_key: 'supplied-password' },
        },
        enabled,
      );
      expect(result.structuredContent).toEqual({
        method,
        endpoint: '/2/synthetic',
        status: 200,
        data: {
          changed: true,
          nested: [{ password: '[REDACTED]', access_token: '[REDACTED]', count: 3 }],
          credentials: '[REDACTED]',
          message: '[REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED]',
          authorization: '[REDACTED]',
          headerEcho: 'Bearer [REDACTED]',
          pem: '[REDACTED]',
          '[REDACTED]': '[REDACTED]',
          safe: { status: 'updated', items: [0, false, null] },
        },
      });
      expect(result.content[0].text).toBe(JSON.stringify(result.structuredContent, null, 2));
      for (const secret of [
        'configured-provider-token',
        'calendar-private-credential',
        'chat-private-credential',
        'provider-password',
        'issued-credential',
        'supplied-password',
        'auth-credential',
        'private material',
        'private-user',
        'nested-password',
      ])
        expect(JSON.stringify(result)).not.toContain(secret);
      expect(deps.fetcher).toHaveBeenCalledTimes(1);
      expect(deps.fetcher.mock.calls[0][1]?.method).toBe(method);
      // Expurgation belongs to the output: it must not alter the actual request credentials.
      expect(deps.fetcher.mock.calls[0][1]?.headers).toHaveProperty(
        'Authorization',
        'Bearer configured-provider-token',
      );
      expect(new URL(String(deps.fetcher.mock.calls[0][0])).searchParams.get('api_key')).toBe(
        'supplied-password',
      );
      expect(provider.nested[0].password).toBe('provider-password');
    },
  );
});
