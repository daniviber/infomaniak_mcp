import { z } from 'zod';
import {
  entitySchemas,
  rawOutputSchema,
  type EntityKind,
} from '../../../domain/experimental/endpoint-proof.js';
import type {
  ExperimentalPort,
  ExperimentalRequest,
} from '../../../application/experimental/experimental.feature.js';
import type { InfomaniakGateway } from './gateway.js';

// Explicit provider-to-domain projection. Unknown envelope/entity properties never escape.
const fields: Record<EntityKind, Record<string, string>> = {
  domain: {
    id: 'id',
    customerName: 'customer_name',
    registrant: 'registrant',
    registryExpiration: 'registry_expiration',
    autoRenew: 'auto_renew',
    status: 'status',
  },
  mailService: {
    id: 'id',
    accountId: 'account_id',
    customerName: 'customer_name',
    mailboxCount: 'nb_mailbox',
    maxMailboxCount: 'max_mailbox',
  },
  mailbox: {
    id: 'id',
    mailId: 'mail_id',
    mailboxName: 'mailbox_name',
    email: 'email',
    aliases: 'aliases',
    sizeUsed: 'size_used',
    maxSize: 'max_size',
  },
  redirection: {
    id: 'id',
    mailId: 'mail_id',
    from: 'from',
    to: 'to',
    keepCopy: 'keep_copy',
    createdAt: 'created_at',
  },
  autoresponder: {
    enabled: 'enabled',
    subject: 'subject',
    body: 'body',
    fromDate: 'from_date',
    toDate: 'to_date',
  },
  folder: {
    id: 'id',
    name: 'name',
    path: 'path',
    messagesCount: 'messages_count',
    unseenCount: 'unseen_count',
  },
  vps: {
    id: 'id',
    accountId: 'account_id',
    hostname: 'hostname',
    state: 'state',
    cpu: 'cpu',
    memory: 'memory',
    disk: 'disk',
    ip: 'ip',
    createdAt: 'created_at',
    expiresAt: 'expires_at',
  },
  dedicatedServer: {
    id: 'id',
    accountId: 'account_id',
    hostname: 'hostname',
    state: 'state',
    ip: 'ip',
    location: 'location',
    expiresAt: 'expires_at',
  },
};
const envelope = <T extends z.ZodType>(data: T) => z.object({ result: z.literal('success'), data });

export class ExperimentalAdapter implements ExperimentalPort {
  constructor(private readonly gateway: InfomaniakGateway) {}

  async execute(request: ExperimentalRequest): Promise<Record<string, unknown>> {
    const { response, ...http } = request;
    if (response.kind === 'acknowledgement') {
      // Baseline void mutations: neither validate nor expose the deserialized body (addendum 6).
      await this.gateway.request(http, z.unknown());
      return response.value;
    }
    if (response.kind === 'raw') {
      if (request.method !== 'GET') {
        await this.gateway.request(http, z.unknown());
        return rawOutputSchema.parse({
          method: request.method,
          endpoint: response.endpoint,
          response: { kind: 'acknowledgement', ok: true, action: 'api_call' },
        });
      }
      // The baseline generic API envelope is mapped to a validated JSON domain value.
      // Provider status/error/extra envelope fields are not an MCP response.
      const schema = envelope(z.json());
      const value = schema.parse(await this.gateway.request(http, schema));
      return rawOutputSchema.parse({
        method: request.method,
        endpoint: response.endpoint,
        response: { kind: 'data', value: value.data },
      });
    }
    const domainSchema = entitySchemas[response.kind];
    const mapping = Object.entries(fields[response.kind]);
    const shape: Record<string, z.ZodType> = domainSchema.shape;
    const dto = z.object(
      Object.fromEntries(mapping.map(([domain, provider]) => [provider, shape[domain]])),
    );
    const schema = envelope(response.list ? z.array(dto) : dto);
    const value = schema.parse(await this.gateway.request(http, schema));
    const map = (entity: Record<string, unknown>) =>
      domainSchema.parse(
        Object.fromEntries(
          mapping
            .filter(([, provider]) => entity[provider] !== undefined)
            .map(([domain, provider]) => [domain, entity[provider]]),
        ),
      );
    return { [response.key]: Array.isArray(value.data) ? value.data.map(map) : map(value.data) };
  }
}
