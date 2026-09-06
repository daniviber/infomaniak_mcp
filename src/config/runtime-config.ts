import { z } from 'zod';
import { isIP } from 'node:net';
import {
  BODY_LIMIT,
  DOWNLOAD_LIMIT,
  UPLOAD_LIMIT,
  ENVELOPE_RESERVE,
} from '../application/drive/transfer.feature.js';

const integer = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative());
const hostname = z
  .string()
  .refine(
    (value) =>
      isIP(value) !== 0 ||
      value === '[::1]' ||
      /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(
        value,
      ),
  );
const hostList = z
  .string()
  .transform((value) => value.split(',').map((part) => part.trim()))
  .pipe(z.array(hostname).min(1));
const originList = z
  .string()
  .transform((value) => value.split(',').map((part) => part.trim()))
  .pipe(
    z
      .array(
        z.string().refine((value) => {
          try {
            const url = new URL(value);
            return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
          } catch {
            return false;
          }
        }),
      )
      .min(1),
  );
const bodyLimit = z
  .string()
  .regex(/^\d+(?:\.\d+)?\s*(?:b|kb|mb|gb)?$/i)
  .transform((value) => {
    const [, amount, unit = 'b'] = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(value)!;
    return Number(amount) * 1024 ** ['b', 'kb', 'mb', 'gb'].indexOf(unit.toLowerCase());
  })
  .pipe(z.number().int().min(ENVELOPE_RESERVE));

const boolean = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
  .transform((value) => ['true', '1', 'yes', 'on'].includes(value));
// The bare-host grammar is frozen by the baseline KChatClient constructor.
const kchatHost = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/i);
const configuration = z.object({
  KCHAT_HOST: kchatHost.optional(),
  KCHAT_TOKEN: z.string().min(1).optional(),
  INFOMANIAK_API_TOKEN: z.string().min(1),
  INFOMANIAK_CALENDAR_TOKEN: z.string().min(1).optional(),
  INFOMANIAK_READ_ONLY: boolean.default(false),
  INFOMANIAK_ALLOW_RAW_API: boolean.default(false),
  INFOMANIAK_ALLOW_EXPERIMENTAL: boolean.default(false),
  INFOMANIAK_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  MCP_TOOLS_TTL_MS: z.coerce.number().int().nonnegative().default(60000),
  MCP_HOST: hostname.default('127.0.0.1'),
  MCP_PORT: integer.pipe(z.number().min(1).max(65535)).optional(),
  PORT: integer.pipe(z.number().min(1).max(65535)).optional(),
  MCP_HTTP_AUTH_TOKEN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(16).optional(),
  ),
  MCP_HTTP_ALLOW_UNAUTHENTICATED: boolean.default(false),
  MCP_ALLOWED_HOSTS: hostList.default(['localhost', '127.0.0.1', '[::1]']),
  MCP_CORS_ORIGINS: originList.default([]),
  MCP_HTTP_BODY_LIMIT: bodyLimit.default(BODY_LIMIT),
  KDRIVE_MAX_DOWNLOAD_BYTES: integer.default(DOWNLOAD_LIMIT),
  KDRIVE_MAX_UPLOAD_BYTES: integer.default(UPLOAD_LIMIT),
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
    kchat:
      value.KCHAT_HOST && value.KCHAT_TOKEN
        ? Object.freeze({ host: value.KCHAT_HOST, token: value.KCHAT_TOKEN })
        : undefined,
    calendarToken: value.INFOMANIAK_CALENDAR_TOKEN ?? value.INFOMANIAK_API_TOKEN,
    timeoutMs: value.INFOMANIAK_TIMEOUT_MS,
    toolsTtlMs: value.MCP_TOOLS_TTL_MS,
    http: Object.freeze({
      host: value.MCP_HOST,
      port: value.MCP_PORT ?? value.PORT ?? 3000,
      auth: Object.freeze({
        token: value.MCP_HTTP_AUTH_TOKEN,
        allowUnauthenticated: value.MCP_HTTP_ALLOW_UNAUTHENTICATED,
        host: value.MCP_HOST,
      }),
      allowedHosts: Object.freeze(value.MCP_ALLOWED_HOSTS),
      allowedOrigins: Object.freeze(value.MCP_CORS_ORIGINS),
      maxBodyBytes: value.MCP_HTTP_BODY_LIMIT,
    }),
    transfer: Object.freeze({
      downloadLimit: value.KDRIVE_MAX_DOWNLOAD_BYTES,
      uploadLimit: value.KDRIVE_MAX_UPLOAD_BYTES,
      bodyLimit: value.MCP_HTTP_BODY_LIMIT,
    }),
    policy: Object.freeze({
      readOnly: value.INFOMANIAK_READ_ONLY,
      allowRawApi: value.INFOMANIAK_ALLOW_RAW_API,
      allowExperimental: value.INFOMANIAK_ALLOW_EXPERIMENTAL,
    }),
  });
}
