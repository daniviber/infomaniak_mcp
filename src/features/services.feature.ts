import { createServicesBindings } from '../application/services/services.feature.js';
import { createFeatureModule } from '../application/feature-module.js';
import { ServicesAdapter } from '../adapters/outbound/infomaniak/services.adapter.js';
import type { InfomaniakGateway } from '../adapters/outbound/infomaniak/gateway.js';
import type { InvocationContext } from '../domain/tool-contract.js';

export { tools } from '../application/services/services.feature.js';

export function createHandlers(deps: {
  gateway: InfomaniakGateway;
  config: { policy: InvocationContext };
}): Record<string, (input: unknown) => Promise<Record<string, unknown>>> {
  const adapter = new ServicesAdapter(deps.gateway);
  const module = createFeatureModule(createServicesBindings(adapter));
  return Object.fromEntries(
    module.tools.map((tool) => [
      tool.name,
      async (input: unknown) =>
        (await module.invoke(tool.name, input, deps.config.policy)).structuredContent,
    ]),
  );
}
