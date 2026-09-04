import type { InvocationContext, ToolContract, ToolResult } from '../domain/tool-contract.js';

export function enforcePolicy(
  tool: ToolContract,
  context: InvocationContext,
): ToolResult | undefined {
  const reason =
    context.readOnly && tool.classification !== 'read'
      ? 'read_only'
      : tool.rawApi && !context.allowRawApi
        ? 'raw_api_disabled'
        : tool.experimental && !context.allowExperimental
          ? 'experimental_disabled'
          : undefined;
  if (!reason) return undefined;
  return {
    content: [{ type: 'text', text: `[POLICY_DENIED] ${reason}: ${tool.name}` }],
    structuredContent: { error: { code: 'POLICY_DENIED', reason, tool: tool.name } },
    isError: true,
    resultType: 'complete',
    _meta: {},
  };
}
