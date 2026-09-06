import { z } from 'zod';

const id = z.number().int().positive();

// Domain identities are required; ancillary baseline fields remain optional (addendum 6).
export const hostingSchema = z.object({
  id: id,
  accountId: id.optional(),
  customerName: z.string().optional(),
  ip: z.string().optional(),
  serviceName: z.string().optional(),
  quotaUsed: z.number().optional(),
  quota: z.number().optional(),
});
export type Hosting = z.infer<typeof hostingSchema>;

export const siteSchema = z.object({
  id: id,
  fqdn: z.string().optional(),
  path: z.string().optional(),
  phpVersion: z.string().optional(),
  sslEnabled: z.boolean().optional(),
});
export type Site = z.infer<typeof siteSchema>;

export const databaseSchema = z.object({
  id: id,
  name: z.string().optional(),
  size: z.number().optional(),
  charset: z.string().optional(),
});
export type Database = z.infer<typeof databaseSchema>;

export const cronJobSchema = z.object({
  id: id,
  hostingId: id.optional(),
  command: z.string().optional(),
  schedule: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  lastRun: z.string().optional(),
  nextRun: z.string().optional(),
});
export type CronJob = z.infer<typeof cronJobSchema>;

export const ftpAccountSchema = z.object({
  id: id,
  hostingId: id.optional(),
  login: z.string().optional(),
  homeDirectory: z.string().optional(),
  isActive: z.boolean().optional(),
});
export type FtpAccount = z.infer<typeof ftpAccountSchema>;

export const backupSlotSchema = z.object({
  customerName: z.string().optional(),
  type: z.union([z.string(), z.number()]).optional(),
  subtype: z.union([z.string(), z.number()]).optional(),
  connectionType: z.union([z.string(), z.number()]).optional(),
  size: z.number().optional(),
  storageUsed: z.number().optional(),
  usageLastCheck: z.union([z.string(), z.number()]).nullable().optional(),
  createdAt: z.union([z.string(), z.number()]).nullable().optional(),
  id: id,
  name: z.string().optional(),
  sizeUsed: z.number().optional(),
  maxSize: z.number().optional(),
  protocol: z.string().optional(),
});
export type BackupSlot = z.infer<typeof backupSlotSchema>;

export const backupSchema = z.object({
  id: id,
  accountId: id.optional(),
  customerName: z.string().optional(),
  slots: z.array(backupSlotSchema).optional(),
});
export type Backup = z.infer<typeof backupSchema>;

export const certificateSchema = z.object({
  id: id,
  accountId: id.optional(),
  commonName: z.string().optional(),
  alternativeNames: z.array(z.string()).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  notBefore: z.string().optional(),
  notAfter: z.string().optional(),
});
export type Certificate = z.infer<typeof certificateSchema>;

export const invoiceSchema = z.object({
  id: id,
  accountId: id.optional(),
  reference: z.string().optional(),
  amountTtc: z.number().optional(),
  amountHt: z.number().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  dueDate: z.string().optional(),
  createdAt: z.union([z.string(), z.number()]).nullable().optional(),
  pdfUrl: z.string().optional(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const siteDeletedSchema = z.object({
  ok: z.literal(true),
  action: z.literal('delete_site'),
  hostingId: id,
  siteId: id,
});
export type SiteDeleted = z.infer<typeof siteDeletedSchema>;
export const databaseDeletedSchema = z.object({
  ok: z.literal(true),
  action: z.literal('delete_database'),
  hostingId: id,
  databaseId: id,
});
export type DatabaseDeleted = z.infer<typeof databaseDeletedSchema>;
export const cronJobDeletedSchema = z.object({
  ok: z.literal(true),
  action: z.literal('delete_cron_job'),
  hostingId: id,
  cronId: id,
});
export type CronJobDeleted = z.infer<typeof cronJobDeletedSchema>;
export const ftpAccountDeletedSchema = z.object({
  ok: z.literal(true),
  action: z.literal('delete_ftp_account'),
  hostingId: id,
  ftpId: id,
});
export type FtpAccountDeleted = z.infer<typeof ftpAccountDeletedSchema>;
