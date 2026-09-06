import { z } from 'zod';

export const policyErrorSchema = z.object({
  error: z.object({
    code: z.literal('POLICY_DENIED'),
    reason: z.enum(['read_only', 'raw_api_disabled', 'experimental_disabled']),
    tool: z.string(),
  }),
});
