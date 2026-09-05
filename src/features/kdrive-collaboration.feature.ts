import { createCollaborationBindings } from '../application/drive/collaboration.feature.js';
import { createFeatureModule } from '../application/feature-module.js';
import { KDriveCollaborationAdapter } from '../adapters/outbound/infomaniak/kdrive-collaboration.adapter.js';
import type { InfomaniakGateway } from '../adapters/outbound/infomaniak/gateway.js';
import type { InvocationContext } from '../domain/tool-contract.js';

export { tools } from '../application/drive/collaboration.feature.js';
export function createHandlers(deps: {
  gateway: InfomaniakGateway;
  config: { policy: InvocationContext };
}): Record<string, (input: unknown) => Promise<Record<string, unknown>>> {
  const module = createFeatureModule(
    createCollaborationBindings(new KDriveCollaborationAdapter(deps.gateway)),
  );
  return Object.fromEntries(
    module.tools.map((tool) => [
      tool.name,
      async (input: unknown) =>
        (await module.invoke(tool.name, input, deps.config.policy)).structuredContent,
    ]),
  );
}
