#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'feat12-mvp-'));
// Do not inherit provider tokens, NODE_OPTIONS, proxy settings or operator configuration.
const env = { PATH: process.env.PATH, HOME: temporary, TMPDIR: temporary, TZ: 'UTC' };
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const names = (entries) => entries.map(({ name }) => name).sort();
const commands = [];
function run(command, args, visible = true) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8' });
  const label = [command === process.execPath ? 'node' : command, ...args].join(' ');
  commands.push({ command: label, exitCode: result.status, signal: result.signal });
  if (visible) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
  }
  console.log(`exit ${result.status}: ${label}`);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, label);
  return result.stdout.trim();
}

try {
  const sha = run('git', ['rev-parse', 'HEAD'], false);
  const status = run('git', ['status', '--porcelain'], false);
  const versions = {
    node: process.version,
    npm: run('npm', ['--version'], false),
    git: run('git', ['--version'], false),
    typescript: read('node_modules/typescript/package.json').version,
    vitest: read('node_modules/vitest/package.json').version,
    sdk: read('node_modules/@modelcontextprotocol/server/package.json').version,
  };
  console.log(
    JSON.stringify(
      {
        sha,
        dirty: status !== '',
        status,
        versions,
        reference: { node: 'v20.19.2', npm: '9.2.0' },
      },
      null,
      2,
    ),
  );
  // Standalone, even before npm test or npm run build, and from any cwd.
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);
  const { bootstrap } = await import(new URL('../build/main/bootstrap.js', import.meta.url));
  const defaults = { INFOMANIAK_API_TOKEN: 'MVP_PROVIDER_SENTINEL' };
  const all = {
    ...defaults,
    INFOMANIAK_ALLOW_RAW_API: 'true',
    INFOMANIAK_ALLOW_EXPERIMENTAL: 'true',
    KCHAT_HOST: 'chat.example.test',
    KCHAT_TOKEN: 'MVP_CHAT_SENTINEL',
  };
  const options = {
    fetch: async () => {
      throw new Error('Provider I/O forbidden during inventory verification');
    },
    clock: {
      now: () => 0,
      wait: async () => {
        throw new Error('Unexpected wait');
      },
    },
  };
  const complete = await bootstrap(all, options);
  const normal = await bootstrap(defaults, options);
  const baseline = read('test/fixtures/baseline-tools.json');
  const inventory = read('product/inventory/tools.json');
  const files = readdirSync(join(root, 'src/features'))
    .filter((name) => name.endsWith('.feature.ts'))
    .sort();
  const definitions = await Promise.all(
    files.map(
      (file) =>
        import(pathToFileURL(join(root, 'build/features', file.replace('.ts', '.js'))).href),
    ),
  );
  const declarations = definitions.flatMap((definition) => definition.tools);
  for (const entries of [baseline, inventory, declarations, complete.module.tools]) {
    assert.ok(Array.isArray(entries));
    assert.equal(entries.length, 132);
    assert.equal(new Set(names(entries)).size, entries.length, 'Duplicate inventory/registry name');
    assert.deepEqual(names(entries), names(baseline), 'Baseline orphan or unexpected tool');
  }
  assert.equal(files.length, 10);
  assert.equal(normal.module.tools.length, 83);
  const visibility = [];
  for (const raw of [false, true])
    for (const experimental of [false, true])
      for (const chat of [false, true]) {
        const configuration = {
          ...defaults,
          INFOMANIAK_ALLOW_RAW_API: String(raw),
          INFOMANIAK_ALLOW_EXPERIMENTAL: String(experimental),
          ...(chat ? { KCHAT_HOST: all.KCHAT_HOST, KCHAT_TOKEN: all.KCHAT_TOKEN } : {}),
        };
        const runtime = await bootstrap(configuration, options);
        const readonly = await bootstrap(
          { ...configuration, INFOMANIAK_READ_ONLY: 'true' },
          options,
        );
        const expected = complete.module.tools.filter(
          (tool) =>
            (!tool.experimental || experimental) &&
            (!tool.rawApi || raw) &&
            (!tool.name.startsWith('infomaniak_kchat_') || chat),
        );
        assert.deepEqual(names(runtime.module.tools), names(expected));
        assert.deepEqual(names(readonly.module.tools), names(expected));
        visibility.push({ raw, experimental, chat, visible: expected.length });
      }
  for (const tool of complete.module.tools) {
    const entry = inventory.find((value) => value.name === tool.name);
    const index = definitions.findIndex((definition) =>
      definition.tools.some((value) => value.name === tool.name),
    );
    assert.equal(entry.useCase, tool.description);
    for (const key of ['classification', 'idempotent', 'limits', 'experimental', 'rawApi'])
      assert.deepEqual(entry[key], tool[key], `${tool.name}: ${key}`);
    assert.deepEqual(entry.methodPolicy, tool.methodPolicy ?? null);
    assert.deepEqual(entry.schemas.input, z.toJSONSchema(tool.inputSchema));
    assert.deepEqual(entry.schemas.output, z.toJSONSchema(tool.outputSchema));
    assert.deepEqual(entry.handler, {
      module: `src/features/${files[index]}`,
      export: 'createHandlers',
      key: tool.name,
    });
    assert.ok(['official', 'baseline', 'unproven'].includes(entry.proof));
    assert.ok(entry.endpoint.path.startsWith('/'));
    assert.ok(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'input'].includes(entry.endpoint.method));
    assert.ok(entry.evidence.sources.length > 0);
    for (const path of [entry.evidence.fixture, entry.evidence.tests])
      readFileSync(join(root, path));
    const fixture = read(entry.evidence.fixture);
    const endpoint = tool.endpoint ?? fixture.endpoints?.find((value) => value.name === tool.name);
    if (endpoint) {
      assert.equal(entry.endpoint.method, endpoint.method);
      assert.equal(entry.endpoint.path, endpoint.path);
      assert.equal(entry.proof, endpoint.proof);
    }
    console.log(
      JSON.stringify({
        tool: tool.name,
        registry: 'bound (bootstrap rejects missing handlers)',
        schemas: 'match',
        proof: entry.proof,
        endpoint: entry.endpoint,
        evidence: entry.evidence.tests,
        provider: 'non prouvé côté fournisseur',
      }),
    );
  }
  console.log(
    JSON.stringify(
      {
        inventory: inventory.length,
        uniqueNames: new Set(names(inventory)).size,
        featureModules: files.length,
        visibility,
      },
      null,
      2,
    ),
  );
  console.log('orphan tools: 0');
  const reportFile = join(temporary, 'vitest.json');
  run(process.execPath, [
    'node_modules/vitest/vitest.mjs',
    'run',
    'test/acceptance/mvp-demo.test.ts',
    'test/transports/stdio-2026.test.ts',
    'test/transports/http-2026.test.ts',
    'test/interop/mcp-2025.test.ts',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${reportFile}`,
  ]);
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  assert.equal(report.success, true);
  const assertions = report.testResults.flatMap((result) => result.assertionResults);
  const matrix = [];
  for (const era of ['modern', 'legacy'])
    for (const transport of ['stdio', 'http']) {
      const name = `${era} ${transport}: discovery, read-only, refusals, DTO and cycles on doubles`;
      const cases = assertions.filter((test) => test.title === name);
      assert.equal(cases.length, 1, `Missing matrix cell: ${name}`);
      assert.equal(cases[0].status, 'passed');
      matrix.push({
        protocol: era === 'modern' ? '2026-07-28' : '2025-11-25',
        transport,
        status: 'PASS',
      });
    }
  console.log(
    JSON.stringify(
      {
        matrix,
        suites: report.testResults.map((result) => ({
          file: result.name.replace(root, ''),
          tests: result.assertionResults.length,
          status: result.status,
        })),
        commands,
      },
      null,
      2,
    ),
  );
  console.log(
    'Cycles kDrive et Calendar DST sur doubles : non prouvé côté fournisseur (non prouvés côté fournisseur).',
  );
  console.log(
    'C3 : aucune ressource sandbox créée ; nettoyage sans objet. Doubles et écoute locale uniquement.',
  );
  console.log('MVP OFFLINE PASS');
} catch (error) {
  console.error('MVP OFFLINE FAIL:', error instanceof Error ? error.message : String(error));
  console.error(JSON.stringify({ commands }, null, 2));
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
