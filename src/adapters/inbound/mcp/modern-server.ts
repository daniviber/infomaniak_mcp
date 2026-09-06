import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { FeatureModule } from '../../../application/feature-module.js';
import type { InvocationContext } from '../../../domain/tool-contract.js';

export function createModernServerFactory(
  module: FeatureModule,
  context: InvocationContext,
  toolsTtlMs = 60000,
) {
  return () => {
    const server = new McpServer(
      { name: 'infomaniak-mcp-server', version: '1.1.0' },
      {
        cacheHints: { 'tools/list': { ttlMs: toolsTtlMs, cacheScope: 'private' } },
      },
    );
    for (const tool of module.tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: {
            readOnlyHint: tool.classification === 'read',
            destructiveHint: tool.classification === 'destructive',
            idempotentHint: tool.idempotent,
            openWorldHint: true,
          },
          _meta: {
            classification: tool.classification,
            rawApi: tool.rawApi,
            experimental: tool.experimental,
            limits: tool.limits,
          },
        },
        async (input): Promise<CallToolResult> => ({
          ...(await module.invoke(tool.name, input, context)),
        }),
      );
    }
    return server;
  };
}

export function createModernServer(
  module: FeatureModule,
  context: InvocationContext,
  toolsTtlMs = 60000,
) {
  return createMcpHandler(createModernServerFactory(module, context, toolsTtlMs), {
    legacy: 'reject',
    responseMode: 'json',
  });
}
