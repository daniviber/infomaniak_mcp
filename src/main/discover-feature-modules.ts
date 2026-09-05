import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createFeatureModule,
  type FeatureModule,
  type ToolBinding,
} from '../application/feature-module.js';
import type { ToolContract } from '../domain/tool-contract.js';
import type { InfomaniakGateway, GatewayClock } from '../adapters/outbound/infomaniak/gateway.js';
import type { loadRuntimeConfig } from '../config/runtime-config.js';

export interface FeatureDependencies {
  gateway: InfomaniakGateway;
  config: ReturnType<typeof loadRuntimeConfig>;
  clock: GatewayClock;
  createGateway(options: { token: string; base?: string }): InfomaniakGateway;
}

export interface FeatureDefinition {
  tools: readonly ToolContract[];
  selectTools?(deps: FeatureDependencies): readonly ToolContract[];
  createHandlers(
    deps: FeatureDependencies,
  ): Record<string, (input: unknown) => Promise<Record<string, unknown>>>;
}

export function composeFeatureModules(
  definitions: readonly FeatureDefinition[],
  deps: FeatureDependencies,
): FeatureModule {
  const bindings: ToolBinding[] = definitions.flatMap((definition) => {
    const selected = definition.selectTools ? definition.selectTools(deps) : definition.tools;
    const catalogue = new Map(definition.tools.map((contract) => [contract.name, contract]));
    const names = new Set<string>();
    for (const contract of selected) {
      if (!catalogue.has(contract.name)) throw new Error(`Undeclared tool: ${contract.name}`);
      if (names.has(contract.name)) throw new Error(`Duplicate tool: ${contract.name}`);
      names.add(contract.name);
    }
    const handlers = definition.createHandlers(deps);
    return selected.map((selection) => {
      const contract = catalogue.get(selection.name)!;
      const handler = handlers[contract.name];
      if (typeof handler !== 'function') throw new Error(`Missing handler: ${contract.name}`);
      return { contract, handle: (input: Record<string, unknown>) => handler(input) };
    });
  });
  bindings.sort((a, b) =>
    a.contract.name < b.contract.name ? -1 : a.contract.name > b.contract.name ? 1 : 0,
  );
  return createFeatureModule(bindings);
}

export async function discoverFeatureModules(
  pattern = 'src/features/**/*.feature.js',
  deps: FeatureDependencies,
): Promise<FeatureModule> {
  const absolute = resolve(pattern);
  const wildcard = absolute.indexOf('*');
  if (wildcard === -1)
    return composeFeatureModules(
      [(await import(pathToFileURL(absolute).href)) as FeatureDefinition],
      deps,
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
  let entries: string[];
  try {
    entries = await readdir(directory, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    entries = [];
  }
  const names = entries.filter((name) => matcher.test(name)).sort();
  const definitions: FeatureDefinition[] = [];
  for (const name of names) {
    const definition = (await import(
      pathToFileURL(resolve(directory, name)).href
    )) as FeatureDefinition;
    definitions.push(definition);
  }
  return composeFeatureModules(definitions, deps);
}
