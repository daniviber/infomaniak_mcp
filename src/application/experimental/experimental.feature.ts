import { z } from 'zod';
import {
  entitySchemas,
  rawOutputSchema,
  type EndpointProof,
  type EntityKind,
  type HttpMethod,
} from '../../domain/experimental/endpoint-proof.js';
import type { ToolContract } from '../../domain/tool-contract.js';
import type { ToolBinding } from '../feature-module.js';

export interface ExperimentalRequest {
  method: HttpMethod;
  pathSegments: readonly (string | number)[];
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  response:
    | { kind: EntityKind; key: string; list: boolean }
    | { kind: 'acknowledgement'; value: Record<string, unknown> }
    | { kind: 'raw'; endpoint: string };
}
export interface ExperimentalPort {
  execute(request: ExperimentalRequest): Promise<Record<string, unknown>>;
}
export interface ExperimentalContract extends ToolContract {
  readonly experimental: true;
  readonly endpoint: EndpointProof;
  readonly proof: EndpointProof['proof'];
}
const id = z.number().int().positive();
const segment = z
  .string()
  .min(1)
  .refine((v) => v !== '.' && v !== '..');
const account = z.object({ account_id: id });
const mail = z.object({ mail_id: id });
const mailbox = mail.extend({ mailbox_id: id });
const alias = mailbox.extend({ alias: z.email() });
const vps = z.object({ vps_id: id });
const server = z.object({ server_id: id });
const createMailbox = mail.extend({
  mailbox_name: z.string().min(1),
  password: z.string().min(8),
  max_size: z.number().positive().optional(),
});
const updateMailbox = mailbox.extend({
  password: z.string().min(8).optional(),
  max_size: z.number().positive().optional(),
});
const redirection = mail.extend({ redirection_id: id });
const createRedirection = mail.extend({
  from: z.email(),
  to: z.array(z.email()).min(1),
  keep_copy: z.boolean().optional(),
});
const autoresponder = mailbox.extend({
  enabled: z.boolean(),
  subject: z.string().optional(),
  body: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

// The caller supplies a relative API path, never a base, URL, query string or fragment.
// Encoded separators/dot segments are rejected before the gateway encodes each segment once.
export const rawInputSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    endpoint: z.string().refine((path) => {
      const parts = path.split('/');
      return (
        parts.shift() === '' &&
        /^[1-9]\d*$/.test(parts[0] ?? '') &&
        parts.every((part) => /^[A-Za-z0-9_@.+~-]+$/.test(part) && part !== '.' && part !== '..')
      );
    }, 'Expected a relative API path with plain segments'),
    body: z.record(z.string(), z.json()).optional(),
    query_params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .refine(
    (input) => input.method !== 'GET' || input.body === undefined,
    'GET does not accept a body',
  );

const source = {
  path: 'src/infomaniak-client.ts',
  revision: '619219a6d23fba64959f960867f7b9a13ee5721a',
} as const;
const camel = (key: string) =>
  key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const pick = (input: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]),
  );

function define(
  name: string,
  method: HttpMethod,
  path: string,
  inputSchema: z.ZodObject,
  response?: { kind: EntityKind; key: string; list: boolean },
  bodyFields: readonly string[] = [],
  classification: ToolContract['classification'] = method === 'GET'
    ? 'read'
    : method === 'DELETE'
      ? 'destructive'
      : 'write',
) {
  const endpoint: EndpointProof = {
    name,
    method,
    path,
    proof: 'unproven',
    responseProof: 'baseline',
    enabled: false,
    source,
  };
  const identifiers = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  if (name === 'infomaniak_add_mailbox_alias') identifiers.push('alias');
  const action = name.replace('infomaniak_', '');
  const outputSchema = response
    ? z.object({
        [response.key]: response.list
          ? z.array(entitySchemas[response.kind])
          : entitySchemas[response.kind],
      })
    : z.object({
        ok: z.literal(true),
        action: z.literal(action),
        ...Object.fromEntries(identifiers.map((key) => [camel(key), inputSchema.shape[key]])),
      });
  const contract: ExperimentalContract = {
    name,
    description: `Experimental: ${action.replaceAll('_', ' ')}`,
    inputSchema,
    outputSchema,
    classification,
    rawApi: false,
    experimental: true,
    proof: endpoint.proof,
    endpoint,
    idempotent: method === 'GET',
    limits: 'password' in inputSchema.shape ? { passwordMinLength: 8 } : {},
    text: (output) => JSON.stringify(output, null, 2),
  };
  return {
    contract,
    bind: (port: ExperimentalPort): ToolBinding => ({
      contract,
      handle: (input) =>
        port.execute({
          method,
          pathSegments: path
            .slice(1)
            .split('/')
            .map((part) =>
              part.startsWith('{') ? (input[part.slice(1, -1)] as string | number) : part,
            ),
          ...(name === 'infomaniak_list_mail_services'
            ? { query: { account_id: input.account_id as number } }
            : {}),
          ...(bodyFields.length ? { body: pick(input, bodyFields) } : {}),
          response: response ?? {
            kind: 'acknowledgement',
            value: {
              ok: true,
              action,
              ...Object.fromEntries(identifiers.map((key) => [camel(key), input[key]])),
            },
          },
        }),
    }),
  };
}
const one = (kind: EntityKind, key: string) => ({ kind, key, list: false });
const many = (kind: EntityKind, key: string) => ({ kind, key, list: true });
const definitions = [
  define('infomaniak_list_vps', 'GET', '/1/vps', z.object({}), many('vps', 'servers')),
  define('infomaniak_get_vps', 'GET', '/1/vps/{vps_id}', vps, one('vps', 'server')),
  define(
    'infomaniak_reboot_vps',
    'POST',
    '/1/vps/{vps_id}/reboot',
    vps,
    undefined,
    [],
    'destructive',
  ),
  define(
    'infomaniak_shutdown_vps',
    'POST',
    '/1/vps/{vps_id}/shutdown',
    vps,
    undefined,
    [],
    'destructive',
  ),
  define('infomaniak_boot_vps', 'POST', '/1/vps/{vps_id}/boot', vps),
  define(
    'infomaniak_list_dedicated_servers',
    'GET',
    '/1/dedicated',
    z.object({}),
    many('dedicatedServer', 'servers'),
  ),
  define(
    'infomaniak_get_dedicated_server',
    'GET',
    '/1/dedicated/{server_id}',
    server,
    one('dedicatedServer', 'server'),
  ),
  define(
    'infomaniak_reboot_dedicated_server',
    'POST',
    '/1/dedicated/{server_id}/reboot',
    server,
    undefined,
    [],
    'destructive',
  ),
  define(
    'infomaniak_list_domains',
    'GET',
    '/1/domain/account/{account_id}',
    account,
    many('domain', 'domains'),
  ),
  define(
    'infomaniak_get_domain',
    'GET',
    '/1/domain/account/{account_id}/domain/{domain}',
    account.extend({ domain: segment }),
    one('domain', 'domain'),
  ),
  define(
    'infomaniak_list_mail_services',
    'GET',
    '/1/mail',
    account,
    many('mailService', 'services'),
  ),
  define(
    'infomaniak_get_mail_service',
    'GET',
    '/1/mail/{mail_id}',
    mail,
    one('mailService', 'service'),
  ),
  define(
    'infomaniak_list_mailboxes',
    'GET',
    '/1/mail/{mail_id}/mailbox',
    mail,
    many('mailbox', 'mailboxes'),
  ),
  define(
    'infomaniak_get_mailbox',
    'GET',
    '/1/mail/{mail_id}/mailbox/{mailbox_id}',
    mailbox,
    one('mailbox', 'mailbox'),
  ),
  define(
    'infomaniak_create_mailbox',
    'POST',
    '/1/mail/{mail_id}/mailbox',
    createMailbox,
    one('mailbox', 'mailbox'),
    ['mailbox_name', 'password', 'max_size'],
  ),
  define(
    'infomaniak_update_mailbox',
    'PUT',
    '/1/mail/{mail_id}/mailbox/{mailbox_id}',
    updateMailbox,
    one('mailbox', 'mailbox'),
    ['password', 'max_size'],
  ),
  define('infomaniak_delete_mailbox', 'DELETE', '/1/mail/{mail_id}/mailbox/{mailbox_id}', mailbox),
  define(
    'infomaniak_add_mailbox_alias',
    'POST',
    '/1/mail/{mail_id}/mailbox/{mailbox_id}/alias',
    alias,
    undefined,
    ['alias'],
  ),
  define(
    'infomaniak_delete_mailbox_alias',
    'DELETE',
    '/1/mail/{mail_id}/mailbox/{mailbox_id}/alias/{alias}',
    alias,
  ),
  define(
    'infomaniak_list_email_redirections',
    'GET',
    '/1/mail/{mail_id}/redirection',
    mail,
    many('redirection', 'redirections'),
  ),
  define(
    'infomaniak_create_email_redirection',
    'POST',
    '/1/mail/{mail_id}/redirection',
    createRedirection,
    one('redirection', 'redirection'),
    ['from', 'to', 'keep_copy'],
  ),
  define(
    'infomaniak_delete_email_redirection',
    'DELETE',
    '/1/mail/{mail_id}/redirection/{redirection_id}',
    redirection,
  ),
  define(
    'infomaniak_get_mailbox_autoresponder',
    'GET',
    '/1/mail/{mail_id}/mailbox/{mailbox_id}/autoresponder',
    mailbox,
    one('autoresponder', 'autoresponder'),
  ),
  define(
    'infomaniak_update_mailbox_autoresponder',
    'PUT',
    '/1/mail/{mail_id}/mailbox/{mailbox_id}/autoresponder',
    autoresponder,
    one('autoresponder', 'autoresponder'),
    ['enabled', 'subject', 'body', 'from_date', 'to_date'],
  ),
  define(
    'infomaniak_list_mailbox_folders',
    'GET',
    '/1/mail/{mail_id}/mailbox/{mailbox_id}/folder',
    mailbox,
    many('folder', 'folders'),
  ),
];
const rawEndpoint: EndpointProof = {
  name: 'infomaniak_api_call',
  method: 'input',
  path: '/{validated_relative_segments}',
  proof: 'unproven',
  responseProof: 'baseline',
  enabled: false,
  source,
};
const rawContract: ExperimentalContract = {
  name: rawEndpoint.name,
  description: 'Experimental raw API; requires both flags. GET-only in read-only mode.',
  inputSchema: rawInputSchema,
  outputSchema: rawOutputSchema,
  classification: 'destructive',
  rawApi: true,
  methodPolicy: { inputField: 'method', readOnlyMethod: 'GET' },
  experimental: true,
  proof: rawEndpoint.proof,
  endpoint: rawEndpoint,
  idempotent: false,
  limits: {},
  text: (output) => JSON.stringify(output, null, 2),
};
export const tools: readonly ExperimentalContract[] = [
  ...definitions.map((v) => v.contract),
  rawContract,
];
export const endpoints: readonly EndpointProof[] = tools.map((tool) => tool.endpoint);
export function createExperimentalBindings(port: ExperimentalPort): ToolBinding[] {
  return [
    ...definitions.map((v) => v.bind(port)),
    {
      contract: rawContract,
      handle: async (input) => {
        const value = rawInputSchema.parse(input);
        return port.execute({
          method: value.method,
          pathSegments: value.endpoint.slice(1).split('/'),
          query: value.query_params,
          body: value.body,
          response: { kind: 'raw', endpoint: value.endpoint },
        });
      },
    },
  ];
}
