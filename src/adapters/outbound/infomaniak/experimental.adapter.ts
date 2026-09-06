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
    mailbox: 'mailbox',
    mailboxIdn: 'mailbox_idn',
    note: 'note',
    type: 'type',
    isLimited: 'is_limited',
    isFreeMail: 'is_free_mail',
    isUsedForAccount: 'is_used_for_account',
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
  constructor(
    private readonly gateway: InfomaniakGateway,
    private readonly secrets: readonly string[] = [],
  ) {}

  async execute(request: ExperimentalRequest): Promise<Record<string, unknown>> {
    const { response, ...http } = request;
    if (response.kind === 'acknowledgement') {
      // Baseline void mutations: neither validate nor expose the deserialized body (addendum 6).
      await this.gateway.request(http, z.unknown());
      return response.value;
    }
    if (response.kind === 'raw') {
      // Addenda 10/11: any JSON body, no endpoint-specific DTO or silent mutation ack.
      const value = await this.gateway.requestWithStatus(http, z.unknown());
      const redact = rawRedactor(this.secrets, request.body, request.query, value.data);
      return rawOutputSchema.parse({
        method: request.method,
        endpoint: redact(response.endpoint),
        status: value.status,
        data: redact(value.data ?? null),
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

/** Raw-only redaction: ordinary DTO mappings and gateway payloads keep their behavior. */
function rawRedactor(configured: readonly string[], ...values: unknown[]) {
  const sensitive = (key: string) =>
    /password|passwd|secret|token|apikey|authorization|cookie|privatekey|credentials/.test(
      key.replace(/[^a-z0-9]/gi, '').toLowerCase(),
    );
  const secrets = new Set(configured.filter(Boolean));
  const collect = (value: unknown, credential = false): void => {
    if (typeof value === 'string') {
      if (credential && value) secrets.add(value);
    } else if (Array.isArray(value)) {
      for (const child of value) collect(child, credential);
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value))
        collect(child, credential || sensitive(key));
    }
  };
  for (const value of values) collect(value);
  // Longer credentials first: replacing a prefix must not leave the rest of a token exposed.
  const known = [...secrets].sort((a, b) => b.length - a.length);
  const text = (value: string) => {
    let redacted = value
      .replace(
        /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
        '[REDACTED]',
      )
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [REDACTED]');
    for (const secret of known) redacted = redacted.split(secret).join('[REDACTED]');
    return redacted;
  };
  const redact = (value: unknown): unknown => {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(redact);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          text(key),
          sensitive(key) ? '[REDACTED]' : redact(child),
        ]),
      );
    return value;
  };
  return redact;
}
