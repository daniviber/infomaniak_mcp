import { createCoreBindings, tools as coreTools } from '../application/core/core.feature.js';
import {
  createDomainBindings,
  tools as domainTools,
} from '../application/domain/domain.feature.js';
import { createFeatureModule } from '../application/feature-module.js';
import { CoreDomainAdapter } from '../adapters/outbound/infomaniak/core-domain.adapter.js';
import type { InfomaniakGateway } from '../adapters/outbound/infomaniak/gateway.js';
import type { InvocationContext } from '../domain/tool-contract.js';

export const tools = [...coreTools, ...domainTools];
export function createHandlers(deps: {
  gateway: InfomaniakGateway;
  config: { policy: InvocationContext };
}): Record<string, (input: unknown) => Promise<Record<string, unknown>>> {
  const adapter = new CoreDomainAdapter(deps.gateway);
  const module = createFeatureModule([
    ...createCoreBindings(adapter),
    ...createDomainBindings(adapter),
  ]);
  return Object.fromEntries(
    module.tools.map((tool) => [
      tool.name,
      async (input: unknown) =>
        (await module.invoke(tool.name, input, deps.config.policy)).structuredContent,
    ]),
  );
}

export function selectTools(deps: { config: { policy: InvocationContext } }) {
  return tools.filter((tool) => !tool.experimental || deps.config.policy.allowExperimental);
}
