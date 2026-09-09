import { createModernServer } from '../adapters/inbound/mcp/modern-server.js';
import {
  InfomaniakGateway,
  TokenBucket,
  type GatewayClock,
} from '../adapters/outbound/infomaniak/gateway.js';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { discoverFeatureModules } from './discover-feature-modules.js';

export async function createRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: {
    fetch?: typeof fetch;
    clock?: GatewayClock;
    random?: () => number;
    utcNow?: () => number;
    pattern?: string;
  } = {},
) {
  const config = loadRuntimeConfig(env);
  const clock = options.clock ?? {
    now: () => performance.now(),
    wait: (milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  };
  const bucket = new TokenBucket(clock);
  const createGateway = ({ token, base }: { token: string; base?: string }) =>
    new InfomaniakGateway({
      token,
      base,
      timeoutMs: config.timeoutMs,
      bucket,
      fetch: options.fetch ?? fetch,
      clock,
      random: options.random ?? Math.random,
      utcNow: options.utcNow ?? Date.now,
    });
  const module = await discoverFeatureModules(options.pattern, {
    gateway: createGateway({ token: config.token }),
    createGateway,
    config,
    clock,
  });
  return createModernServer(module, config.policy, config.toolsTtlMs);
}
