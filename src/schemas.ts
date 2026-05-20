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

// Domain extras
export const GetDomainNameserversSchema = DomainNameSchema;

export const UpdateDomainNameserversSchema = z.object({
  domain: z.string().min(1),
  nameservers: z.array(z.object({
    host: z.string().min(1),
    ip: z.string().optional(),
  })).min(1),
});

export const RenewDomainSchema = z.object({
  domain: z.string().min(1),
  duration: z.number().int().positive(),
});

// Email redirections
export const EmailRedirectionIdSchema = z.object({
  mail_id: z.number().positive(),
  redirection_id: z.number({ required_error: 'redirection_id is required' }).positive(),
});

export const CreateEmailRedirectionSchema = z.object({
  mail_id: z.number().positive(),
  from: z.string({ required_error: 'from is required' }).email(),
  to: z.array(z.string().email()).min(1),
  keep_copy: z.boolean().optional(),
});

// Cron jobs
export const CronJobIdSchema = z.object({
  hosting_id: z.number().positive(),
  cron_id: z.number({ required_error: 'cron_id is required' }).positive(),
});

export const CreateCronJobSchema = z.object({
  hosting_id: z.number().positive(),
  command: z.string({ required_error: 'command is required' }).min(1),
  schedule: z.string({ required_error: 'schedule is required' }).min(1),
  description: z.string().optional(),
});

export const UpdateCronJobSchema = z.object({
  hosting_id: z.number().positive(),
  cron_id: z.number().positive(),
  command: z.string().optional(),
  schedule: z.string().optional(),
  description: z.string().optional(),
});

// FTP accounts
export const FtpAccountIdSchema = z.object({
  hosting_id: z.number().positive(),
  ftp_id: z.number({ required_error: 'ftp_id is required' }).positive(),
});

export const CreateFtpAccountSchema = z.object({
  hosting_id: z.number().positive(),
  login: z.string({ required_error: 'login is required' }).min(1),
  password: z.string({ required_error: 'password is required' }).min(8),
  home_directory: z.string().optional(),
});

export const UpdateFtpAccountSchema = z.object({
  hosting_id: z.number().positive(),
  ftp_id: z.number().positive(),
  password: z.string().min(8).optional(),
  home_directory: z.string().optional(),
  is_active: z.boolean().optional(),
});

// kDrive file ops
export const KDriveFileIdSchema = z.object({
  drive_id: z.number().positive(),
  file_id: z.number().positive(),
});

export const ListKDriveFilesSchema = z.object({
  drive_id: z.number().positive(),
  parent_id: z.number().positive().optional(),
});

export const SearchKDriveFilesSchema = z.object({
  drive_id: z.number().positive(),
  query: z.string({ required_error: 'query is required' }).min(1),
});

export const CreateKDriveDirectorySchema = z.object({
  drive_id: z.number().positive(),
  name: z.string({ required_error: 'name is required' }).min(1),
  parent_id: z.number().positive().optional(),
});

export const MoveOrCopyKDriveFileSchema = z.object({
  drive_id: z.number().positive(),
  file_id: z.number().positive(),
  destination_directory_id: z.number({ required_error: 'destination_directory_id is required' }).positive(),
});

export const RenameKDriveFileSchema = z.object({
  drive_id: z.number().positive(),
  file_id: z.number().positive(),
  name: z.string({ required_error: 'name is required' }).min(1),
});

export const ShareKDriveFileSchema = z.object({
  drive_id: z.number().positive(),
  file_id: z.number().positive(),
  right: z.enum(['public', 'password', 'inherit']).optional(),
  valid_until: z.string().optional(),
});

// kDrive extras
export const KDriveTrashSchema = z.object({
  drive_id: z.number().positive(),
});

export const KDriveRestoreFileSchema = z.object({
  drive_id: z.number().positive(),
  file_id: z.number().positive(),
});

export const KDriveActivitySchema = z.object({
  drive_id: z.number().positive(),
  file_id: z.number().positive().optional(),
});

export const KDriveFavoritesSchema = z.object({
  drive_id: z.number().positive(),
});

export const KDriveFavoriteFileSchema = z.object({
  drive_id: z.number().positive(),
  file_id: z.number().positive(),
});

export const KDriveFileVersionsSchema = z.object({
  drive_id: z.number().positive(),
  file_id: z.number().positive(),
});

// Mail extras
export const UpdateMailboxAutoresponderSchema = z.object({
  mail_id: z.number().positive(),
  mailbox_id: z.number().positive(),
  enabled: z.boolean(),
  subject: z.string().optional(),
  body: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

export const ListMailboxFoldersSchema = z.object({
  mail_id: z.number().positive(),
  mailbox_id: z.number().positive(),
});

// kChat schemas
export const KChatTeamIdSchema = z.object({
  team_id: z.string({ required_error: 'team_id is required' }).min(1),
});

export const KChatChannelIdSchema = z.object({
  channel_id: z.string({ required_error: 'channel_id is required' }).min(1),
});

export const KChatPostIdSchema = z.object({
  post_id: z.string({ required_error: 'post_id is required' }).min(1),
});

export const CreateKChatPostSchema = z.object({
  channel_id: z.string({ required_error: 'channel_id is required' }).min(1),
  message: z.string({ required_error: 'message is required' }).min(1),
  root_id: z.string().optional(),
});

export const SearchKChatPostsSchema = z.object({
  team_id: z.string({ required_error: 'team_id is required' }).min(1),
  terms: z.string({ required_error: 'terms is required' }).min(1),
  is_or_search: z.boolean().optional(),
});

export const CreateKChatDirectChannelSchema = z.object({
  user_ids: z.array(z.string().min(1)).min(2).max(2),
});

export const SearchKChatUsersSchema = z.object({
  term: z.string({ required_error: 'term is required' }).min(1),
});

export const ListKChatUsersSchema = z.object({
  in_team_id: z.string().optional(),
  in_channel_id: z.string().optional(),
});

export const KChatGetChannelPostsSchema = z.object({
  channel_id: z.string({ required_error: 'channel_id is required' }).min(1),
  page: z.number().int().min(0).optional(),
  per_page: z.number().int().min(1).max(200).optional(),
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
