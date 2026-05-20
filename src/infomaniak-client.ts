/**
 * Infomaniak API Client
 *
 * A TypeScript client for the Infomaniak REST API.
 * Base URL: https://api.infomaniak.com
 * Authentication: OAuth 2.0 Bearer Token
 * Rate Limit: 60 requests per minute
 */

export interface InfomaniakConfig {
  token: string;
  baseUrl?: string;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Max retry attempts for 429/5xx errors (default: 3, set 1 to disable retries) */
  maxAttempts?: number;
}

export interface PaginationOptions {
  page?: number;
  per_page?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface ApiResponse<T = unknown> {
  result: string;
  data: T;
  error?: {
    code: string;
    description: string;
  };
}

export interface Account {
  id: number;
  name: string;
  legal_entity_type: string;
  created_at: string;
}

export interface Domain {
  id: number;
  customer_name: string;
  registrant: string;
  registry_expiration: string;
  auto_renew: boolean;
  status: string;
}

export interface DnsRecord {
  id: number;
  source: string;
  type: string;
  target: string;
  ttl: number;
  priority?: number;
}

export interface MailService {
  id: number;
  account_id: number;
  customer_name: string;
  nb_mailbox: number;
  max_mailbox: number;
}

export interface Mailbox {
  id: number;
  mail_id: number;
  mailbox_name: string;
  email: string;
  aliases: string[];
  size_used: number;
  max_size: number;
}

export interface WebHosting {
  id: number;
  account_id: number;
  customer_name: string;
  ip: string;
  service_name: string;
  quota_used: number;
  quota: number;
}

export interface Database {
  id: number;
  name: string;
  size: number;
  charset: string;
}

export interface Site {
  id: number;
  fqdn: string;
  path: string;
  php_version: string;
  ssl_enabled: boolean;
}

export interface KDrive {
  id: number;
  name: string;
  account_id: number;
  size_used: number;
  size: number;
}

export interface SwissBackup {
  id: number;
  account_id: number;
  customer_name: string;
  slots: SwissBackupSlot[];
}

export interface SwissBackupSlot {
  id: number;
  name: string;
  size_used: number;
  max_size: number;
  protocol: string;
}

export interface DomainNameserver {
  host: string;
  ip?: string;
}

export interface EmailRedirection {
  id: number;
  mail_id: number;
  from: string;
  to: string[];
  keep_copy: boolean;
  created_at: string;
}

export interface CronJob {
  id: number;
  hosting_id: number;
  command: string;
  schedule: string;
  description?: string;
  status: string;
  last_run?: string;
  next_run?: string;
}

export interface FtpAccount {
  id: number;
  hosting_id: number;
  login: string;
  home_directory: string;
  is_active: boolean;
}

export interface KDriveFile {
  id: number;
  name: string;
  type: 'dir' | 'file';
  size: number;
  created_at: number;
  updated_at: number;
  parent_id: number;
  mime_type?: string;
  is_shared: boolean;
  path?: string;
}

export interface KDriveShareLink {
  url: string;
  right: string;
  valid_until?: string;
}

export interface KDriveFileVersion {
  id: number;
  file_id: number;
  size: number;
  created_at: number;
  created_by: number;
}

export interface KDriveActivity {
  id: number;
  action: string;
  file_id: number;
  file_name: string;
  user_id: number;
  created_at: number;
}

export interface AutoresponderSettings {
  enabled: boolean;
  subject?: string;
  body?: string;
  from_date?: string;
  to_date?: string;
}

export interface MailboxFolder {
  id: string;
  name: string;
  path: string;
  messages_count: number;
  unseen_count: number;
}

export interface Vps {
  id: number;
  account_id: number;
  hostname: string;
  state: string;
  cpu: number;
  memory: number;
  disk: number;
  ip: string;
  created_at: string;
  expires_at?: string;
}

export interface DedicatedServer {
  id: number;
  account_id: number;
  hostname: string;
  state: string;
  ip: string;
  location?: string;
  expires_at?: string;
}

export interface SslCertificate {
  id: number;
  account_id: number;
  common_name: string;
  alternative_names?: string[];
  type: string;
  status: string;
  not_before: string;
  not_after: string;
}

export interface Invoice {
  id: number;
  account_id: number;
  reference: string;
  amount_ttc: number;
  amount_ht?: number;
  currency: string;
  status: string;
  due_date: string;
  created_at: string;
  pdf_url?: string;
}

export interface Profile {
  id: number;
  login: string;
  email: string;
  first_name: string;
  last_name: string;
  current_account_id: number;
}

export interface Product {
  id: number;
  service_id: number;
  service_name: string;
  account_id: number;
  customer_name: string;
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly refillRateMs: number;

  constructor(
    private readonly capacity: number,
    refillPerMinute: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
    this.refillRateMs = 60_000 / refillPerMinute;
  }

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const elapsed = now - this.lastRefill;
      const refilled = Math.floor(elapsed / this.refillRateMs);
      if (refilled > 0) {
        this.tokens = Math.min(this.capacity, this.tokens + refilled);
        this.lastRefill = now - (elapsed % this.refillRateMs);
      }
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = this.refillRateMs - (Date.now() - this.lastRefill);
      await new Promise((r) => setTimeout(r, Math.max(waitMs, 50)));
    }
  }
}

export class InfomaniakClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly bucket: TokenBucket;

  constructor(config: InfomaniakConfig) {
    this.token = config.token;
    this.baseUrl = config.baseUrl ?? 'https://api.infomaniak.com';
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.bucket = new TokenBucket(60, 60);
  }

  private async executeRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) params.append(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage =
          errorJson.error?.description ?? errorJson.message ?? errorText;
      } catch {
        errorMessage = errorText;
      }
      const err = new Error(
        `Infomaniak API Error (${response.status}): ${errorMessage}`,
      ) as Error & { status: number; retryAfter?: number };
      err.status = response.status;
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) err.retryAfter = parseInt(retryAfter, 10);
      }
      throw err;
    }

    return (await response.json()) as T;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    await this.bucket.take();

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.executeRequest<T>(method, path, body, queryParams);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const status = (error as { status?: number }).status;
        const isRetryable =
          status === 429 || (status !== undefined && status >= 500);

        if (!isRetryable || attempt === this.maxAttempts) throw lastError;

        const retryAfter = (error as { retryAfter?: number }).retryAfter;
        const backoffMs = retryAfter
          ? retryAfter * 1000
          : Math.min(2 ** attempt * 500, 8_000) + Math.random() * 500;

        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    throw lastError!;
  }

  // Profile & Authentication
  async getProfile(): Promise<ApiResponse<Profile>> {
    return this.request<ApiResponse<Profile>>('GET', '/1/profile');
  }

  async ping(): Promise<ApiResponse<{ message: string }>> {
    return this.request<ApiResponse<{ message: string }>>('GET', '/1/ping');
  }

  // Accounts
  async getAccounts(): Promise<ApiResponse<Account[]>> {
    return this.request<ApiResponse<Account[]>>('GET', '/1/account');
  }

  async getAccount(accountId: number): Promise<ApiResponse<Account>> {
    return this.request<ApiResponse<Account>>('GET', `/1/account/${accountId}`);
  }

  async getAccountProducts(accountId: number): Promise<ApiResponse<Product[]>> {
    return this.request<ApiResponse<Product[]>>('GET', `/1/account/${accountId}/product`);
  }

  // Domains
  async getDomains(accountId: number): Promise<ApiResponse<Domain[]>> {
    return this.request<ApiResponse<Domain[]>>('GET', `/1/domain/account/${accountId}`);
  }

  async getDomain(accountId: number, domain: string): Promise<ApiResponse<Domain>> {
    return this.request<ApiResponse<Domain>>('GET', `/1/domain/account/${accountId}/domain/${domain}`);
  }

  async getDomainNameservers(domain: string): Promise<ApiResponse<DomainNameserver[]>> {
    return this.request<ApiResponse<DomainNameserver[]>>('GET', `/1/domain/${domain}/nameserver`);
  }

  async updateDomainNameservers(domain: string, nameservers: DomainNameserver[]): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('PUT', `/1/domain/${domain}/nameserver`, { nameservers });
  }

  async renewDomain(domain: string, duration: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('POST', `/1/domain/${domain}/renew`, { duration });
  }

  async getDnsRecords(domain: string): Promise<ApiResponse<DnsRecord[]>> {
    return this.request<ApiResponse<DnsRecord[]>>('GET', `/1/domain/${domain}/dns/record`);
  }

  async createDnsRecord(domain: string, record: {
    source: string;
    type: string;
    target: string;
    ttl?: number;
    priority?: number;
  }): Promise<ApiResponse<DnsRecord>> {
    return this.request<ApiResponse<DnsRecord>>('POST', `/1/domain/${domain}/dns/record`, record);
  }

  async updateDnsRecord(domain: string, recordId: number, record: {
    source?: string;
    type?: string;
    target?: string;
    ttl?: number;
    priority?: number;
  }): Promise<ApiResponse<DnsRecord>> {
    return this.request<ApiResponse<DnsRecord>>('PUT', `/1/domain/${domain}/dns/record/${recordId}`, record);
  }

  async deleteDnsRecord(domain: string, recordId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/1/domain/${domain}/dns/record/${recordId}`);
  }

  // Mail Services
  async getMailServices(accountId: number): Promise<ApiResponse<MailService[]>> {
    return this.request<ApiResponse<MailService[]>>('GET', `/1/mail`, undefined, { account_id: accountId });
  }

  async getMailService(mailId: number): Promise<ApiResponse<MailService>> {
    return this.request<ApiResponse<MailService>>('GET', `/1/mail/${mailId}`);
  }

  async getMailboxes(mailId: number): Promise<ApiResponse<Mailbox[]>> {
    return this.request<ApiResponse<Mailbox[]>>('GET', `/1/mail/${mailId}/mailbox`);
  }

  async getMailbox(mailId: number, mailboxId: number): Promise<ApiResponse<Mailbox>> {
    return this.request<ApiResponse<Mailbox>>('GET', `/1/mail/${mailId}/mailbox/${mailboxId}`);
  }

  async createMailbox(mailId: number, mailbox: {
    mailbox_name: string;
    password: string;
    max_size?: number;
  }): Promise<ApiResponse<Mailbox>> {
    return this.request<ApiResponse<Mailbox>>('POST', `/1/mail/${mailId}/mailbox`, mailbox);
  }

  async updateMailbox(mailId: number, mailboxId: number, mailbox: {
    password?: string;
    max_size?: number;
  }): Promise<ApiResponse<Mailbox>> {
    return this.request<ApiResponse<Mailbox>>('PUT', `/1/mail/${mailId}/mailbox/${mailboxId}`, mailbox);
  }

  async deleteMailbox(mailId: number, mailboxId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/1/mail/${mailId}/mailbox/${mailboxId}`);
  }

  async addMailboxAlias(mailId: number, mailboxId: number, alias: string): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('POST', `/1/mail/${mailId}/mailbox/${mailboxId}/alias`, { alias });
  }

  async deleteMailboxAlias(mailId: number, mailboxId: number, alias: string): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/1/mail/${mailId}/mailbox/${mailboxId}/alias/${encodeURIComponent(alias)}`);
  }

  async getEmailRedirections(mailId: number): Promise<ApiResponse<EmailRedirection[]>> {
    return this.request<ApiResponse<EmailRedirection[]>>('GET', `/1/mail/${mailId}/redirection`);
  }

  async createEmailRedirection(mailId: number, redirection: { from: string; to: string[]; keep_copy?: boolean }): Promise<ApiResponse<EmailRedirection>> {
    return this.request<ApiResponse<EmailRedirection>>('POST', `/1/mail/${mailId}/redirection`, redirection);
  }

  async deleteEmailRedirection(mailId: number, redirectionId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/1/mail/${mailId}/redirection/${redirectionId}`);
  }

  async getMailboxAutoresponder(mailId: number, mailboxId: number): Promise<ApiResponse<AutoresponderSettings>> {
    return this.request<ApiResponse<AutoresponderSettings>>('GET', `/1/mail/${mailId}/mailbox/${mailboxId}/autoresponder`);
  }

  async updateMailboxAutoresponder(mailId: number, mailboxId: number, settings: AutoresponderSettings): Promise<ApiResponse<AutoresponderSettings>> {
    return this.request<ApiResponse<AutoresponderSettings>>('PUT', `/1/mail/${mailId}/mailbox/${mailboxId}/autoresponder`, settings);
  }

  async listMailboxFolders(mailId: number, mailboxId: number): Promise<ApiResponse<MailboxFolder[]>> {
    return this.request<ApiResponse<MailboxFolder[]>>('GET', `/1/mail/${mailId}/mailbox/${mailboxId}/folder`);
  }

  // Web Hosting
  async getWebHostings(accountId: number): Promise<ApiResponse<WebHosting[]>> {
    return this.request<ApiResponse<WebHosting[]>>('GET', `/1/web`, undefined, { account_id: accountId });
  }

  async getWebHosting(hostingId: number): Promise<ApiResponse<WebHosting>> {
    return this.request<ApiResponse<WebHosting>>('GET', `/1/web/${hostingId}`);
  }

  async getSites(hostingId: number): Promise<ApiResponse<Site[]>> {
    return this.request<ApiResponse<Site[]>>('GET', `/1/web/${hostingId}/site`);
  }

  async getSite(hostingId: number, siteId: number): Promise<ApiResponse<Site>> {
    return this.request<ApiResponse<Site>>('GET', `/1/web/${hostingId}/site/${siteId}`);
  }

  async createSite(hostingId: number, site: {
    fqdn: string;
    path?: string;
    php_version?: string;
  }): Promise<ApiResponse<Site>> {
    return this.request<ApiResponse<Site>>('POST', `/1/web/${hostingId}/site`, site);
  }

  async updateSite(hostingId: number, siteId: number, site: {
    path?: string;
    php_version?: string;
  }): Promise<ApiResponse<Site>> {
    return this.request<ApiResponse<Site>>('PUT', `/1/web/${hostingId}/site/${siteId}`, site);
  }

  async deleteSite(hostingId: number, siteId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/1/web/${hostingId}/site/${siteId}`);
  }

  // Databases
  async getDatabases(hostingId: number): Promise<ApiResponse<Database[]>> {
    return this.request<ApiResponse<Database[]>>('GET', `/1/web/${hostingId}/database`);
  }

  async getDatabase(hostingId: number, dbId: number): Promise<ApiResponse<Database>> {
    return this.request<ApiResponse<Database>>('GET', `/1/web/${hostingId}/database/${dbId}`);
  }

  async createDatabase(hostingId: number, database: {
    name: string;
    charset?: string;
  }): Promise<ApiResponse<Database>> {
    return this.request<ApiResponse<Database>>('POST', `/1/web/${hostingId}/database`, database);
  }

  async deleteDatabase(hostingId: number, dbId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/1/web/${hostingId}/database/${dbId}`);
  }

  async getCronJobs(hostingId: number): Promise<ApiResponse<CronJob[]>> {
    return this.request<ApiResponse<CronJob[]>>('GET', `/1/web/${hostingId}/cron`);
  }

  async createCronJob(hostingId: number, cron: { command: string; schedule: string; description?: string }): Promise<ApiResponse<CronJob>> {
    return this.request<ApiResponse<CronJob>>('POST', `/1/web/${hostingId}/cron`, cron);
  }

  async updateCronJob(hostingId: number, cronId: number, cron: { command?: string; schedule?: string; description?: string }): Promise<ApiResponse<CronJob>> {
    return this.request<ApiResponse<CronJob>>('PUT', `/1/web/${hostingId}/cron/${cronId}`, cron);
  }

  async deleteCronJob(hostingId: number, cronId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/1/web/${hostingId}/cron/${cronId}`);
  }

  async getFtpAccounts(hostingId: number): Promise<ApiResponse<FtpAccount[]>> {
    return this.request<ApiResponse<FtpAccount[]>>('GET', `/1/web/${hostingId}/ftp`);
  }

  async createFtpAccount(hostingId: number, ftp: { login: string; password: string; home_directory?: string }): Promise<ApiResponse<FtpAccount>> {
    return this.request<ApiResponse<FtpAccount>>('POST', `/1/web/${hostingId}/ftp`, ftp);
  }

  async updateFtpAccount(hostingId: number, ftpId: number, ftp: { password?: string; home_directory?: string; is_active?: boolean }): Promise<ApiResponse<FtpAccount>> {
    return this.request<ApiResponse<FtpAccount>>('PUT', `/1/web/${hostingId}/ftp/${ftpId}`, ftp);
  }

  async deleteFtpAccount(hostingId: number, ftpId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/1/web/${hostingId}/ftp/${ftpId}`);
  }

  // kDrive
  async getKDrives(accountId: number): Promise<ApiResponse<KDrive[]>> {
    return this.request<ApiResponse<KDrive[]>>('GET', `/2/drive`, undefined, { account_id: accountId });
  }

  async getKDrive(driveId: number): Promise<ApiResponse<KDrive>> {
    return this.request<ApiResponse<KDrive>>('GET', `/2/drive/${driveId}`);
  }

  async listKDriveFiles(driveId: number, parentId?: number): Promise<ApiResponse<KDriveFile[]>> {
    const path = parentId
      ? `/2/drive/${driveId}/files/${parentId}/files`
      : `/2/drive/${driveId}/files`;
    return this.request<ApiResponse<KDriveFile[]>>('GET', path);
  }

  async getKDriveFile(driveId: number, fileId: number): Promise<ApiResponse<KDriveFile>> {
    return this.request<ApiResponse<KDriveFile>>('GET', `/2/drive/${driveId}/files/${fileId}`);
  }

  async searchKDriveFiles(driveId: number, query: string): Promise<ApiResponse<KDriveFile[]>> {
    return this.request<ApiResponse<KDriveFile[]>>('GET', `/2/drive/${driveId}/files/search`, undefined, { query });
  }

  async createKDriveDirectory(driveId: number, directory: { name: string; parent_id?: number }): Promise<ApiResponse<KDriveFile>> {
    return this.request<ApiResponse<KDriveFile>>('POST', `/2/drive/${driveId}/files/directories`, directory);
  }

  async moveKDriveFile(driveId: number, fileId: number, destinationDirectoryId: number): Promise<ApiResponse<KDriveFile>> {
    return this.request<ApiResponse<KDriveFile>>('POST', `/2/drive/${driveId}/files/${fileId}/move`, { destination_directory_id: destinationDirectoryId });
  }

  async copyKDriveFile(driveId: number, fileId: number, destinationDirectoryId: number): Promise<ApiResponse<KDriveFile>> {
    return this.request<ApiResponse<KDriveFile>>('POST', `/2/drive/${driveId}/files/${fileId}/copy`, { destination_directory_id: destinationDirectoryId });
  }

  async renameKDriveFile(driveId: number, fileId: number, name: string): Promise<ApiResponse<KDriveFile>> {
    return this.request<ApiResponse<KDriveFile>>('POST', `/2/drive/${driveId}/files/${fileId}/rename`, { name });
  }

  async deleteKDriveFile(driveId: number, fileId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/2/drive/${driveId}/files/${fileId}`);
  }

  async shareKDriveFile(driveId: number, fileId: number, options: { right?: string; valid_until?: string } = {}): Promise<ApiResponse<KDriveShareLink>> {
    return this.request<ApiResponse<KDriveShareLink>>('POST', `/2/drive/${driveId}/files/${fileId}/shareable_link`, options);
  }

  async listKDriveTrash(driveId: number): Promise<ApiResponse<KDriveFile[]>> {
    return this.request<ApiResponse<KDriveFile[]>>('GET', `/2/drive/${driveId}/files/trash`);
  }

  async restoreKDriveFile(driveId: number, fileId: number): Promise<ApiResponse<KDriveFile>> {
    return this.request<ApiResponse<KDriveFile>>('POST', `/2/drive/${driveId}/files/trash/${fileId}/restore`);
  }

  async emptyKDriveTrash(driveId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/2/drive/${driveId}/files/trash`);
  }

  async listKDriveFileVersions(driveId: number, fileId: number): Promise<ApiResponse<KDriveFileVersion[]>> {
    return this.request<ApiResponse<KDriveFileVersion[]>>('GET', `/2/drive/${driveId}/files/${fileId}/versions`);
  }

  async getKDriveActivity(driveId: number, fileId?: number): Promise<ApiResponse<KDriveActivity[]>> {
    const path = fileId
      ? `/2/drive/${driveId}/files/${fileId}/activity`
      : `/2/drive/${driveId}/activity`;
    return this.request<ApiResponse<KDriveActivity[]>>('GET', path);
  }

  async listKDriveFavorites(driveId: number): Promise<ApiResponse<KDriveFile[]>> {
    return this.request<ApiResponse<KDriveFile[]>>('GET', `/2/drive/${driveId}/files/favorites`);
  }

  async addKDriveFavorite(driveId: number, fileId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('POST', `/2/drive/${driveId}/files/${fileId}/favorite`);
  }

  async removeKDriveFavorite(driveId: number, fileId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/2/drive/${driveId}/files/${fileId}/favorite`);
  }

  // Swiss Backup
  async getSwissBackups(accountId: number): Promise<ApiResponse<SwissBackup[]>> {
    return this.request<ApiResponse<SwissBackup[]>>('GET', `/1/swiss_backup`, undefined, { account_id: accountId });
  }

  async getSwissBackup(backupId: number): Promise<ApiResponse<SwissBackup>> {
    return this.request<ApiResponse<SwissBackup>>('GET', `/1/swiss_backup/${backupId}`);
  }

  async getSwissBackupSlots(backupId: number): Promise<ApiResponse<SwissBackupSlot[]>> {
    return this.request<ApiResponse<SwissBackupSlot[]>>('GET', `/1/swiss_backup/${backupId}/slot`);
  }

  // VPS
  async getVpsList(): Promise<ApiResponse<Vps[]>> {
    return this.request<ApiResponse<Vps[]>>('GET', `/1/vps`);
  }

  async getVps(vpsId: number): Promise<ApiResponse<Vps>> {
    return this.request<ApiResponse<Vps>>('GET', `/1/vps/${vpsId}`);
  }

  async rebootVps(vpsId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('POST', `/1/vps/${vpsId}/reboot`);
  }

  async shutdownVps(vpsId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('POST', `/1/vps/${vpsId}/shutdown`);
  }

  async bootVps(vpsId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('POST', `/1/vps/${vpsId}/boot`);
  }

  // Dedicated Servers
  async getDedicatedServers(): Promise<ApiResponse<DedicatedServer[]>> {
    return this.request<ApiResponse<DedicatedServer[]>>('GET', `/1/dedicated`);
  }

  async getDedicatedServer(serverId: number): Promise<ApiResponse<DedicatedServer>> {
    return this.request<ApiResponse<DedicatedServer>>('GET', `/1/dedicated/${serverId}`);
  }

  async rebootDedicatedServer(serverId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('POST', `/1/dedicated/${serverId}/reboot`);
  }

  // SSL Certificates
  async getCertificates(accountId: number): Promise<ApiResponse<SslCertificate[]>> {
    return this.request<ApiResponse<SslCertificate[]>>('GET', `/1/certificate`, undefined, { account_id: accountId });
  }

  async getCertificate(certId: number): Promise<ApiResponse<SslCertificate>> {
    return this.request<ApiResponse<SslCertificate>>('GET', `/1/certificate/${certId}`);
  }

  // Invoicing
  async getInvoices(accountId: number): Promise<ApiResponse<Invoice[]>> {
    return this.request<ApiResponse<Invoice[]>>('GET', `/1/invoicing/${accountId}/invoice/list`);
  }

  async getInvoice(accountId: number, invoiceId: number): Promise<ApiResponse<Invoice>> {
    return this.request<ApiResponse<Invoice>>('GET', `/1/invoicing/${accountId}/invoice/${invoiceId}`);
  }

  // Generic API call for advanced users
  async call<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<ApiResponse<T>> {
    return this.request<ApiResponse<T>>(method, endpoint, body, queryParams);
  }
}

export default InfomaniakClient;
