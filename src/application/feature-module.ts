import type { InvocationContext, ToolContract, ToolResult } from '../domain/tool-contract.js';
import { enforcePolicy } from './policy.js';

export interface FeatureModule {
  readonly tools: readonly ToolContract[];
  invoke(name: string, input: unknown, context: InvocationContext): Promise<ToolResult>;
}

export interface ToolBinding {
  readonly contract: ToolContract;
  readonly handle: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createFeatureModule(bindings: readonly ToolBinding[]): FeatureModule {
  const handlers = new Map<string, ToolBinding>();
  for (const binding of bindings) {
    if (handlers.has(binding.contract.name))
      throw new Error(`Duplicate tool: ${binding.contract.name}`);
    if (typeof binding.handle !== 'function')
      throw new Error(`Missing handler: ${binding.contract.name}`);
    handlers.set(binding.contract.name, binding);
  }
  return {
    tools: bindings.map(({ contract }) => contract),
    async invoke(name, input, context) {
      const binding = handlers.get(name);
      if (!binding) throw new Error(`Unknown tool: ${name}`);
      const denied = enforcePolicy(binding.contract, context, input);
      if (denied) return denied;
      const parsed = binding.contract.inputSchema.parse(input);
      const output = await binding.handle(parsed);
      const structuredContent = binding.contract.outputSchema.parse(output);
      return {
        content: [{ type: 'text', text: binding.contract.text(structuredContent) }],
        structuredContent,
        resultType: 'complete',
        _meta: {},
      };
    },
  };
}
