import { createChatHandlers, tools } from '../application/chat/chat.feature.js';
import { KChatAdapter } from '../adapters/outbound/kchat/kchat.adapter.js';
import type { InfomaniakGateway } from '../adapters/outbound/infomaniak/gateway.js';

export { tools };
type Dependencies = {
  gateway: InfomaniakGateway;
  config: { kchat?: { host: string; token: string } };
  createGateway(options: { token: string; base?: string }): InfomaniakGateway;
};
export function selectTools(deps: Dependencies) {
  return deps.config.kchat ? tools : [];
}
export function createHandlers(
  deps: Dependencies,
): Record<string, (input: unknown) => Promise<Record<string, unknown>>> {
  const config = deps.config.kchat;
  if (!config) return {};
  const gateway = deps.createGateway({
    token: config.token,
    base: `https://${config.host}/api/v4`,
  });
  return createChatHandlers(new KChatAdapter(gateway));
}
