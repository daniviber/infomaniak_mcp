import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createFeatureModule,
  type FeatureModule,
  type ToolBinding,
} from '../application/feature-module.js';
import type { ToolContract } from '../domain/tool-contract.js';
import type { WalkingSkeletonPorts } from '../features/walking-skeleton.feature.js';

export interface FeatureDefinition {
  tools: readonly ToolContract[];
  handlers: Record<
    string,
    (ports: WalkingSkeletonPorts, input: unknown) => Promise<Record<string, unknown>>
  >;
}

export function composeFeatureModules(
  definitions: readonly FeatureDefinition[],
  ports: WalkingSkeletonPorts,
): FeatureModule {
  const bindings: ToolBinding[] = definitions.flatMap((definition) =>
    definition.tools.map((contract) => {
      const handler = definition.handlers[contract.name];
      if (typeof handler !== 'function') throw new Error(`Missing handler: ${contract.name}`);
      return { contract, handle: (input: Record<string, unknown>) => handler(ports, input) };
    }),
  );
  bindings.sort((a, b) =>
    a.contract.name < b.contract.name ? -1 : a.contract.name > b.contract.name ? 1 : 0,
  );
  return createFeatureModule(bindings);
}

export async function discoverFeatureModules(
  pattern = 'src/features/**/*.feature.js',
  ports: WalkingSkeletonPorts,
): Promise<FeatureModule> {
  const absolute = resolve(pattern);
  const wildcard = absolute.indexOf('*');
  if (wildcard === -1)
    return composeFeatureModules(
      [(await import(pathToFileURL(absolute).href)) as FeatureDefinition],
      ports,
    );
  const directory = absolute.slice(0, absolute.lastIndexOf('/', wildcard));
  const suffix = absolute.slice(directory.length + 1);
  const expression = suffix
    .split('**/')
    .map((part) =>
      part
        .split('*')
        .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('(?:.*/)?');
  const matcher = new RegExp(`^${expression}$`);
  const names = (await readdir(directory, { recursive: true }))
    .filter((name) => matcher.test(name))
    .sort();
  const definitions: FeatureDefinition[] = [];
  const tools = new Set<string>();
  for (const name of names) {
    const definition = (await import(
      pathToFileURL(resolve(directory, name)).href
    )) as FeatureDefinition;
    for (const tool of definition.tools) {
      if (tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
      if (typeof definition.handlers?.[tool.name] !== 'function')
        throw new Error(`Missing handler: ${tool.name}`);
      tools.add(tool.name);
    }
    definitions.push(definition);
  }
  return composeFeatureModules(definitions, ports);
}
