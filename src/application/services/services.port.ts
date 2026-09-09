import type {
  Hosting,
  Site,
  Database,
  CronJob,
  FtpAccount,
  Backup,
  BackupSlot,
  Certificate,
  Invoice,
  SiteDeleted,
  DatabaseDeleted,
  CronJobDeleted,
  FtpAccountDeleted,
} from '../../domain/services/service.js';

export interface SiteInput {
  fqdn: string;
  path?: string;
  php_version?: string;
}
export interface DatabaseInput {
  name: string;
  charset?: string;
}
export interface CronInput {
  command: string;
  schedule: string;
  description?: string;
}
export interface FtpInput {
  login: string;
  password: string;
  home_directory?: string;
}
export interface FtpUpdate {
  password?: string;
  home_directory?: string;
  is_active?: boolean;
}

/** Capabilities expose domain results, never provider envelopes. */
export interface ServicesPort {
  hosting: {
    list(accountId: number): Promise<{ hostings: Hosting[] }>;
    get(hostingId: number): Promise<{ hosting: Hosting }>;
    listSites(hostingId: number): Promise<{ sites: Site[] }>;
    getSite(hostingId: number, siteId: number): Promise<{ site: Site }>;
    createSite(hostingId: number, input: SiteInput): Promise<{ site: Site }>;
    updateSite(
      hostingId: number,
      siteId: number,
      input: Omit<SiteInput, 'fqdn'>,
    ): Promise<{ site: Site }>;
    deleteSite(hostingId: number, siteId: number): Promise<SiteDeleted>;
  };
  database: {
    list(hostingId: number): Promise<{ databases: Database[] }>;
    get(hostingId: number, databaseId: number): Promise<{ database: Database }>;
    create(hostingId: number, input: DatabaseInput): Promise<{ database: Database }>;
    delete(hostingId: number, databaseId: number): Promise<DatabaseDeleted>;
  };
  cron: {
    list(hostingId: number): Promise<{ cronJobs: CronJob[] }>;
    create(hostingId: number, input: CronInput): Promise<{ cronJob: CronJob }>;
    update(
      hostingId: number,
      cronId: number,
      input: Partial<CronInput>,
    ): Promise<{ cronJob: CronJob }>;
    delete(hostingId: number, cronId: number): Promise<CronJobDeleted>;
  };
  ftp: {
    list(hostingId: number): Promise<{ ftpAccounts: FtpAccount[] }>;
    create(hostingId: number, input: FtpInput): Promise<{ ftpAccount: FtpAccount }>;
    update(hostingId: number, ftpId: number, input: FtpUpdate): Promise<{ ftpAccount: FtpAccount }>;
    delete(hostingId: number, ftpId: number): Promise<FtpAccountDeleted>;
  };
  backup: {
    list(accountId: number): Promise<{ backups: Backup[] }>;
    get(backupId: number): Promise<{ backup: Backup }>;
    listSlots(backupId: number): Promise<{ slots: BackupSlot[] }>;
  };
  certificate: {
    list(accountId: number): Promise<{ certificates: Certificate[] }>;
    get(certificateId: number): Promise<{ certificate: Certificate }>;
  };
  invoice: {
    list(accountId: number): Promise<{ invoices: Invoice[] }>;
    get(accountId: number, invoiceId: string): Promise<{ invoice: Invoice }>;
  };
}
