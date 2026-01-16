/**
 * Zod validation schemas for MCP tool inputs
 */

import { z } from 'zod';

// Common schemas
export const AccountIdSchema = z.object({
  account_id: z.number({ required_error: 'account_id is required' }).positive('account_id must be positive'),
});

export const DomainNameSchema = z.object({
  domain: z.string({ required_error: 'domain is required' }).min(1, 'domain cannot be empty'),
});

// DNS Record schemas
export const DnsRecordTypeSchema = z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA']);

export const ListDnsRecordsSchema = DomainNameSchema;

export const CreateDnsRecordSchema = z.object({
  domain: z.string().min(1, 'domain is required'),
  source: z.string({ required_error: 'source is required' }),
  type: DnsRecordTypeSchema,
  target: z.string({ required_error: 'target is required' }).min(1, 'target cannot be empty'),
  ttl: z.number().min(60).max(86400).optional(),
  priority: z.number().min(0).max(65535).optional(),
});

export const UpdateDnsRecordSchema = z.object({
  domain: z.string().min(1, 'domain is required'),
  record_id: z.number({ required_error: 'record_id is required' }).positive(),
  source: z.string().optional(),
  type: DnsRecordTypeSchema.optional(),
  target: z.string().min(1).optional(),
  ttl: z.number().min(60).max(86400).optional(),
  priority: z.number().min(0).max(65535).optional(),
});

export const DeleteDnsRecordSchema = z.object({
  domain: z.string().min(1, 'domain is required'),
  record_id: z.number({ required_error: 'record_id is required' }).positive(),
});

// Domain schemas
export const GetDomainSchema = z.object({
  account_id: z.number().positive(),
  domain: z.string().min(1),
});

// Mail schemas
export const MailIdSchema = z.object({
  mail_id: z.number({ required_error: 'mail_id is required' }).positive(),
});

export const MailboxIdSchema = z.object({
  mail_id: z.number().positive(),
  mailbox_id: z.number({ required_error: 'mailbox_id is required' }).positive(),
});

export const CreateMailboxSchema = z.object({
  mail_id: z.number().positive(),
  mailbox_name: z.string({ required_error: 'mailbox_name is required' }).min(1, 'mailbox_name cannot be empty'),
  password: z.string({ required_error: 'password is required' }).min(8, 'password must be at least 8 characters'),
  max_size: z.number().positive().optional(),
});

export const UpdateMailboxSchema = z.object({
  mail_id: z.number().positive(),
  mailbox_id: z.number().positive(),
  password: z.string().min(8).optional(),
  max_size: z.number().positive().optional(),
});

export const DeleteMailboxSchema = MailboxIdSchema;

export const MailboxAliasSchema = z.object({
  mail_id: z.number().positive(),
  mailbox_id: z.number().positive(),
  alias: z.string({ required_error: 'alias is required' }).email('alias must be a valid email'),
});

// Web Hosting schemas
export const HostingIdSchema = z.object({
  hosting_id: z.number({ required_error: 'hosting_id is required' }).positive(),
});

export const SiteIdSchema = z.object({
  hosting_id: z.number().positive(),
  site_id: z.number({ required_error: 'site_id is required' }).positive(),
});

export const CreateSiteSchema = z.object({
  hosting_id: z.number().positive(),
  fqdn: z.string({ required_error: 'fqdn is required' }).min(1, 'fqdn cannot be empty'),
  path: z.string().optional(),
  php_version: z.string().optional(),
});

export const UpdateSiteSchema = z.object({
  hosting_id: z.number().positive(),
  site_id: z.number().positive(),
  path: z.string().optional(),
  php_version: z.string().optional(),
});

export const DeleteSiteSchema = SiteIdSchema;

// Database schemas
export const DatabaseIdSchema = z.object({
  hosting_id: z.number().positive(),
  database_id: z.number({ required_error: 'database_id is required' }).positive(),
});

export const CreateDatabaseSchema = z.object({
  hosting_id: z.number().positive(),
  name: z.string({ required_error: 'name is required' }).min(1, 'database name cannot be empty'),
  charset: z.string().optional(),
});

export const DeleteDatabaseSchema = DatabaseIdSchema;

// kDrive schemas
export const DriveIdSchema = z.object({
  drive_id: z.number({ required_error: 'drive_id is required' }).positive(),
});

// Swiss Backup schemas
export const BackupIdSchema = z.object({
  backup_id: z.number({ required_error: 'backup_id is required' }).positive(),
});

// VPS schemas
export const VpsIdSchema = z.object({
  vps_id: z.number({ required_error: 'vps_id is required' }).positive(),
});

// Dedicated Server schemas
export const ServerIdSchema = z.object({
  server_id: z.number({ required_error: 'server_id is required' }).positive(),
});

// Certificate schemas
export const CertificateIdSchema = z.object({
  certificate_id: z.number({ required_error: 'certificate_id is required' }).positive(),
});

// Invoice schemas
export const InvoiceIdSchema = z.object({
  account_id: z.number().positive(),
  invoice_id: z.number({ required_error: 'invoice_id is required' }).positive(),
});

// Generic API call schema
export const ApiCallSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  endpoint: z.string({ required_error: 'endpoint is required' }).startsWith('/', 'endpoint must start with /'),
  body: z.record(z.unknown()).optional(),
  query_params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

// Helper function to validate and return typed result
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation error: ${errors}`);
  }
  return result.data;
}
