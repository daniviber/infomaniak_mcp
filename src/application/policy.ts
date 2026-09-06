import type { InvocationContext, ToolContract, ToolResult } from '../domain/tool-contract.js';

export function enforcePolicy(
  tool: ToolContract,
  context: InvocationContext,
  input?: unknown,
): ToolResult | undefined {
  const methodAllowed = tool.methodPolicy
    ? typeof input === 'object' &&
      input !== null &&
      !Array.isArray(input) &&
      Object.hasOwn(input, tool.methodPolicy.inputField) &&
      (input as Record<string, unknown>)[tool.methodPolicy.inputField] ===
        tool.methodPolicy.readOnlyMethod
    : tool.classification === 'read';
  const reason =
    context.readOnly && !methodAllowed
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
