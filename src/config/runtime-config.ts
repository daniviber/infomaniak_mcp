import { z } from 'zod';

const boolean = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
  .transform((value) => ['true', '1', 'yes', 'on'].includes(value));
const configuration = z.object({
  INFOMANIAK_API_TOKEN: z.string().min(1),
  INFOMANIAK_CALENDAR_TOKEN: z.string().min(1).optional(),
  INFOMANIAK_READ_ONLY: boolean.default(false),
  INFOMANIAK_ALLOW_RAW_API: boolean.default(false),
  INFOMANIAK_ALLOW_EXPERIMENTAL: boolean.default(false),
  INFOMANIAK_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  MCP_TOOLS_TTL_MS: z.coerce.number().int().nonnegative().default(60000),
});

export function loadRuntimeConfig(env: Readonly<Record<string, string | undefined>>) {
  const parsed = configuration.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid runtime configuration: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  const value = parsed.data;
  return Object.freeze({
    token: value.INFOMANIAK_API_TOKEN,
    calendarToken: value.INFOMANIAK_CALENDAR_TOKEN ?? value.INFOMANIAK_API_TOKEN,
    timeoutMs: value.INFOMANIAK_TIMEOUT_MS,
    toolsTtlMs: value.MCP_TOOLS_TTL_MS,
    policy: Object.freeze({
      readOnly: value.INFOMANIAK_READ_ONLY,
      allowRawApi: value.INFOMANIAK_ALLOW_RAW_API,
      allowExperimental: value.INFOMANIAK_ALLOW_EXPERIMENTAL,
    }),
  });
}
