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
const DriveIdField = z.number({ required_error: 'drive_id is required' }).int().positive();
const FileIdField = z.number({ required_error: 'file_id is required' }).int().positive();
const DirectoryIdField = z.number().int().positive();
const CursorField = z.string().min(1).optional();
const LimitField = z.number().int().min(1).max(200).optional();
const KDriveTypeField = z.enum(['file', 'dir']).optional();
const FileNameField = z
  .string({ required_error: 'name is required' })
  .min(1, 'name cannot be empty')
  .max(255)
  .refine((n) => !/[\\/]/.test(n) && n !== '.' && n !== '..', 'name must not contain path separators');
const ShareLinkRightField = z.enum(['public', 'password', 'inherit']);

export const KDriveFileIdSchema = z.object({
  drive_id: DriveIdField,
  file_id: FileIdField,
});

export const KDriveListFilesSchema = z.object({
  drive_id: DriveIdField,
  directory_id: DirectoryIdField.optional(),
  type: KDriveTypeField,
  cursor: CursorField,
  limit: LimitField,
  order_by: z.enum(['name', 'size', 'last_modified_at', 'added_at', 'type']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const KDriveSearchSchema = z.object({
  drive_id: DriveIdField,
  query: z.string({ required_error: 'query is required' }).min(1).max(500),
  directory_id: DirectoryIdField.optional(),
  depth: z.enum(['child', 'unlimited']).optional(),
  type: KDriveTypeField,
  modified_after: z.string().max(40).optional(),
  modified_before: z.string().max(40).optional(),
  cursor: CursorField,
  limit: LimitField,
});

export const KDriveCreateDirectorySchema = z.object({
  drive_id: DriveIdField,
  name: FileNameField,
  parent_id: DirectoryIdField.optional(),
  only_for_me: z.boolean().optional(),
});

export const MoveOrCopyKDriveFileSchema = z.object({
  drive_id: DriveIdField,
  file_id: FileIdField,
  destination_directory_id: z.number({ required_error: 'destination_directory_id is required' }).int().positive(),
});

export const RenameKDriveFileSchema = z.object({
  drive_id: DriveIdField,
  file_id: FileIdField,
  name: FileNameField,
});

export const KDriveUploadSchema = z
  .object({
    drive_id: DriveIdField,
    file_name: FileNameField,
    directory_id: DirectoryIdField.optional(),
    text_content: z.string().optional(),
    base64_content: z.string().regex(/^[A-Za-z0-9+/=\s]*$/, 'base64_content must be valid base64').optional(),
    conflict: z.enum(['error', 'rename', 'version']).optional(),
    directory_path: z.string().max(1000).optional(),
    last_modified_at: z.number().int().positive().optional(),
  })
  .refine((d) => (d.text_content !== undefined) !== (d.base64_content !== undefined), {
    message: 'Provide exactly one of text_content or base64_content',
    path: ['text_content'],
  });

export const KDriveDownloadSchema = z.object({
  drive_id: DriveIdField,
  file_id: FileIdField,
  encoding: z.enum(['auto', 'utf-8', 'base64']).optional(),
});

const ShareLinkFields = {
  password: z.string().min(1).max(200).optional(),
  valid_until: z.number().int().positive().optional(),
  can_download: z.boolean().optional(),
  can_edit: z.boolean().optional(),
  can_see_stats: z.boolean().optional(),
};

export const KDriveCreateShareLinkSchema = z
  .object({ drive_id: DriveIdField, file_id: FileIdField, right: ShareLinkRightField, ...ShareLinkFields })
  .refine((d) => d.right !== 'password' || Boolean(d.password), {
    message: 'password is required when right is "password"',
    path: ['password'],
  });

export const KDriveUpdateShareLinkSchema = z.object({
  drive_id: DriveIdField,
  file_id: FileIdField,
  right: ShareLinkRightField.optional(),
  ...ShareLinkFields,
});

export const KDriveInviteAccessSchema = z.object({
  drive_id: DriveIdField,
  file_id: FileIdField,
  emails: z.array(z.string().email()).min(1).max(50),
  right: z.enum(['read', 'write', 'manage']),
  message: z.string().max(2000).optional(),
  lang: z.enum(['fr', 'en', 'de', 'it', 'es']).optional(),
});

export const KDriveCursorSchema = z.object({
  drive_id: DriveIdField,
  cursor: CursorField,
  limit: LimitField,
});

export const KDriveRestoreSchema = z.object({
  drive_id: DriveIdField,
  file_id: FileIdField,
  destination_directory_id: DirectoryIdField.optional(),
});

export const KDriveTypeFilterSchema = z.object({
  drive_id: DriveIdField,
  type: KDriveTypeField,
});

export const KDriveActivitySchema = z.object({
  drive_id: DriveIdField,
  file_id: FileIdField.optional(),
  cursor: CursorField,
  limit: LimitField,
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

// Calendar schemas
const CalendarIdField = z.union([z.number().int().positive(), z.string().min(1).max(100)]);
const EventIdField = z.union([z.number().int().positive(), z.string().min(1).max(100)], {
  required_error: 'event_id is required',
});
const DateTimeField = z.string().min(10, 'date must be at least YYYY-MM-DD').max(40);
const TimezoneField = z.string().min(1).max(64).optional();
const RRuleField = z
  .string()
  .max(500)
  .regex(
    /^$|^FREQ=(SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[^;]+)*$/i,
    'rrule must be an RFC 5545 rule starting with FREQ=',
  );
const AttendeesField = z.array(z.string().email()).max(100);

export const CalendarListEventsSchema = z.object({
  from: DateTimeField,
  to: DateTimeField,
  calendar_id: CalendarIdField.optional(),
  timezone: TimezoneField,
});

export const CalendarEventIdSchema = z.object({
  event_id: EventIdField,
});

export const CalendarCreateEventSchema = z.object({
  title: z.string({ required_error: 'title is required' }).min(1, 'title cannot be empty').max(500),
  start: DateTimeField,
  end: DateTimeField,
  calendar_id: CalendarIdField.optional(),
  description: z.string().max(10000).optional(),
  location: z.string().max(1000).optional(),
  attendees: AttendeesField.optional(),
  rrule: RRuleField.optional(),
  fullday: z.boolean().optional(),
  timezone: TimezoneField,
  freebusy: z.enum(['busy', 'free']).optional(),
  private: z.boolean().optional(),
});

export const CalendarUpdateEventSchema = z.object({
  event_id: EventIdField,
  title: z.string().min(1).max(500).optional(),
  start: DateTimeField.optional(),
  end: DateTimeField.optional(),
  calendar_id: CalendarIdField.optional(),
  description: z.string().max(10000).optional(),
  location: z.string().max(1000).optional(),
  attendees: AttendeesField.optional(),
  rrule: RRuleField.optional(),
  fullday: z.boolean().optional(),
  timezone: TimezoneField,
  freebusy: z.enum(['busy', 'free']).optional(),
  private: z.boolean().optional(),
  notify_attendees: z.boolean().optional(),
});

export const CalendarDeleteEventSchema = z.object({
  event_id: EventIdField,
  calendar_id: CalendarIdField.optional(),
});
