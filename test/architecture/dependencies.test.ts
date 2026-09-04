import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve('src');
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

type Layer = 'domain' | 'application' | 'adapters' | 'features' | 'main';
function violations(path: string, layer: Layer, text = readFileSync(path, 'utf8')): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const errors: string[] = [];
  function checkImport(specifier: string) {
    if (specifier.startsWith('.')) {
      const target = relative(root, resolve(dirname(path), specifier)).split('/')[0];
      const allowed: Record<Layer, string[]> = {
        domain: ['domain'],
        application: ['application', 'domain'],
        adapters: ['adapters', 'application', 'domain'],
        features: ['application', 'adapters', 'domain'],
        main: ['main', 'config', 'adapters', 'application', 'domain'],
      };
      if (!allowed[layer].includes(target)) errors.push(`${layer} -> ${target}`);
      if (
        layer === 'main' &&
        target === 'adapters' &&
        ![
          'adapters/inbound/mcp/modern-server.js',
          'adapters/outbound/infomaniak/gateway.js',
        ].includes(relative(root, resolve(dirname(path), specifier)))
      )
        errors.push('main -> family adapter');
    } else if (!['adapters', 'main'].includes(layer) && specifier !== 'zod')
      errors.push(`${layer} -> ${specifier}`);
    if (specifier.startsWith('@modelcontextprotocol/sdk')) errors.push('SDK v1');
  }
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkImport(node.moduleSpecifier.text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      checkImport(node.argument.literal.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier)) checkImport(specifier.text);
      else if (
        path !== resolve(root, 'main/discover-feature-modules.ts') ||
        node.expression.kind !== ts.SyntaxKind.ImportKeyword
      )
        errors.push('Nonliteral dependency');
    }
    if (
      !['adapters', 'main'].includes(layer) &&
      ts.isIdentifier(node) &&
      ['fetch', 'process', 'XMLHttpRequest'].includes(node.text)
    )
      errors.push(`${layer} -> ${node.text}`);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}

describe('dependency direction', () => {
  it('accepts adapters -> application -> domain throughout the modern tree', () => {
    for (const layer of ['domain', 'application', 'adapters', 'features', 'main'] as const) {
      if (layer === 'features' && !existsSync(resolve(root, layer))) continue;
      for (const path of files(resolve(root, layer)))
        expect(violations(path, layer), path).toEqual([]);
    }
  });
  it('rejects the same inverted import in a domain fixture', () => {
    expect(
      violations(resolve('test/architecture/fixtures/invalid-domain-import.ts'), 'domain'),
    ).toEqual(['domain -> adapters']);
  });
});

describe('two composition layers, including when production features are empty', () => {
  it.each(['import', 'import type', 'export', 'export type'])(
    'accepts feature dependencies using %s',
    (syntax) => {
      for (const target of [
        'application/feature-module',
        'adapters/outbound/infomaniak/gateway',
        'domain/tool-contract',
      ]) {
        expect(
          violations(
            resolve(root, 'features/example.feature.ts'),
            'features',
            `${syntax} { Example } from '../${target}.js';`,
          ),
        ).toEqual([]);
      }
    },
  );
  it.each(['import', 'import type', 'export', 'export type'])(
    'rejects forbidden feature dependencies using %s',
    (syntax) => {
      for (const [target, layer] of [
        ['../config/runtime-config', 'config'],
        ['../main/index', 'main'],
        ['./other.feature', 'features'],
      ]) {
        expect(
          violations(
            resolve(root, 'features/example.feature.ts'),
            'features',
            `${syntax} { Example } from '${target}.js';`,
          ),
        ).toEqual([`features -> ${layer}`]);
      }
    },
  );
  it('rejects feature environment access and dynamic forbidden imports', () => {
    for (const [target, layer] of [
      ['../config/runtime-config', 'config'],
      ['../main/index', 'main'],
      ['./other.feature', 'features'],
    ]) {
      expect(
        violations(
          resolve(root, 'features/example.feature.ts'),
          'features',
          `type Example = import('${target}.js').Example;`,
        ),
      ).toEqual([`features -> ${layer}`]);
    }
    expect(
      violations(
        resolve(root, 'features/example.feature.ts'),
        'features',
        'const token = process.env.TOKEN;',
      ),
    ).toEqual(['features -> process']);
    expect(
      violations(
        resolve(root, 'features/example.feature.ts'),
        'features',
        "import('../config/runtime-config.js');",
      ),
    ).toEqual(['features -> config']);
  });
  it('accepts main bootstrap dependencies and rejects family adapters or direct feature wiring', () => {
    for (const target of [
      './discover-feature-modules',
      '../config/runtime-config',
      '../adapters/outbound/infomaniak/gateway',
      '../adapters/inbound/mcp/modern-server',
    ]) {
      expect(
        violations(
          resolve(root, 'main/index.ts'),
          'main',
          `import { Example } from '${target}.js';`,
        ),
      ).toEqual([]);
    }
    expect(
      violations(
        resolve(root, 'main/index.ts'),
        'main',
        "import type { Example } from '../adapters/outbound/infomaniak/drive-list.adapter.js';",
      ),
    ).toEqual(['main -> family adapter']);
    expect(
      violations(
        resolve(root, 'main/index.ts'),
        'main',
        "import { Example } from '../features/example.feature.js';",
      ),
    ).toEqual(['main -> features']);
  });
});
