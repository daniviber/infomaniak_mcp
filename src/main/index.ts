import { createModernServer } from '../adapters/inbound/mcp/modern-server.js';
import { CalendarCreateAdapter } from '../adapters/outbound/infomaniak/calendar-create.adapter.js';
import { DriveListAdapter } from '../adapters/outbound/infomaniak/drive-list.adapter.js';
import {
  InfomaniakGateway,
  TokenBucket,
  type GatewayClock,
} from '../adapters/outbound/infomaniak/gateway.js';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { discoverFeatureModules } from './discover-feature-modules.js';

export async function createRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { fetch?: typeof fetch; clock?: GatewayClock; pattern?: string } = {},
) {
  const config = loadRuntimeConfig(env);
  const bucket = new TokenBucket(
    options.clock ?? {
      now: () => performance.now(),
      wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    },
  );
  const gateway = (token: string) =>
    new InfomaniakGateway({
      token,
      timeoutMs: config.timeoutMs,
      bucket,
      fetch: options.fetch ?? fetch,
    });
  const module = await discoverFeatureModules(options.pattern, {
    drive: new DriveListAdapter(gateway(config.token)),
    calendar: new CalendarCreateAdapter(gateway(config.calendarToken)),
  });
  return createModernServer(module, config.policy, config.toolsTtlMs);
}
