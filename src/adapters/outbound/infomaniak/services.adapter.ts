import { z } from 'zod';
import {
  hostingSchema,
  siteSchema,
  databaseSchema,
  cronJobSchema,
  ftpAccountSchema,
  backupSlotSchema,
  backupSchema,
  certificateSchema,
  invoiceSchema,
} from '../../../domain/services/service.js';
import type { ServicesPort } from '../../../application/services/services.port.js';
import type { InfomaniakGateway, GatewayRequest } from './gateway.js';

const present = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
const id = z.number().int().positive();
const envelope = <T extends z.ZodType>(data: T) => z.object({ result: z.literal('success'), data });
// Baseline DTOs: identity is mandatory, unexercised ancillary fields are optional.
// Explicit mapping discards unknown provider fields even though gateway returns the raw payload.
const hostingDto = z.object({
  id: id,
  account_id: id.optional(),
  customer_name: z.string().optional(),
  ip: z.string().optional(),
  service_name: z.string().optional(),
  quota_used: z.number().optional(),
  quota: z.number().optional(),
});
const mapHosting = (v: z.infer<typeof hostingDto>) =>
  hostingSchema.parse(
    present({
      id: v.id,
      accountId: v.account_id,
      customerName: v.customer_name,
      ip: v.ip,
      serviceName: v.service_name,
      quotaUsed: v.quota_used,
      quota: v.quota,
    }),
  );
const siteDto = z.object({
  id: id,
  fqdn: z.string(),
  path: z.string().optional(),
  php_version: z.string().optional(),
  ssl_enabled: z.boolean().optional(),
});
const mapSite = (v: z.infer<typeof siteDto>) =>
  siteSchema.parse(
    present({
      id: v.id,
      fqdn: v.fqdn,
      path: v.path,
      phpVersion: v.php_version,
      sslEnabled: v.ssl_enabled,
    }),
  );
const databaseDto = z.object({
  id: id,
  name: z.string().optional(),
  size: z.number().optional(),
  charset: z.string().optional(),
});
const mapDatabase = (v: z.infer<typeof databaseDto>) =>
  databaseSchema.parse(
    present({
      id: v.id,
      name: v.name,
      size: v.size,
      charset: v.charset,
    }),
  );
const cronJobDto = z.object({
  id: id,
  hosting_id: id.optional(),
  command: z.string().optional(),
  schedule: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  last_run: z.string().optional(),
  next_run: z.string().optional(),
});
const mapCronJob = (v: z.infer<typeof cronJobDto>) =>
  cronJobSchema.parse(
    present({
      id: v.id,
      hostingId: v.hosting_id,
      command: v.command,
      schedule: v.schedule,
      description: v.description,
      status: v.status,
      lastRun: v.last_run,
      nextRun: v.next_run,
    }),
  );
const ftpAccountDto = z.object({
  id: id,
  hosting_id: id.optional(),
  login: z.string().optional(),
  home_directory: z.string().optional(),
  is_active: z.boolean().optional(),
});
const mapFtpAccount = (v: z.infer<typeof ftpAccountDto>) =>
  ftpAccountSchema.parse(
    present({
      id: v.id,
      hostingId: v.hosting_id,
      login: v.login,
      homeDirectory: v.home_directory,
      isActive: v.is_active,
    }),
  );
const backupSlotDto = z.object({
  id: id,
  name: z.string().optional(),
  size_used: z.number().optional(),
  max_size: z.number().optional(),
  protocol: z.string().optional(),
});
const mapBackupSlot = (v: z.infer<typeof backupSlotDto>) =>
  backupSlotSchema.parse(
    present({
      id: v.id,
      name: v.name,
      sizeUsed: v.size_used,
      maxSize: v.max_size,
      protocol: v.protocol,
    }),
  );
const backupDto = z.object({
  id: id,
  account_id: id.optional(),
  customer_name: z.string().optional(),
  slots: z.array(backupSlotDto).optional(),
});
const mapBackup = (v: z.infer<typeof backupDto>) =>
  backupSchema.parse(
    present({
      id: v.id,
      accountId: v.account_id,
      customerName: v.customer_name,
      slots: v.slots?.map(mapBackupSlot),
    }),
  );
const certificateDto = z.object({
  id: id,
  account_id: id.optional(),
  common_name: z.string().optional(),
  alternative_names: z.array(z.string()).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  not_before: z.string().optional(),
  not_after: z.string().optional(),
});
const mapCertificate = (v: z.infer<typeof certificateDto>) =>
  certificateSchema.parse(
    present({
      id: v.id,
      accountId: v.account_id,
      commonName: v.common_name,
      alternativeNames: v.alternative_names,
      type: v.type,
      status: v.status,
      notBefore: v.not_before,
      notAfter: v.not_after,
    }),
  );
const invoiceDto = z.object({
  id: id,
  account_id: id.optional(),
  reference: z.string().optional(),
  amount_ttc: z.number().optional(),
  amount_ht: z.number().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  due_date: z.string().optional(),
  created_at: z.string().optional(),
  pdf_url: z.string().optional(),
});
const mapInvoice = (v: z.infer<typeof invoiceDto>) =>
  invoiceSchema.parse(
    present({
      id: v.id,
      accountId: v.account_id,
      reference: v.reference,
      amountTtc: v.amount_ttc,
      amountHt: v.amount_ht,
      currency: v.currency,
      status: v.status,
      dueDate: v.due_date,
      createdAt: v.created_at,
      pdfUrl: v.pdf_url,
    }),
  );

const web = (hostingId: number, ...suffix: (string | number)[]) => [
  '1',
  'web',
  hostingId,
  ...suffix,
];
export class ServicesAdapter implements ServicesPort {
  constructor(private readonly gateway: InfomaniakGateway) {}

  private async one<T, U>(
    request: GatewayRequest,
    dto: z.ZodType<T>,
    map: (value: T) => U,
  ): Promise<U> {
    const schema = envelope(dto);
    const response = schema.parse(await this.gateway.request(request, schema));
    return map(response.data);
  }
  private async many<T, U>(
    request: GatewayRequest,
    dto: z.ZodType<T>,
    map: (value: T) => U,
  ): Promise<U[]> {
    return this.one(request, z.array(dto), (values) => values.map(map));
  }
  private async remove(pathSegments: GatewayRequest['pathSegments']): Promise<void> {
    // Addendum 6: JSON deserialization is permitted, its value is deliberately ignored.
    await this.gateway.request({ method: 'DELETE', pathSegments }, z.unknown());
  }

  readonly hosting: ServicesPort['hosting'] = {
    list: async (accountId) => ({
      hostings: await this.many(
        { method: 'GET', pathSegments: ['1', 'web'], query: { account_id: accountId } },
        hostingDto,
        mapHosting,
      ),
    }),
    get: async (hostingId) => ({
      hosting: await this.one(
        { method: 'GET', pathSegments: web(hostingId) },
        hostingDto,
        mapHosting,
      ),
    }),
    listSites: async (hostingId) => ({
      sites: await this.many(
        { method: 'GET', pathSegments: web(hostingId, 'site') },
        siteDto,
        mapSite,
      ),
    }),
    getSite: async (hostingId, siteId) => ({
      site: await this.one(
        { method: 'GET', pathSegments: web(hostingId, 'site', siteId) },
        siteDto,
        mapSite,
      ),
    }),
    createSite: async (hostingId, input) => ({
      site: await this.one(
        { method: 'POST', pathSegments: web(hostingId, 'site'), body: input },
        siteDto,
        mapSite,
      ),
    }),
    updateSite: async (hostingId, siteId, input) => ({
      site: await this.one(
        { method: 'PUT', pathSegments: web(hostingId, 'site', siteId), body: input },
        siteDto,
        mapSite,
      ),
    }),
    deleteSite: async (hostingId, siteId) => {
      await this.remove(web(hostingId, 'site', siteId));
      return { ok: true, action: 'delete_site', hostingId, siteId };
    },
  };
  readonly database: ServicesPort['database'] = {
    list: async (hostingId) => ({
      databases: await this.many(
        { method: 'GET', pathSegments: web(hostingId, 'database') },
        databaseDto,
        mapDatabase,
      ),
    }),
    get: async (hostingId, databaseId) => ({
      database: await this.one(
        { method: 'GET', pathSegments: web(hostingId, 'database', databaseId) },
        databaseDto,
        mapDatabase,
      ),
    }),
    create: async (hostingId, input) => ({
      database: await this.one(
        { method: 'POST', pathSegments: web(hostingId, 'database'), body: input },
        databaseDto,
        mapDatabase,
      ),
    }),
    delete: async (hostingId, databaseId) => {
      await this.remove(web(hostingId, 'database', databaseId));
      return { ok: true, action: 'delete_database', hostingId, databaseId };
    },
  };
  readonly cron: ServicesPort['cron'] = {
    list: async (hostingId) => ({
      cronJobs: await this.many(
        { method: 'GET', pathSegments: web(hostingId, 'cron') },
        cronJobDto,
        mapCronJob,
      ),
    }),
    create: async (hostingId, input) => ({
      cronJob: await this.one(
        { method: 'POST', pathSegments: web(hostingId, 'cron'), body: input },
        cronJobDto,
        mapCronJob,
      ),
    }),
    update: async (hostingId, cronId, input) => ({
      cronJob: await this.one(
        { method: 'PUT', pathSegments: web(hostingId, 'cron', cronId), body: input },
        cronJobDto,
        mapCronJob,
      ),
    }),
    delete: async (hostingId, cronId) => {
      await this.remove(web(hostingId, 'cron', cronId));
      return { ok: true, action: 'delete_cron_job', hostingId, cronId };
    },
  };
  readonly ftp: ServicesPort['ftp'] = {
    list: async (hostingId) => ({
      ftpAccounts: await this.many(
        { method: 'GET', pathSegments: web(hostingId, 'ftp') },
        ftpAccountDto,
        mapFtpAccount,
      ),
    }),
    create: async (hostingId, input) => ({
      ftpAccount: await this.one(
        { method: 'POST', pathSegments: web(hostingId, 'ftp'), body: input },
        ftpAccountDto,
        mapFtpAccount,
      ),
    }),
    update: async (hostingId, ftpId, input) => ({
      ftpAccount: await this.one(
        { method: 'PUT', pathSegments: web(hostingId, 'ftp', ftpId), body: input },
        ftpAccountDto,
        mapFtpAccount,
      ),
    }),
    delete: async (hostingId, ftpId) => {
      await this.remove(web(hostingId, 'ftp', ftpId));
      return { ok: true, action: 'delete_ftp_account', hostingId, ftpId };
    },
  };
  readonly backup: ServicesPort['backup'] = {
    list: async (accountId) => ({
      backups: await this.many(
        { method: 'GET', pathSegments: ['1', 'swiss_backup'], query: { account_id: accountId } },
        backupDto,
        mapBackup,
      ),
    }),
    get: async (backupId) => ({
      backup: await this.one(
        { method: 'GET', pathSegments: ['1', 'swiss_backup', backupId] },
        backupDto,
        mapBackup,
      ),
    }),
    listSlots: async (backupId) => ({
      slots: await this.many(
        { method: 'GET', pathSegments: ['1', 'swiss_backup', backupId, 'slot'] },
        backupSlotDto,
        mapBackupSlot,
      ),
    }),
  };
  readonly certificate: ServicesPort['certificate'] = {
    list: async (accountId) => ({
      certificates: await this.many(
        { method: 'GET', pathSegments: ['1', 'certificate'], query: { account_id: accountId } },
        certificateDto,
        mapCertificate,
      ),
    }),
    get: async (certificateId) => ({
      certificate: await this.one(
        { method: 'GET', pathSegments: ['1', 'certificate', certificateId] },
        certificateDto,
        mapCertificate,
      ),
    }),
  };
  readonly invoice: ServicesPort['invoice'] = {
    list: async (accountId) => ({
      invoices: await this.many(
        { method: 'GET', pathSegments: ['1', 'invoicing', accountId, 'invoice', 'list'] },
        invoiceDto,
        mapInvoice,
      ),
    }),
    get: async (accountId, invoiceId) => ({
      invoice: await this.one(
        { method: 'GET', pathSegments: ['1', 'invoicing', accountId, 'invoice', invoiceId] },
        invoiceDto,
        mapInvoice,
      ),
    }),
  };
}
