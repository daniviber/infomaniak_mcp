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

export interface MailHosting {
  id: number;
  account_id: number;
  customer_name: string;
  service_name: string;
  [key: string]: unknown;
}

/** A mailbox as /1/mail_hostings/{id}/mailboxes returns it (fields beyond these exist). */
export interface Mailbox {
  mailbox_name: string;
  mailbox: string;
  mailbox_idn?: string;
  note?: string;
  aliases?: string[];
  full_aliases?: string[];
  size?: number;
  created_at?: number;
  has_auto_responder?: boolean;
  has_redirection?: boolean;
  redirection?: unknown[];
  has_move_spam?: boolean;
  has_mail_filtering?: boolean;
  authorized_senders?: string[];
  blocked_senders?: string[];
  is_limited?: boolean;
  is_free_mail?: boolean;
  [key: string]: unknown;
}

export interface CreatedMailbox {
  mailbox: Mailbox;
  quota?: number;
  used?: number;
  total?: number;
  existing_user_email?: boolean;
}

export interface MailboxAliases {
  enabled_alias: number;
  aliases: string[];
}

export interface MailboxForwarding {
  is_enabled: boolean | string;
  /** sic — the API spells it this way */
  redirect_adresses: string[];
  has_dont_deliver: boolean | string;
  has_forward_spam: boolean | string;
}

export interface AutoReply {
  id: number;
  name: string;
  message: string;
  is_active?: boolean;
  is_recurrent?: boolean;
  is_visible?: boolean;
  started_at?: number;
  ended_at?: number;
  dont_reply_to?: string[];
  [key: string]: unknown;
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
  id: string;
  name: string;
  targets: unknown[];
  state?: string;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
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


export interface MailboxFolders {
  folders: { name: string }[];
  draft_folder?: string;
  trash_folder?: string;
  sent_folder?: string;
  spam_folder?: string;
  archives_folder?: string;
  commercials_folder?: string;
  social_networks_folder?: string;
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

/** A value that travels as one path segment, and cannot leave it. */
const seg = (value: string | number): string => encodeURIComponent(String(value));

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

  // Mail — on the documented routes: a mail service is a *mail hosting*, a
  // mailbox is addressed by its name (the part before the @), and every name
  // travels URL-encoded in its path segment.
  // The products list filtered on the mail service: checked live on
  // 2026-10-10, `/2/mail_hostings` answers an empty list for a token that
  // `/1/products?service_name=email_hosting` answers with the hosting.
  async getMailHostings(accountId?: number): Promise<ApiResponse<MailHosting[]>> {
    return this.request<ApiResponse<MailHosting[]>>('GET', `/1/products`, undefined, { service_name: 'email_hosting', account_id: accountId });
  }

  async getMailboxes(mailHostingId: number, options: { search?: string; page?: number; per_page?: number } = {}): Promise<ApiResponse<Mailbox[]>> {
    return this.request<ApiResponse<Mailbox[]>>('GET', `/1/mail_hostings/${mailHostingId}/mailboxes`, undefined, options);
  }

  async getMailbox(mailHostingId: number, mailboxName: string): Promise<ApiResponse<Mailbox>> {
    return this.request<ApiResponse<Mailbox>>('GET', `/1/mail_hostings/${mailHostingId}/mailboxes/${seg(mailboxName)}`);
  }

  async createMailbox(mailHostingId: number, mailbox: {
    mailbox_name: string;
    note?: string;
    target?: 'current_user' | 'ksuite_user' | 'other_user';
    link_to_current_user?: boolean;
  }): Promise<ApiResponse<CreatedMailbox>> {
    return this.request<ApiResponse<CreatedMailbox>>('POST', `/1/mail_hostings/${mailHostingId}/mailboxes`, mailbox);
  }

  async updateMailbox(mailHostingId: number, mailboxName: string, changes: {
    note?: string;
    has_responder?: boolean;
    has_move_spam?: boolean;
    has_mail_filtering?: boolean;
    authorized_senders?: string[];
    blocked_senders?: string[];
  }): Promise<ApiResponse<Mailbox>> {
    return this.request<ApiResponse<Mailbox>>('PATCH', `/1/mail_hostings/${mailHostingId}/mailboxes/${seg(mailboxName)}`, changes);
  }

  async deleteMailbox(mailHostingId: number, mailboxName: string): Promise<ApiResponse<boolean>> {
    return this.request<ApiResponse<boolean>>('DELETE', `/1/mail_hostings/${mailHostingId}/mailboxes/${seg(mailboxName)}`);
  }

  async getMailboxAliases(mailHostingId: number, mailboxName: string): Promise<ApiResponse<MailboxAliases>> {
    return this.request<ApiResponse<MailboxAliases>>('GET', `/1/mail_hostings/${mailHostingId}/mailboxes/${seg(mailboxName)}/aliases`);
  }

  async addMailboxAlias(mailHostingId: number, mailboxName: string, alias: string): Promise<ApiResponse<boolean>> {
    return this.request<ApiResponse<boolean>>('POST', `/1/mail_hostings/${mailHostingId}/mailboxes/${seg(mailboxName)}/aliases`, { alias });
  }

  async deleteMailboxAlias(mailHostingId: number, mailboxName: string, alias: string): Promise<ApiResponse<boolean>> {
    return this.request<ApiResponse<boolean>>('DELETE', `/1/mail_hostings/${mailHostingId}/mailboxes/${seg(mailboxName)}/aliases/${seg(alias)}`);
  }

  async getMailboxForwarding(mailHostingId: number, mailboxName: string): Promise<ApiResponse<MailboxForwarding>> {
    return this.request<ApiResponse<MailboxForwarding>>('GET', `/1/mail_hostings/${mailHostingId}/mailboxes/${seg(mailboxName)}/forwarding_addresses`);
  }

  async addMailboxForwarding(mailHostingId: number, mailboxName: string, redirectAddress: string): Promise<ApiResponse<boolean>> {
    return this.request<ApiResponse<boolean>>('POST', `/1/mail_hostings/${mailHostingId}/mailboxes/${seg(mailboxName)}/forwarding_addresses`, { redirect_address: redirectAddress });
  }

  async updateMailboxForwarding(mailHostingId: number, mailboxName: string, changes: {
    redirect_addresses?: string[];
    is_enabled?: boolean;
    has_dont_deliver?: boolean;
    has_forward_spam?: boolean;
  }): Promise<ApiResponse<boolean>> {
    return this.request<ApiResponse<boolean>>('PUT', `/1/mail_hostings/${mailHostingId}/mailboxes/${seg(mailboxName)}/forwarding_addresses`, changes);
  }

  async deleteMailboxForwarding(mailHostingId: number, mailboxName: string): Promise<ApiResponse<boolean>> {
    return this.request<ApiResponse<boolean>>('DELETE', `/1/mail_hostings/${mailHostingId}/mailboxes/${seg(mailboxName)}/forwarding_addresses`);
  }

  async getRedirections(mailHostingId: number): Promise<ApiResponse<EmailRedirection[]>> {
    return this.request<ApiResponse<EmailRedirection[]>>('GET', `/1/mail_hostings/${mailHostingId}/redirections`);
  }

  async createRedirection(mailHostingId: number, redirection: { name: string; targets: string[] }): Promise<ApiResponse<EmailRedirection>> {
    return this.request<ApiResponse<EmailRedirection>>('POST', `/1/mail_hostings/${mailHostingId}/redirections`, redirection);
  }

  async deleteRedirection(mailHostingId: number, redirectionId: string): Promise<ApiResponse<boolean>> {
    return this.request<ApiResponse<boolean>>('DELETE', `/1/mail_hostings/${mailHostingId}/redirections/${seg(redirectionId)}`);
  }

  async getAutoReplies(mailHostingId: number): Promise<ApiResponse<AutoReply[]>> {
    return this.request<ApiResponse<AutoReply[]>>('GET', `/1/mail_hostings/${mailHostingId}/auto_replies`);
  }

  async createAutoReply(mailHostingId: number, autoReply: {
    name: string;
    message: string;
    is_recurrent: boolean;
    started_at?: number;
    ended_at?: number;
    dont_reply_to?: string[];
    is_visible?: boolean;
  }): Promise<ApiResponse<AutoReply>> {
    return this.request<ApiResponse<AutoReply>>('POST', `/1/mail_hostings/${mailHostingId}/auto_replies`, autoReply);
  }

  async updateAutoReply(mailHostingId: number, autoReplyId: number, changes: {
    name?: string;
    message?: string;
    is_recurrent?: boolean;
    started_at?: number;
    ended_at?: number;
    dont_reply_to?: string[];
    is_visible?: boolean;
  }): Promise<ApiResponse<AutoReply>> {
    return this.request<ApiResponse<AutoReply>>('PATCH', `/1/mail_hostings/${mailHostingId}/auto_replies/${autoReplyId}`, changes);
  }

  async deleteAutoReply(mailHostingId: number, autoReplyId: number): Promise<ApiResponse<boolean>> {
    return this.request<ApiResponse<boolean>>('DELETE', `/1/mail_hostings/${mailHostingId}/auto_replies/${autoReplyId}`);
  }

  async getMailboxFolders(mailHostingId: number, mailboxName: string): Promise<ApiResponse<MailboxFolders>> {
    return this.request<ApiResponse<MailboxFolders>>('GET', `/1/mail_hostings/${mailHostingId}/mailboxes/${seg(mailboxName)}/auth/folders`);
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
