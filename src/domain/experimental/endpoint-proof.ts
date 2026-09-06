import { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface EndpointProof {
  readonly name: string;
  readonly method: HttpMethod | 'input';
  readonly path: string;
  /** Endpoint evidence is independent of experimental visibility. */
  readonly proof: 'official' | 'baseline' | 'unproven';
  /** Acknowledgements and typed DTO mappings are inherited from the local baseline. */
  readonly responseProof: 'baseline';
  readonly enabled: false;
  readonly source: {
    readonly path: string;
    readonly revision: string;
    readonly url?: string;
  };
}

const id = z.number().int().positive();
// Identity is used by the mapping; unexercised ancillary baseline fields are optional.
export const entitySchemas = {
  domain: z.object({
    id,
    customerName: z.string().optional(),
    registrant: z.string().optional(),
    registryExpiration: z.string().optional(),
    autoRenew: z.boolean().optional(),
    status: z.string().optional(),
  }),
  mailService: z.object({
    id,
    accountId: id.optional(),
    customerName: z.string().optional(),
    mailboxCount: z.number().optional(),
    maxMailboxCount: z.number().optional(),
  }),
  mailbox: z.object({
    id: id.optional(),
    mailId: id.optional(),
    mailboxName: z.string(),
    email: z.string().optional(),
    mailbox: z.string().optional(),
    mailboxIdn: z.string().optional(),
    note: z.string().optional(),
    type: z.number().int().optional(),
    isLimited: z.boolean().optional(),
    isFreeMail: z.boolean().optional(),
    isUsedForAccount: z.boolean().optional(),
    aliases: z.array(z.string()).optional(),
    sizeUsed: z.number().optional(),
    maxSize: z.number().optional(),
  }),
  redirection: z.object({
    id,
    mailId: id.optional(),
    from: z.string().optional(),
    to: z.array(z.string()).optional(),
    keepCopy: z.boolean().optional(),
    createdAt: z.string().optional(),
  }),
  autoresponder: z.object({
    enabled: z.boolean().optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
  }),
  folder: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    path: z.string().optional(),
    messagesCount: z.number().optional(),
    unseenCount: z.number().optional(),
  }),
  vps: z.object({
    id,
    accountId: id.optional(),
    hostname: z.string().optional(),
    state: z.string().optional(),
    cpu: z.number().optional(),
    memory: z.number().optional(),
    disk: z.number().optional(),
    ip: z.string().optional(),
    createdAt: z.string().optional(),
    expiresAt: z.string().optional(),
  }),
  dedicatedServer: z.object({
    id,
    accountId: id.optional(),
    hostname: z.string().optional(),
    state: z.string().optional(),
    ip: z.string().optional(),
    location: z.string().optional(),
    expiresAt: z.string().optional(),
  }),
};
export type EntityKind = keyof typeof entitySchemas;
export const rawOutputSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  endpoint: z.string(),
  status: z.number().int(),
  // Addendum 10: raw JSON is intentionally exposed, after credential redaction.
  // An absent HTTP body is represented by null so MCP retains all four fields.
  data: z.json(),
});
