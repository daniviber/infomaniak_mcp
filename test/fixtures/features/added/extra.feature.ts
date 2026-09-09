import { z } from 'zod';
import type { ToolContract } from '../../../../src/domain/tool-contract.js';
import type { InfomaniakGateway } from '../../../../src/adapters/outbound/infomaniak/gateway.js';

export const tools: readonly ToolContract[] = [
  {
    name: 'fixture_extra',
    description: 'Proves generic composition of an additional module.',
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    classification: 'read',
    rawApi: false,
    idempotent: true,
    limits: {},
    experimental: false,
    text: () => 'extra',
  },
];
export function createHandlers(deps: {
  config: { token: string };
  createGateway(options: { token: string; base?: string }): InfomaniakGateway;
}) {
  const gateway = deps.createGateway({ token: deps.config.token, base: 'https://fixture.example' });
  return {
    fixture_extra: () =>
      gateway.request({ method: 'GET', pathSegments: ['extra'] }, z.object({ ok: z.boolean() })),
  };
}
