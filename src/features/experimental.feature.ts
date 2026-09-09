import {
  createExperimentalBindings,
  tools,
} from '../application/experimental/experimental.feature.js';
import { experimentalPolicy } from '../application/experimental/experimental-policy.js';
import { createFeatureModule } from '../application/feature-module.js';
import { ExperimentalAdapter } from '../adapters/outbound/infomaniak/experimental.adapter.js';
import type { InfomaniakGateway } from '../adapters/outbound/infomaniak/gateway.js';
import type { InvocationContext } from '../domain/tool-contract.js';

export { tools };
type Dependencies = {
  gateway: InfomaniakGateway;
  config: {
    policy: InvocationContext;
    token: string;
    calendarToken?: string;
    kchat?: { token: string };
  };
};
export function selectTools(deps: Dependencies) {
  const policy = experimentalPolicy(deps.config.policy);
  return tools.filter((tool) => policy.enabled && (!tool.rawApi || policy.allowRawApi));
}
export function createHandlers(
  deps: Dependencies,
): Record<string, (input: unknown) => Promise<Record<string, unknown>>> {
  const policy = experimentalPolicy(deps.config.policy);
  const selected = new Set(selectTools(deps).map((tool) => tool.name));
  const module = createFeatureModule(
    createExperimentalBindings(
      new ExperimentalAdapter(deps.gateway, [
        deps.config.token,
        deps.config.calendarToken ?? '',
        deps.config.kchat?.token ?? '',
      ]),
    ).filter((binding) => selected.has(binding.contract.name)),
  );
  return Object.fromEntries(
    module.tools.map((tool) => [
      tool.name,
      async (input: unknown) =>
        (
          await module.invoke(tool.name, input, {
            readOnly: policy.readOnly,
            allowRawApi: policy.allowRawApi,
            allowExperimental: policy.enabled,
          })
        ).structuredContent,
    ]),
  );
}
