import { readdirSync, readFileSync } from 'node:fs';
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

function violations(path: string, layer: 'domain' | 'application' | 'adapters'): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const errors: string[] = [];
  function checkImport(specifier: string) {
    if (specifier.startsWith('.')) {
      const target = relative(root, resolve(dirname(path), specifier)).split('/')[0];
      const allowed =
        layer === 'domain'
          ? ['domain']
          : layer === 'application'
            ? ['application', 'domain']
            : ['adapters', 'application', 'domain'];
      if (!allowed.includes(target)) errors.push(`${layer} -> ${target}`);
    } else if (layer !== 'adapters' && specifier !== 'zod') errors.push(`${layer} -> ${specifier}`);
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
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier)) checkImport(specifier.text);
      else errors.push('Nonliteral dependency');
    }
    if (
      layer !== 'adapters' &&
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
    for (const layer of ['domain', 'application', 'adapters'] as const) {
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
