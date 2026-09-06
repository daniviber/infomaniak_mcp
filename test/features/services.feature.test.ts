import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createServicesBindings,
  endpoints,
  type ServicesEndpoint,
} from '../../src/application/services/services.feature.js';
import type { ServicesPort } from '../../src/application/services/services.port.js';
import { createFeatureModule } from '../../src/application/feature-module.js';
import { ServicesAdapter } from '../../src/adapters/outbound/infomaniak/services.adapter.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';
import { createHandlers, tools } from '../../src/features/services.feature.js';
import { discoverFeatureModules } from '../../src/main/discover-feature-modules.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

interface Case {
  name: string;
  input: Record<string, unknown>;
  method: string;
  path: string;
  body?: Record<string, unknown>;
  dto: unknown;
  output: Record<string, unknown>;
}
interface Endpoint extends ServicesEndpoint {
  capability: string;
  operation: string;
  baselineMethod: string;
  response: string;
  outputKey: string | null;
  list: boolean;
  source: { path: string; revision: string; line: number };
}
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/services.json', import.meta.url), 'utf8'),
) as {
  baseline: { revision: string; inventoryPath: string; routesAndTypesPath: string };
  endpoints: Endpoint[];
  entities: Record<
    string,
    {
      dto: Record<string, unknown>;
      domain: Record<string, unknown>;
      minimal: Record<string, unknown>;
    }
  >;
  cases: Case[];
  observed: {
    name: string;
    input: Record<string, unknown>;
    data: unknown;
    output: Record<string, unknown>;
  }[];
  deferred: { family: string; owner: string; proof: string; enabled: boolean }[];
};
const policy = { readOnly: false, allowRawApi: false, allowExperimental: true };
const cases = fixture.cases;
const mutations = cases.filter((c) => c.method !== 'GET');
const mapped = cases.filter((c) => c.method !== 'DELETE');
const deletions = cases.filter((c) => c.method === 'DELETE');
const success = (data: unknown) => ({ result: 'success', data, extra: 'PRIVATE' });

function setup(dto: unknown) {
  let now = 0;
  const clock = {
    now: () => now,
    wait: vi.fn(async (ms: number) => {
      now += ms;
    }),
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => new Response(JSON.stringify(dto)));
  const gateway = new InfomaniakGateway({
    token: 'SYNTHETIC-token',
    base: 'https://example.invalid',
    timeoutMs: 100,
    bucket: new TokenBucket(clock),
    fetch,
    clock,
    random: () => 0,
    utcNow: () => 0,
  });
  const adapter = new ServicesAdapter(gateway);
  const module = createFeatureModule(createServicesBindings(adapter));
  return { clock, fetch, gateway, adapter, module };
}
function mockPort() {
  const groups: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
  for (const endpoint of fixture.endpoints) {
    groups[endpoint.capability] ??= {};
    groups[endpoint.capability][endpoint.operation] = vi.fn();
  }
  return { groups, port: groups as unknown as ServicesPort };
}

describe('FEAT-07 services', () => {
  it('covers the exact baseline inventory and records a proof for every endpoint', () => {
    const baseline = execFileSync(
      'git',
      ['show', `${fixture.baseline.revision}:${fixture.baseline.inventoryPath}`],
      { encoding: 'utf8' },
    );
    const names = [
      ...baseline.matchAll(
        /name: "(infomaniak_(?:list_web_hostings|get_web_hosting|\w+_sites?|\w+_databases?|\w+_cron_jobs?|\w+_ftp_accounts?|\w+_swiss_backups?|list_swiss_backup_slots|\w+_certificates?|\w+_invoices?))"/g,
      ),
    ].map((match) => match[1]);
    expect(names).toHaveLength(26);
    expect(tools.map((tool) => tool.name)).toEqual(names);
    expect(cases.map((c) => c.name)).toEqual(names);
    expect(new Set(names).size).toBe(26);
    expect(endpoints).toEqual(
      fixture.endpoints.map(({ name, method, path, proof, enabled, pagination, limits }) => ({
        name,
        method,
        path,
        proof,
        enabled,
        pagination,
        limits,
      })),
    );
    for (const endpoint of endpoints) {
      expect(endpoint.proof).toBe(endpoint.enabled ? 'baseline' : 'unproven');
    }
    expect(endpoints.every((endpoint) => !endpoint.path.startsWith('/1/mail/'))).toBe(true);
    expect(fixture.deferred).toEqual([
      {
        family: '/1/mail/... including redirections',
        owner: 'FEAT-09',
        proof: 'unproven',
        enabled: false,
      },
    ]);
    expect(cases.filter((c) => c.method === 'GET')).toHaveLength(15);
    expect(mutations.filter((c) => c.method !== 'DELETE')).toHaveLength(7);
    expect(deletions).toHaveLength(4);
    const client = execFileSync(
      'git',
      ['show', `${fixture.baseline.revision}:${fixture.baseline.routesAndTypesPath}`],
      { encoding: 'utf8' },
    ).split('\n');
    for (const endpoint of fixture.endpoints) {
      expect(endpoint.source.revision).toBe(fixture.baseline.revision);
      expect(client[endpoint.source.line - 1]).toContain(`async ${endpoint.baselineMethod}(`);
    }
  });

  it.each(cases)(
    '$name maps its DTO, expurgates extras and sends the baseline request',
    async (c) => {
      const s = setup(c.dto);
      const result = await s.module.invoke(c.name, { ...c.input, injected: 'PRIVATE' }, policy);
      expect(result.structuredContent).toStrictEqual(c.output);
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify(result.structuredContent, null, 2) },
      ]);
      expect(JSON.parse(result.content[0].text)).toStrictEqual(result.structuredContent);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC');
      expect(s.fetch).toHaveBeenCalledExactlyOnceWith(
        `https://example.invalid${c.path}`,
        expect.objectContaining({
          method: c.method,
          body: c.body === undefined ? undefined : JSON.stringify(c.body),
          redirect: 'error',
        }),
      );
      const contract = tools.find((tool) => tool.name === c.name)!;
      expect(contract.classification).toBe(
        c.method === 'GET' ? 'read' : c.method === 'DELETE' ? 'destructive' : 'write',
      );
      expect(contract.idempotent).toBe(c.method === 'GET');
      expect(contract.rawApi).toBe(false);
      expect(contract.experimental).toBe(
        !fixture.endpoints.find((e) => e.name === c.name)!.enabled,
      );
    },
  );

  it.each(mapped)(
    '$name accepts the documented minimum without inventing ancillary fields',
    async (c) => {
      const endpoint = fixture.endpoints.find((e) => e.name === c.name)!;
      const minimum = fixture.entities[endpoint.response].minimal;
      const value = endpoint.list ? [minimum] : minimum;
      const s = setup(success(value));
      expect((await s.module.invoke(c.name, c.input, policy)).structuredContent).toStrictEqual({
        [endpoint.outputKey!]: value,
      });
    },
  );

  it.each(mapped)('$name rejects malformed envelopes and required DTO identities', async (c) => {
    const endpoint = fixture.endpoints.find((e) => e.name === c.name)!;
    for (const data of [null, {}, 'PRIVATE', { id: 'PRIVATE' }, { id: 0 }, { id: 1.5 }]) {
      const s = setup(success(endpoint.list ? [data] : data));
      await expect(s.module.invoke(c.name, c.input, policy)).rejects.toThrow(
        'Invalid Infomaniak response',
      );
      expect(s.fetch).toHaveBeenCalledTimes(1);
    }
    for (const dto of [{ result: 'error', data: [] }, { data: [] }, { result: 'success' }]) {
      const s = setup(dto);
      await expect(s.module.invoke(c.name, c.input, policy)).rejects.toThrow(
        'Invalid Infomaniak response',
      );
    }
  });

  it.each(mapped)('$name validates ancillary fields when present', async (c) => {
    const endpoint = fixture.endpoints.find((e) => e.name === c.name)!;
    const entity = fixture.entities[endpoint.response];
    for (const key of Object.keys(entity.dto).filter((key) => key !== 'id')) {
      const data = { ...entity.dto, [key]: { secret: 'PRIVATE' } };
      const s = setup(success(endpoint.list ? [data] : data));
      await expect(s.module.invoke(c.name, c.input, policy)).rejects.toThrow(
        'Invalid Infomaniak response',
      );
    }
  });

  it.each(deletions)(
    '$name ignores deserialized bodies and acknowledges input identifiers',
    async (c) => {
      for (const dto of [
        success(null),
        { result: 'success' },
        { result: 'anything', data: { id: 999, hostingId: 999, secret: 'PRIVATE' } },
        null,
        false,
        42,
        'PRIVATE',
        [],
      ]) {
        const s = setup(dto);
        expect((await s.module.invoke(c.name, c.input, policy)).structuredContent).toStrictEqual(
          c.output,
        );
      }
    },
  );

  it.each(mutations)(
    '$name refuses read-only before input validation and before the port',
    async (c) => {
      const { groups, port } = mockPort();
      const module = createFeatureModule(createServicesBindings(port));
      const result = await module.invoke(c.name, null, { ...policy, readOnly: true });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: 'text', text: `[POLICY_DENIED] read_only: ${c.name}` },
      ]);
      expect(result.structuredContent).toStrictEqual({
        error: { code: 'POLICY_DENIED', reason: 'read_only', tool: c.name },
      });
      for (const group of Object.values(groups))
        for (const call of Object.values(group)) expect(call).not.toHaveBeenCalled();
      const s = setup(c.dto);
      const handlers = createHandlers({
        gateway: s.gateway,
        config: { policy: { ...policy, readOnly: true } },
      });
      expect(await handlers[c.name](null)).toStrictEqual(result.structuredContent);
      expect(s.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(cases.filter((c) => c.method === 'GET'))(
    '$name remains available read-only',
    async (c) => {
      const s = setup(c.dto);
      expect(
        (await s.module.invoke(c.name, c.input, { ...policy, readOnly: true })).structuredContent,
      ).toStrictEqual(c.output);
    },
  );

  it.each(cases)('$name validates required input identifiers before the port', async (c) => {
    const { groups, port } = mockPort();
    const module = createFeatureModule(createServicesBindings(port));
    await expect(module.invoke(c.name, {}, policy)).rejects.toThrow();
    for (const key of Object.keys(c.input).filter((key) => key.endsWith('_id'))) {
      for (const invalid of [0, -1, 1.5, '1', undefined]) {
        await expect(
          module.invoke(c.name, { ...c.input, [key]: invalid }, policy),
        ).rejects.toThrow();
      }
    }
    for (const group of Object.values(groups))
      for (const call of Object.values(group)) expect(call).not.toHaveBeenCalled();
  });

  it.each([
    ['create_site', { hosting_id: 100, fqdn: '' }],
    ['create_database', { hosting_id: 100, name: '' }],
    ['create_cron_job', { hosting_id: 100, command: '', schedule: '*' }],
    ['create_cron_job', { hosting_id: 100, command: 'task', schedule: '' }],
    ['create_ftp_account', { hosting_id: 100, login: '', password: '12345678' }],
    ['create_ftp_account', { hosting_id: 100, login: 'user', password: '1234567' }],
    ['update_ftp_account', { hosting_id: 100, ftp_id: 12, password: '1234567' }],
    ['update_ftp_account', { hosting_id: 100, ftp_id: 12, is_active: 'false' }],
    ['update_site', { hosting_id: 100, site_id: 12, php_version: 8.2 }],
  ])('%s enforces baseline field constraints before HTTP', async (name, input) => {
    const s = setup(null);
    await expect(s.module.invoke(`infomaniak_${name}`, input, policy)).rejects.toThrow();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each(cases)('$name restricts retries and expurgates transport errors', async (c) => {
    for (const failure of [401, 429, 503, 'timeout']) {
      const s = setup(c.dto);
      s.fetch.mockImplementation(async () => {
        if (failure === 'timeout') throw new Error('PRIVATE SYNTHETIC-token');
        return new Response('PRIVATE SYNTHETIC-token', { status: failure as number });
      });
      await expect(s.module.invoke(c.name, c.input, policy)).rejects.toThrow(
        failure === 'timeout' ? 'Infomaniak request failed' : `Infomaniak HTTP ${failure}`,
      );
      const attempts = c.method === 'GET' && failure !== 401 ? 3 : 1;
      expect(s.fetch).toHaveBeenCalledTimes(attempts);
      expect(s.clock.wait).toHaveBeenCalledTimes(attempts - 1);
    }
  });

  it.each(cases)('$name rejects invalid domain output from the port', async (c) => {
    const { groups, port } = mockPort();
    const endpoint = fixture.endpoints.find((e) => e.name === c.name)!;
    groups[endpoint.capability][endpoint.operation].mockResolvedValue({ extra: 'PRIVATE' });
    const module = createFeatureModule(createServicesBindings(port));
    await expect(module.invoke(c.name, c.input, policy)).rejects.toThrow();
  });

  it.each(cases.filter((c) => c.name.startsWith('infomaniak_list_')))(
    '$name preserves empty lists without invented pagination',
    async (c) => {
      const endpoint = fixture.endpoints.find((e) => e.name === c.name)!;
      const s = setup(success([]));
      expect((await s.module.invoke(c.name, c.input, policy)).structuredContent).toStrictEqual({
        [endpoint.outputKey!]: [],
      });
      expect(s.fetch.mock.calls[0][0]).toBe(`https://example.invalid${c.path}`);
      expect(endpoint.pagination).toBe('none');
      expect(endpoint.limits).toEqual({});
    },
  );

  it('validates and expurgates nested backup slots', async () => {
    const s = setup(success({ id: 12, slots: [{ id: 'PRIVATE' }] }));
    await expect(s.adapter.backup.get(12)).rejects.toThrow('Invalid Infomaniak response');
    s.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify(success({ id: 12, slots: [{ id: 13, password: 'PRIVATE' }] }))),
    );
    expect(await s.adapter.backup.get(12)).toStrictEqual({
      backup: { id: 12, slots: [{ id: 13 }] },
    });
  });

  it('recovers a GET after 429 using the gateway clock', async () => {
    const s = setup(success([]));
    s.fetch.mockResolvedValueOnce(
      new Response('PRIVATE', { status: 429, headers: { 'Retry-After': '2' } }),
    );
    expect(await s.adapter.hosting.list(7)).toStrictEqual({ hostings: [] });
    expect(s.clock.wait).toHaveBeenCalledExactlyOnceWith(2000);
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });

  it('auto-composes every service handler and preserves the read-only refusal rendering', async () => {
    const s = setup(null);
    const config = loadRuntimeConfig({
      INFOMANIAK_API_TOKEN: 'SYNTHETIC-token',
      INFOMANIAK_ALLOW_EXPERIMENTAL: 'true',
    });
    const module = await discoverFeatureModules('src/features/services.feature.ts', {
      gateway: s.gateway,
      config,
      clock: s.clock,
      createGateway: () => s.gateway,
    });
    expect(module.tools.map((tool) => tool.name).sort()).toEqual(cases.map((c) => c.name).sort());
    for (const c of cases) {
      s.fetch.mockResolvedValueOnce(new Response(JSON.stringify(c.dto)));
      const result = await module.invoke(c.name, c.input, policy);
      expect(result.structuredContent).toStrictEqual(c.output);
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify(result.structuredContent, null, 2) },
      ]);
    }
    s.fetch.mockClear();
    for (const c of mutations) {
      const result = await module.invoke(c.name, null, { ...policy, readOnly: true });
      expect(result.content).toEqual([
        { type: 'text', text: `[POLICY_DENIED] read_only: ${c.name}` },
      ]);
      expect(result.structuredContent).toEqual({
        error: { code: 'POLICY_DENIED', reason: 'read_only', tool: c.name },
      });
    }
    expect(s.fetch).not.toHaveBeenCalled();
  });
});

describe('FIX-12A services', () => {
  it.each(fixture.observed)('$name accepts observed fields and unknown additions', async (c) => {
    const s = setup(success(c.data));
    const result = await s.module.invoke(c.name, c.input, policy);
    expect(result.structuredContent).toStrictEqual(c.output);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(c.output, null, 2) }]);
  });
  it.each([false, true])(
    'selects experimental services with flag=%s',
    async (allowExperimental) => {
      const s = setup(null);
      const config = loadRuntimeConfig({
        INFOMANIAK_API_TOKEN: 'SYNTHETIC',
        INFOMANIAK_ALLOW_EXPERIMENTAL: String(allowExperimental),
      });
      const module = await discoverFeatureModules('src/features/services.feature.ts', {
        gateway: s.gateway,
        config,
        clock: s.clock,
        createGateway: () => s.gateway,
      });
      expect(module.tools.map((t) => t.name).sort()).toEqual(
        tools
          .filter((t) => !t.experimental || allowExperimental)
          .map((t) => t.name)
          .sort(),
      );
      for (const tool of tools.filter((t) => t.experimental)) {
        const c = cases.find((c) => c.name === tool.name)!;
        if (allowExperimental) {
          s.fetch.mockResolvedValueOnce(Response.json(c.dto));
          expect(
            (await module.invoke(c.name, c.input, config.policy)).structuredContent,
          ).toStrictEqual(c.output);
        } else {
          await expect(module.invoke(c.name, c.input, config.policy)).rejects.toThrow(
            'Unknown tool',
          );
        }
      }
      if (!allowExperimental) expect(s.fetch).not.toHaveBeenCalled();
    },
  );
});
