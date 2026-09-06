import { z } from 'zod';

export const nameserverSchema = z.object({ host: z.string(), ip: z.string().optional() });
export const dnsRecordSchema = z.object({
  id: z.number().int().positive(),
  source: z.string(),
  type: z.string(),
  target: z.string(),
  ttl: z.number(),
  priority: z.number().optional(),
});
export const nameserversUpdatedSchema = z.object({
  ok: z.literal(true),
  action: z.literal('update_nameservers'),
  domain: z.string(),
});
export const renewedSchema = z.object({
  ok: z.literal(true),
  action: z.literal('renew'),
  domain: z.string(),
});
export const dnsDeletedSchema = z.object({
  ok: z.literal(true),
  action: z.literal('delete_dns_record'),
  domain: z.string(),
  recordId: z.number().int().positive(),
});
export type Nameserver = z.infer<typeof nameserverSchema>;
export type DnsRecord = z.infer<typeof dnsRecordSchema>;
export type NameserversUpdated = z.infer<typeof nameserversUpdatedSchema>;
export type Renewed = z.infer<typeof renewedSchema>;
export type DnsDeleted = z.infer<typeof dnsDeletedSchema>;
