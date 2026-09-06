import { z } from 'zod';
import {
  hostingSchema,
  siteSchema,
  databaseSchema,
  cronJobSchema,
  ftpAccountSchema,
  backupSchema,
  backupSlotSchema,
  certificateSchema,
  invoiceSchema,
  siteDeletedSchema,
  databaseDeletedSchema,
  cronJobDeletedSchema,
  ftpAccountDeletedSchema,
} from '../../domain/services/service.js';
import type { ToolContract } from '../../domain/tool-contract.js';
import type { ToolBinding } from '../feature-module.js';
import type { ServicesPort } from './services.port.js';

// These baseline names have no pagination parameters or documented list cap.
export interface ServicesEndpoint {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  proof: 'official' | 'baseline' | 'unproven';
  enabled: boolean;
  pagination: 'none';
  limits: Readonly<Record<string, number | null>>;
}
const id = z.number().int().positive();
const accountInput = z.object({ account_id: id });
const hostingInput = z.object({ hosting_id: id });
const siteInput = hostingInput.extend({ site_id: id });
const databaseInput = hostingInput.extend({ database_id: id });
const cronInput = hostingInput.extend({ cron_id: id });
const ftpInput = hostingInput.extend({ ftp_id: id });
const backupInput = z.object({ backup_id: id });
const certificateInput = z.object({ certificate_id: id });
const invoiceInput = accountInput.extend({ invoice_id: id });
const createSiteInput = hostingInput.extend({
  fqdn: z.string().min(1),
  path: z.string().optional(),
  php_version: z.string().optional(),
});
const updateSiteInput = siteInput.extend({
  path: z.string().optional(),
  php_version: z.string().optional(),
});
const createDatabaseInput = hostingInput.extend({
  name: z.string().min(1),
  charset: z.string().optional(),
});
const createCronInput = hostingInput.extend({
  command: z.string().min(1),
  schedule: z.string().min(1),
  description: z.string().optional(),
});
const updateCronInput = cronInput.extend({
  command: z.string().optional(),
  schedule: z.string().optional(),
  description: z.string().optional(),
});
const ftpLimits = { passwordMinLength: 8 } as const;
const createFtpInput = hostingInput.extend({
  login: z.string().min(1),
  password: z.string().min(ftpLimits.passwordMinLength),
  home_directory: z.string().optional(),
});
const updateFtpInput = ftpInput.extend({
  password: z.string().min(ftpLimits.passwordMinLength).optional(),
  home_directory: z.string().optional(),
  is_active: z.boolean().optional(),
});

function define<S extends z.ZodObject>(
  name: string,
  method: ServicesEndpoint['method'],
  path: string,
  inputSchema: S,
  outputSchema: z.ZodObject,
  handle: (port: ServicesPort, input: z.infer<S>) => Promise<Record<string, unknown>>,
  limits: ToolContract['limits'] = {},
) {
  const endpoint: ServicesEndpoint = {
    name,
    method,
    path,
    proof: 'baseline',
    enabled: true,
    pagination: 'none',
    limits,
  };
  const contract: ToolContract = {
    name,
    description: name.replace('infomaniak_', '').replaceAll('_', ' '),
    inputSchema,
    outputSchema,
    classification: method === 'GET' ? 'read' : method === 'DELETE' ? 'destructive' : 'write',
    rawApi: false,
    idempotent: method === 'GET',
    experimental: false,
    limits,
    text: (output) => JSON.stringify(output, null, 2),
  };
  return {
    endpoint,
    contract,
    bind: (port: ServicesPort): ToolBinding => ({
      contract,
      handle: (input) => handle(port, inputSchema.parse(input)),
    }),
  };
}

const definitions = [
  define(
    'infomaniak_list_web_hostings',
    'GET',
    '/1/web',
    accountInput,
    z.object({ hostings: z.array(hostingSchema) }),
    (p, v) => p.hosting.list(v.account_id),
  ),
  define(
    'infomaniak_get_web_hosting',
    'GET',
    '/1/web/{hosting_id}',
    hostingInput,
    z.object({ hosting: hostingSchema }),
    (p, v) => p.hosting.get(v.hosting_id),
  ),
  define(
    'infomaniak_list_sites',
    'GET',
    '/1/web/{hosting_id}/site',
    hostingInput,
    z.object({ sites: z.array(siteSchema) }),
    (p, v) => p.hosting.listSites(v.hosting_id),
  ),
  define(
    'infomaniak_get_site',
    'GET',
    '/1/web/{hosting_id}/site/{site_id}',
    siteInput,
    z.object({ site: siteSchema }),
    (p, v) => p.hosting.getSite(v.hosting_id, v.site_id),
  ),
  define(
    'infomaniak_create_site',
    'POST',
    '/1/web/{hosting_id}/site',
    createSiteInput,
    z.object({ site: siteSchema }),
    (p, v) =>
      p.hosting.createSite(v.hosting_id, {
        fqdn: v.fqdn,
        path: v.path,
        php_version: v.php_version,
      }),
  ),
  define(
    'infomaniak_update_site',
    'PUT',
    '/1/web/{hosting_id}/site/{site_id}',
    updateSiteInput,
    z.object({ site: siteSchema }),
    (p, v) =>
      p.hosting.updateSite(v.hosting_id, v.site_id, { path: v.path, php_version: v.php_version }),
  ),
  define(
    'infomaniak_delete_site',
    'DELETE',
    '/1/web/{hosting_id}/site/{site_id}',
    siteInput,
    siteDeletedSchema,
    (p, v) => p.hosting.deleteSite(v.hosting_id, v.site_id),
  ),
  define(
    'infomaniak_list_databases',
    'GET',
    '/1/web/{hosting_id}/database',
    hostingInput,
    z.object({ databases: z.array(databaseSchema) }),
    (p, v) => p.database.list(v.hosting_id),
  ),
  define(
    'infomaniak_get_database',
    'GET',
    '/1/web/{hosting_id}/database/{database_id}',
    databaseInput,
    z.object({ database: databaseSchema }),
    (p, v) => p.database.get(v.hosting_id, v.database_id),
  ),
  define(
    'infomaniak_create_database',
    'POST',
    '/1/web/{hosting_id}/database',
    createDatabaseInput,
    z.object({ database: databaseSchema }),
    (p, v) => p.database.create(v.hosting_id, { name: v.name, charset: v.charset }),
  ),
  define(
    'infomaniak_delete_database',
    'DELETE',
    '/1/web/{hosting_id}/database/{database_id}',
    databaseInput,
    databaseDeletedSchema,
    (p, v) => p.database.delete(v.hosting_id, v.database_id),
  ),
  define(
    'infomaniak_list_cron_jobs',
    'GET',
    '/1/web/{hosting_id}/cron',
    hostingInput,
    z.object({ cronJobs: z.array(cronJobSchema) }),
    (p, v) => p.cron.list(v.hosting_id),
  ),
  define(
    'infomaniak_create_cron_job',
    'POST',
    '/1/web/{hosting_id}/cron',
    createCronInput,
    z.object({ cronJob: cronJobSchema }),
    (p, v) =>
      p.cron.create(v.hosting_id, {
        command: v.command,
        schedule: v.schedule,
        description: v.description,
      }),
  ),
  define(
    'infomaniak_update_cron_job',
    'PUT',
    '/1/web/{hosting_id}/cron/{cron_id}',
    updateCronInput,
    z.object({ cronJob: cronJobSchema }),
    (p, v) =>
      p.cron.update(v.hosting_id, v.cron_id, {
        command: v.command,
        schedule: v.schedule,
        description: v.description,
      }),
  ),
  define(
    'infomaniak_delete_cron_job',
    'DELETE',
    '/1/web/{hosting_id}/cron/{cron_id}',
    cronInput,
    cronJobDeletedSchema,
    (p, v) => p.cron.delete(v.hosting_id, v.cron_id),
  ),
  define(
    'infomaniak_list_ftp_accounts',
    'GET',
    '/1/web/{hosting_id}/ftp',
    hostingInput,
    z.object({ ftpAccounts: z.array(ftpAccountSchema) }),
    (p, v) => p.ftp.list(v.hosting_id),
  ),
  define(
    'infomaniak_create_ftp_account',
    'POST',
    '/1/web/{hosting_id}/ftp',
    createFtpInput,
    z.object({ ftpAccount: ftpAccountSchema }),
    (p, v) =>
      p.ftp.create(v.hosting_id, {
        login: v.login,
        password: v.password,
        home_directory: v.home_directory,
      }),
    ftpLimits,
  ),
  define(
    'infomaniak_update_ftp_account',
    'PUT',
    '/1/web/{hosting_id}/ftp/{ftp_id}',
    updateFtpInput,
    z.object({ ftpAccount: ftpAccountSchema }),
    (p, v) =>
      p.ftp.update(v.hosting_id, v.ftp_id, {
        password: v.password,
        home_directory: v.home_directory,
        is_active: v.is_active,
      }),
    ftpLimits,
  ),
  define(
    'infomaniak_delete_ftp_account',
    'DELETE',
    '/1/web/{hosting_id}/ftp/{ftp_id}',
    ftpInput,
    ftpAccountDeletedSchema,
    (p, v) => p.ftp.delete(v.hosting_id, v.ftp_id),
  ),
  define(
    'infomaniak_list_swiss_backups',
    'GET',
    '/1/swiss_backup',
    accountInput,
    z.object({ backups: z.array(backupSchema) }),
    (p, v) => p.backup.list(v.account_id),
  ),
  define(
    'infomaniak_get_swiss_backup',
    'GET',
    '/1/swiss_backup/{backup_id}',
    backupInput,
    z.object({ backup: backupSchema }),
    (p, v) => p.backup.get(v.backup_id),
  ),
  define(
    'infomaniak_list_swiss_backup_slots',
    'GET',
    '/1/swiss_backup/{backup_id}/slot',
    backupInput,
    z.object({ slots: z.array(backupSlotSchema) }),
    (p, v) => p.backup.listSlots(v.backup_id),
  ),
  define(
    'infomaniak_list_certificates',
    'GET',
    '/1/certificate',
    accountInput,
    z.object({ certificates: z.array(certificateSchema) }),
    (p, v) => p.certificate.list(v.account_id),
  ),
  define(
    'infomaniak_get_certificate',
    'GET',
    '/1/certificate/{certificate_id}',
    certificateInput,
    z.object({ certificate: certificateSchema }),
    (p, v) => p.certificate.get(v.certificate_id),
  ),
  define(
    'infomaniak_list_invoices',
    'GET',
    '/1/invoicing/{account_id}/invoice/list',
    accountInput,
    z.object({ invoices: z.array(invoiceSchema) }),
    (p, v) => p.invoice.list(v.account_id),
  ),
  define(
    'infomaniak_get_invoice',
    'GET',
    '/1/invoicing/{account_id}/invoice/{invoice_id}',
    invoiceInput,
    z.object({ invoice: invoiceSchema }),
    (p, v) => p.invoice.get(v.account_id, v.invoice_id),
  ),
];
export const tools: readonly ToolContract[] = definitions.map((definition) => definition.contract);
export const endpoints: readonly ServicesEndpoint[] = definitions.map(
  (definition) => definition.endpoint,
);
export function createServicesBindings(port: ServicesPort): ToolBinding[] {
  return definitions.map((definition) => definition.bind(port));
}
