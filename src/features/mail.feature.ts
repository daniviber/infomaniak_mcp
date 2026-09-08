import { createMailHandlers } from '../application/mail/mail.feature.js';
import { MailAdapter } from '../adapters/outbound/infomaniak/mail.adapter.js';
import type { InfomaniakGateway } from '../adapters/outbound/infomaniak/gateway.js';

export { tools } from '../application/mail/mail.feature.js';
export function createHandlers(deps: {
  config: { mailToken: string; transfer: { downloadLimit: number } };
  createGateway(options: { token: string; base?: string }): InfomaniakGateway;
}) {
  return createMailHandlers(
    new MailAdapter(
      deps.createGateway({ token: deps.config.mailToken, base: 'https://mail.infomaniak.com/api' }),
      deps.config.transfer.downloadLimit,
    ),
  );
}
