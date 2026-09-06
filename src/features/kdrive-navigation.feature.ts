import { createNavigationBindings } from '../application/drive/navigation.feature.js';
import { createFeatureModule } from '../application/feature-module.js';
import { KDriveNavigationAdapter } from '../adapters/outbound/infomaniak/kdrive-navigation.adapter.js';
import type { InfomaniakGateway } from '../adapters/outbound/infomaniak/gateway.js';
import type { InvocationContext } from '../domain/tool-contract.js';

export { tools } from '../application/drive/navigation.feature.js';

export function createHandlers(deps: {
  gateway: InfomaniakGateway;
  config: { policy: InvocationContext };
}): Record<string, (input: unknown) => Promise<Record<string, unknown>>> {
  const module = createFeatureModule(
    createNavigationBindings(new KDriveNavigationAdapter(deps.gateway)),
  );
  return Object.fromEntries(
    module.tools.map((tool) => [
      tool.name,
      async (input: unknown) =>
        (await module.invoke(tool.name, input, deps.config.policy)).structuredContent,
    ]),
  );
}
