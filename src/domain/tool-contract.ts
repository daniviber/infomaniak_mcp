import { z } from 'zod';

export interface InvocationContext {
  readonly readOnly: boolean;
  readonly allowRawApi: boolean;
  readonly allowExperimental: boolean;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
  resultType: 'complete';
  _meta: Record<string, unknown>;
}

export interface ToolContract {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly outputSchema: z.ZodObject;
  readonly classification: 'read' | 'write' | 'destructive';
  readonly rawApi: boolean;
  /** Dynamic HTTP tools must explicitly supply this method before a read-only invocation. */
  readonly methodPolicy?: { readonly inputField: string; readonly readOnlyMethod: 'GET' };
  readonly idempotent: boolean;
  /** Null means the contract specifies no additional numeric bound. */
  readonly limits: Readonly<Record<string, number | null>>;
  readonly experimental: boolean;
  readonly text: (output: Record<string, unknown>) => string;
}

export const policyErrorSchema = z.object({
  error: z.object({
    code: z.literal('POLICY_DENIED'),
    reason: z.enum(['read_only', 'raw_api_disabled', 'experimental_disabled']),
    tool: z.string(),
  }),
});
