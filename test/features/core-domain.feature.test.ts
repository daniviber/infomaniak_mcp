import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createCoreBindings } from '../../src/application/core/core.feature.js';
import { createDomainBindings } from '../../src/application/domain/domain.feature.js';
import type { DomainPort } from '../../src/application/domain/domain.port.js';
import { createFeatureModule } from '../../src/application/feature-module.js';
import { CoreDomainAdapter } from '../../src/adapters/outbound/infomaniak/core-domain.adapter.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';
import { createHandlers, tools } from '../../src/features/core-domain.feature.js';
import { discoverFeatureModules } from '../../src/main/discover-feature-modules.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/core-domain.json', import.meta.url), 'utf8'),
);
const policy = { readOnly: false, allowRawApi: false, allowExperimental: true };
const domain = 'example.test';
const account = { id: 7, name: 'Account' };
const profile = {
  id: 1,
  login: 'user',
  email: 'user@example.test',
  firstName: 'First',
  lastName: 'Last',
};
const product = { id: 8, serviceId: 9, serviceName: 'domain', accountId: 7, customerName: domain };
const nameserver = { host: 'ns.example.test', ip: '192.0.2.1' };
const record = { id: '12', source: '@', type: 'A', target: '192.0.2.1', ttl: 3600, priority: 0 };
const recordBody = { source: '@', type: 'A', target: '192.0.2.1', ttl: 3600, priority: 0 };
const success = (data: unknown) => ({ result: 'success', data, extra: 'PRIVATE' });
const cases = [
  {
    name: 'infomaniak_ping',
    input: {},
    method: 'GET',
    path: '/1/ping',
    dto: success(fixture.ping),
    output: { message: 'Pong' },
  },
  {
    name: 'infomaniak_get_profile',
    input: {},
    method: 'GET',
    path: '/1/profile',
    dto: success(fixture.profile),
    output: { profile },
  },
  {
    name: 'infomaniak_list_accounts',
    input: {},
    method: 'GET',
    path: '/1/account',
    dto: success([fixture.account]),
    output: { accounts: [account] },
  },
  {
    name: 'infomaniak_get_account',
    input: { account_id: 7 },
    method: 'GET',
    path: '/1/account/7',
    dto: success(fixture.account),
    output: { account },
  },
  {
    name: 'infomaniak_list_products',
    input: { account_id: 7 },
    method: 'GET',
    path: '/1/account/7/product',
    dto: success([fixture.product]),
    output: { products: [product] },
  },
  {
    name: 'infomaniak_get_domain_nameservers',
    input: { domain },
    method: 'GET',
    path: '/1/domain/example.test/nameserver',
    dto: success([fixture.nameserver]),
    output: { nameservers: [nameserver] },
  },
  {
    name: 'infomaniak_update_domain_nameservers',
    input: { domain, nameservers: [nameserver] },
    method: 'PUT',
    path: '/2/domains/domains/example.test/nameservers',
    body: { nameservers: [nameserver.host] },
    dto: success(null),
    output: { ok: true, action: 'update_nameservers', domain },
  },
  {
    name: 'infomaniak_renew_domain',
    input: { domain, duration: 2 },
    method: 'POST',
    path: '/1/domain/example.test/renew',
    body: { duration: 2 },
    dto: success(null),
    output: { ok: true, action: 'renew', domain },
  },
  {
    name: 'infomaniak_list_dns_records',
    input: { domain },
    method: 'GET',
    path: '/1/domain/example.test/dns/record',
    dto: success([fixture.readRecord]),
    output: { records: [record] },
  },
  {
    name: 'infomaniak_create_dns_record',
    input: { domain, ...recordBody },
    method: 'POST',
    path: '/1/domain/example.test/dns/record',
    body: recordBody,
    dto: success(fixture.record),
    output: { record },
  },
  {
    name: 'infomaniak_update_dns_record',
    input: { domain, record_id: '12', target: '192.0.2.1' },
    method: 'PUT',
    path: '/1/domain/example.test/dns/record/12',
    body: { target: '192.0.2.1' },
    dto: success(fixture.record),
    output: { record },
  },
  {
    name: 'infomaniak_delete_dns_record',
    input: { domain, record_id: '12' },
    method: 'DELETE',
    path: '/1/domain/example.test/dns/record/12',
    dto: success(null),
    output: { ok: true, action: 'delete_dns_record', domain, recordId: '12' },
  },
];
const mutations = cases.filter((c) => c.method !== 'GET');
const acknowledgements = cases.filter((c) => 'ok' in c.output);
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
    token: 'SYNTHETIC',
    timeoutMs: 100,
    bucket: new TokenBucket(clock),
    fetch,
    clock,
    random: () => 0,
    utcNow: () => 0,
  });
  const adapter = new CoreDomainAdapter(gateway);
  const module = createFeatureModule([
    ...createCoreBindings(adapter),
    ...createDomainBindings(adapter),
  ]);
  return { clock, fetch, gateway, adapter, module };
}

describe('FEAT-06 core/domain', () => {
  it.each(cases)('$name validates, maps and renders the baseline route', async (c) => {
    const s = setup(c.dto);
    const result = await s.module.invoke(c.name, c.input, policy);
    expect(result.structuredContent).toEqual(c.output);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(c.output, null, 2) }]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(s.fetch).toHaveBeenCalledExactlyOnceWith(
      `https://api.infomaniak.com${c.path}`,
      expect.objectContaining({
        method: c.method,
        body: 'body' in c ? JSON.stringify(c.body) : undefined,
      }),
    );
    const contract = tools.find((t) => t.name === c.name)!;
    expect(contract.idempotent).toBe(c.method === 'GET');
    expect(contract.classification).toBe(
      c.method === 'GET' ? 'read' : c.method === 'DELETE' ? 'destructive' : 'write',
    );
  });
  it.each(mutations)('$name read-only denial precedes the port and input validation', async (c) => {
    const port = {
      getNameservers: vi.fn(),
      updateNameservers: vi.fn(),
      renew: vi.fn(),
      listDnsRecords: vi.fn(),
      createDnsRecord: vi.fn(),
      updateDnsRecord: vi.fn(),
      deleteDnsRecord: vi.fn(),
    } satisfies DomainPort;
    const module = createFeatureModule(createDomainBindings(port));
    const result = await module.invoke(c.name, null, { ...policy, readOnly: true });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: `[POLICY_DENIED] read_only: ${c.name}` },
    ]);
    expect(result.structuredContent).toEqual({
      error: { code: 'POLICY_DENIED', reason: 'read_only', tool: c.name },
    });
    for (const call of Object.values(port)) expect(call).not.toHaveBeenCalled();
    const s = setup(c.dto);
    const handlers = createHandlers({
      gateway: s.gateway,
      config: { policy: { ...policy, readOnly: true } },
    });
    expect(await handlers[c.name](c.input)).toEqual(result.structuredContent);
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it.each(acknowledgements)('$name ignores any deserialized supplier value', async (c) => {
    for (const dto of [
      null,
      false,
      42,
      'ignored',
      [],
      { result: 'anything', data: { domain: 'wrong', recordId: 99 }, secret: 'PRIVATE' },
    ]) {
      const s = setup(dto);
      expect((await s.module.invoke(c.name, c.input, policy)).structuredContent).toEqual(c.output);
    }
  });
  it.each(cases.filter((c) => !('ok' in c.output)))(
    '$name rejects invalid required DTO fields',
    async (c) => {
      for (const dto of [success({}), success([{}]), { result: 'error', data: c.dto }]) {
        const s = setup(dto);
        await expect(s.module.invoke(c.name, c.input, policy)).rejects.toThrow(
          'Invalid Infomaniak response',
        );
        expect(s.fetch).toHaveBeenCalledTimes(1);
      }
    },
  );
  it.each(cases)('$name handles 429, 5xx and timeout with only safe retries', async (c) => {
    for (const failure of [429, 503, 'timeout']) {
      const s = setup(c.dto);
      s.fetch.mockImplementation(async () => {
        if (failure === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
        return new Response('error', { status: failure as number });
      });
      await expect(s.module.invoke(c.name, c.input, policy)).rejects.toThrow(
        failure === 'timeout' ? 'Infomaniak request failed' : `Infomaniak HTTP ${failure}`,
      );
      expect(s.fetch).toHaveBeenCalledTimes(c.method === 'GET' ? 3 : 1);
      expect(s.clock.wait).toHaveBeenCalledTimes(c.method === 'GET' ? 2 : 0);
    }
  });
  it('recovers a GET after 429 using the injected clock', async () => {
    const s = setup(success(fixture.ping));
    s.fetch.mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'Retry-After': '2' } }),
    );
    expect(await s.adapter.ping()).toEqual({ message: 'Pong' });
    expect(s.clock.wait).toHaveBeenCalledExactlyOnceWith(2000);
  });
  it('maps optional baseline fields when present without identity caching', async () => {
    const s = setup(success({ ...fixture.profile, current_account_id: 7 }));
    expect(await s.adapter.getProfile()).toEqual({ profile: { ...profile, currentAccountId: 7 } });
    s.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify(success({ ...fixture.profile, id: 2 }))),
    );
    expect((await s.adapter.getProfile()).profile.id).toBe(2);
    expect(s.fetch).toHaveBeenCalledTimes(2);
    s.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          success({ ...fixture.account, legal_entity_type: 'company', created_at: 1767225600 }),
        ),
      ),
    );
    expect(await s.adapter.getAccount(7)).toEqual({
      account: { ...account, legalEntityType: 'company', createdAt: '2026-01-01T00:00:00.000Z' },
    });
  });
  it.each([
    ['infomaniak_get_account', { account_id: 0 }],
    ['infomaniak_list_products', { account_id: 1.5 }],
    ['infomaniak_get_domain_nameservers', { domain: '' }],
    ['infomaniak_update_domain_nameservers', { domain, nameservers: [] }],
    ['infomaniak_update_domain_nameservers', { domain, nameservers: [{ host: '' }] }],
    ['infomaniak_renew_domain', { domain, duration: 0 }],
    ['infomaniak_renew_domain', { domain, duration: 1.5 }],
    ['infomaniak_create_dns_record', { domain, ...recordBody, ttl: 59 }],
    ['infomaniak_create_dns_record', { domain, ...recordBody, ttl: 86401 }],
    ['infomaniak_create_dns_record', { domain, ...recordBody, type: 'INVALID' }],
    ['infomaniak_update_dns_record', { domain, record_id: '12', priority: 65536 }],
    ['infomaniak_update_dns_record', { domain, record_id: '12', priority: -1 }],
    ['infomaniak_delete_dns_record', { domain, record_id: -1 }],
  ])('%s rejects invalid inputs before HTTP', async (name, input) => {
    const s = setup(null);
    await expect(s.module.invoke(name as string, input, policy)).rejects.toThrow();
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it('encodes a domain as one path segment', async () => {
    const s = setup(success([]));
    await s.adapter.listDnsRecords('a/b?x=#');
    expect(s.fetch.mock.calls[0][0]).toBe(
      'https://api.infomaniak.com/1/domain/a%2Fb%3Fx%3D%23/dns/record',
    );
  });
  it('auto-composes all twelve handlers and excludes FEAT-09', async () => {
    const s = setup(null);
    const config = loadRuntimeConfig({
      INFOMANIAK_API_TOKEN: 'SYNTHETIC',
      INFOMANIAK_ALLOW_EXPERIMENTAL: 'true',
    });
    const module = await discoverFeatureModules('src/features/core-domain.feature.ts', {
      gateway: s.gateway,
      config,
      clock: s.clock,
      createGateway: () => s.gateway,
    });
    expect(module.tools.map((t) => t.name).sort()).toEqual(cases.map((c) => c.name).sort());
    expect(module.tools.map((t) => t.name)).not.toContain('infomaniak_list_domains');
    expect(module.tools.map((t) => t.name)).not.toContain('infomaniak_get_domain');
    for (const c of cases) {
      s.fetch.mockResolvedValueOnce(new Response(JSON.stringify(c.dto)));
      expect((await module.invoke(c.name, c.input, policy)).structuredContent).toEqual(c.output);
    }
  });
});

describe('FIX-12A domain', () => {
  it('accepts additional DNS fields without exposing them', async () => {
    const s = setup(success([{ ...fixture.observedRecord, extra: 'PRIVATE' }]));
    const result = await s.module.invoke('infomaniak_list_dns_records', { domain }, policy);
    expect(result.structuredContent).toStrictEqual({
      records: [{ id: '12', source: '@', type: 'A', target: '192.0.2.1', ttl: 3600 }],
    });
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(result.structuredContent, null, 2) },
    ]);
  });
  it.each([false, true])(
    'selects nameservers with experimental flag=%s',
    async (allowExperimental) => {
      const s = setup(success([fixture.nameserver]));
      const config = loadRuntimeConfig({
        INFOMANIAK_API_TOKEN: 'SYNTHETIC',
        INFOMANIAK_ALLOW_EXPERIMENTAL: String(allowExperimental),
      });
      const module = await discoverFeatureModules('src/features/core-domain.feature.ts', {
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
      const name = 'infomaniak_get_domain_nameservers';
      if (allowExperimental)
        expect((await module.invoke(name, { domain }, config.policy)).structuredContent).toEqual({
          nameservers: [nameserver],
        });
      else {
        await expect(module.invoke(name, { domain }, config.policy)).rejects.toThrow(
          'Unknown tool',
        );
        expect(s.fetch).not.toHaveBeenCalled();
      }
      for (const name of [
        'renew_domain',
        'list_dns_records',
        'create_dns_record',
        'update_dns_record',
        'delete_dns_record',
      ]) {
        expect(tools.find((t) => t.name === 'infomaniak_' + name)?.experimental).toBe(false);
      }
    },
  );
});

// Relevé /1/account: created_at:int, converted from Unix seconds.
it('FIX-12B parses the account list and converts its creation date to UTC', async () => {
  const s = setup(success([{ ...fixture.account, created_at: 1767225600 }]));
  const result = await s.module.invoke('infomaniak_list_accounts', {}, policy);
  expect(result.structuredContent).toStrictEqual({
    accounts: [{ ...account, legalEntityType: undefined, createdAt: '2026-01-01T00:00:00.000Z' }],
  });
  expect(result.content).toEqual([
    { type: 'text', text: JSON.stringify(result.structuredContent, null, 2) },
  ]);
});
