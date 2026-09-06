import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/main/bootstrap.js';
import { startModernStdio } from '../../src/adapters/inbound/mcp/modern-stdio.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pattern = join(root, 'src/features/**/*.feature.ts');
const defaults = { INFOMANIAK_API_TOKEN: 'fixture-token' };
const all = {
  ...defaults,
  KCHAT_HOST: 'chat.example.test',
  KCHAT_TOKEN: 'fixture-chat-token',
  INFOMANIAK_ALLOW_EXPERIMENTAL: 'true',
  INFOMANIAK_ALLOW_RAW_API: 'true',
};
const noFetch = vi.fn<typeof fetch>(async () => {
  throw new Error('Unexpected provider request');
});
const clock = {
  now: () => 0,
  wait: async () => {
    throw new Error('Unexpected real wait');
  },
};
const options = { pattern, clock, fetch: noFetch };
const names = (tools: readonly { name: string }[]) => tools.map((tool) => tool.name).sort();
const readNames = (path: string): { name: string }[] =>
  JSON.parse(readFileSync(join(root, path), 'utf8'));
const client = () =>
  new Client(
    { name: 'stdio-retirement-test', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );

async function connect(runtime: Awaited<ReturnType<typeof bootstrap>>) {
  const input = new PassThrough();
  const output = new PassThrough();
  const errors: Error[] = [];
  const handle = startModernStdio(runtime.createServer, {
    transport: new StdioServerTransport(input, output),
    onerror: (error) => errors.push(error),
  });
  const connection = client();
  await connection.connect(new StdioServerTransport(output, input));
  return {
    connection,
    errors,
    async close() {
      await connection.close();
      await handle.close();
      input.destroy();
      output.destroy();
    },
  };
}

describe('stdio 2026 retirement and shared bootstrap', () => {
  it('discovers a nonempty registry matching both independent inventories without duplicates', async () => {
    const runtime = await bootstrap(all, options);
    const before = readNames('test/fixtures/baseline-tools.json');
    const after = readNames('product/inventory/tools.json');
    expect(runtime.module.tools.length).toBeGreaterThan(0);
    for (const tools of [before, after, runtime.module.tools]) {
      expect(new Set(names(tools)).size).toBe(tools.length);
    }
    expect(names(runtime.module.tools)).toEqual(names(before));
    expect(names(after)).toEqual(names(before));
    const definitions = await Promise.all(
      readdirSync(join(root, 'src/features'))
        .filter((name) => name.endsWith('.feature.ts'))
        .map((name) => import(join(root, 'src/features', name))),
    );
    const declared = definitions.flatMap((definition) => definition.tools);
    expect(new Set(names(declared)).size).toBe(declared.length);
    expect(names(runtime.module.tools)).toEqual(names(declared));
    expect(noFetch).not.toHaveBeenCalled();
  });

  it('serves discovery, TTL, annotations, validated text and structured output through SDK v2 stdio', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ result: 'success', data: [] }));
    const runtime = await bootstrap(
      { ...defaults, MCP_TOOLS_TTL_MS: '1234' },
      { ...options, fetch: fetcher },
    );
    const session = await connect(runtime);
    try {
      expect(session.connection.getProtocolEra()).toBe('modern');
      expect(session.connection.getNegotiatedProtocolVersion()).toBe('2026-07-28');
      expect(await session.connection.discover()).toHaveProperty('_meta');
      const list = await session.connection.listTools();
      expect(names(list.tools)).toEqual(names(runtime.module.tools));
      expect(list).toMatchObject({ ttlMs: 1234, cacheScope: 'private' });
      for (const tool of list.tools) {
        const contract = runtime.module.tools.find((entry) => entry.name === tool.name)!;
        expect(tool.outputSchema).toMatchObject({ type: 'object' });
        expect(tool.annotations).toMatchObject({
          readOnlyHint: contract.classification === 'read',
          destructiveHint: contract.classification === 'destructive',
          idempotentHint: contract.idempotent,
          openWorldHint: true,
        });
      }
      const result = await session.connection.callTool({
        name: 'infomaniak_list_accounts',
        arguments: {},
      });
      expect(result.structuredContent).toEqual({ accounts: [] });
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify(result.structuredContent, null, 2) },
      ]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(session.errors).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('preserves the read-only refusal without provider I/O or hiding write tools', async () => {
    const runtime = await bootstrap({ ...defaults, INFOMANIAK_READ_ONLY: 'true' }, options);
    const normal = await bootstrap(defaults, options);
    expect(names(runtime.module.tools)).toEqual(names(normal.module.tools));
    const session = await connect(runtime);
    try {
      const name = 'infomaniak_delete_dns_record';
      const result = await session.connection.callTool({
        name,
        arguments: { domain: 'example.test', record_id: 1 },
      });
      expect(result).toMatchObject({
        content: [{ type: 'text', text: `[POLICY_DENIED] read_only: ${name}` }],
        structuredContent: { error: { code: 'POLICY_DENIED', reason: 'read_only', tool: name } },
        isError: true,
      });
      expect(noFetch).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });

  it('captures configuration once and shares the bucket between main and chat gateways', async () => {
    let now = 0;
    const wait = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const fetcher = vi.fn<typeof fetch>(async () => Response.json([]));
    const env = { ...all };
    const runtime = await bootstrap(env, {
      pattern,
      fetch: fetcher,
      clock: { now: () => now, wait },
    });
    env.INFOMANIAK_API_TOKEN = 'changed';
    env.KCHAT_TOKEN = 'changed';
    env.INFOMANIAK_ALLOW_EXPERIMENTAL = 'false';
    // Fill the quota with chat reads, then cross the shared boundary with a core read.
    for (let index = 0; index < 60; index++) {
      await runtime.module.invoke('infomaniak_kchat_list_teams', {}, runtime.config.policy);
    }
    expect(wait).not.toHaveBeenCalled();
    fetcher.mockImplementationOnce(async () => Response.json({ result: 'success', data: [] }));
    await runtime.module.invoke('infomaniak_list_accounts', {}, runtime.config.policy);
    expect(wait.mock.calls).toEqual([[1000]]);
    expect(fetcher.mock.calls[0][1]?.headers).toHaveProperty(
      'Authorization',
      'Bearer fixture-chat-token',
    );
    expect(fetcher.mock.calls.at(-1)?.[1]?.headers).toHaveProperty(
      'Authorization',
      'Bearer fixture-token',
    );
    expect(runtime.config.policy.allowExperimental).toBe(true);
  });
});

describe('compiled executable from another cwd', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
  });

  it.each([
    ['default', defaults],
    ['all indicators', all],
  ] as const)('serves the unchanged %s catalogue from the package bin', async (_label, env) => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'feat-09B-'));
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const executable = join(root, pkg.bin['infomaniak-mcp-server']);
    expect(join(root, pkg.main)).toBe(executable);
    expect(pkg.scripts.start).toBe(`node ${pkg.main}`);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [executable],
      cwd: elsewhere,
      env: { ...env, MCP_TOOLS_TTL_MS: '4321' },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const connection = client();
    const source = await connect(await bootstrap({ ...env, MCP_TOOLS_TTL_MS: '4321' }, options));
    try {
      await connection.connect(transport);
      expect(connection.getNegotiatedProtocolVersion()).toBe('2026-07-28');
      expect(await connection.discover()).toHaveProperty('_meta');
      const list = await connection.listTools();
      expect(list.tools.length).toBeGreaterThan(0);
      expect(list).toEqual(await source.connection.listTools());
      expect(new Set(names(list.tools)).size).toBe(list.tools.length);
      expect(stderr).toBe('');
    } finally {
      await connection.close();
      await source.close();
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
