import {
  createTransferFeature,
  type TransferOptions,
} from '../application/drive/transfer.feature.js';
import { KDriveTransferAdapter } from '../adapters/outbound/infomaniak/kdrive-transfer.adapter.js';
import type { InfomaniakGateway } from '../adapters/outbound/infomaniak/gateway.js';
import type { InvocationContext } from '../domain/tool-contract.js';

export { tools } from '../application/drive/transfer.feature.js';

export function createHandlers(deps: {
  gateway: InfomaniakGateway;
  config: { policy: InvocationContext; transfer?: TransferOptions };
}): Record<string, (input: unknown) => Promise<Record<string, unknown>>> {
  const module = createTransferFeature(
    new KDriveTransferAdapter(deps.gateway),
    deps.config.transfer,
  );
  return Object.fromEntries(
    module.tools.map((tool) => [
      tool.name,
      async (input: unknown) =>
        (await module.invoke(tool.name, input, deps.config.policy)).structuredContent,
    ]),
  );
}
