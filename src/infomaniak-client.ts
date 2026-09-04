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

/** ID of the root directory of every kDrive. */
export const KDRIVE_ROOT_DIRECTORY_ID = 1;

export interface KDriveFile {
  id: number;
  name: string;
  type: 'dir' | 'file';
  size?: number;
  created_at?: number;
  last_modified_at?: number;
  added_at?: number;
  parent_id?: number;
  mime_type?: string;
  extension_type?: string;
  path?: string;
  visibility?: string;
  status?: string;
  is_favorite?: boolean;
  [key: string]: unknown;
}

/** kDrive list endpoints paginate with a cursor: pass `cursor` back while `has_more` is true. */
export interface KDriveCursorResponse<T> extends ApiResponse<T> {
  cursor?: string | null;
  has_more?: boolean;
}

export interface KDriveShareLink {
  url: string;
  file_id?: number;
  right: string;
  valid_until?: number | string | null;
  capabilities?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface KDriveActivity {
  id: number;
  action: string;
  created_at: number;
  file?: KDriveFile;
  user?: unknown;
  [key: string]: unknown;
}

export interface KDriveListOptions {
  type?: 'file' | 'dir';
  cursor?: string;
  limit?: number;
  order_by?: string;
  order?: 'asc' | 'desc';
}

export interface KDriveSearchOptions {
  directory_id?: number;
  depth?: 'child' | 'unlimited';
  type?: string;
  modified_after?: string;
  modified_before?: string;
  cursor?: string;
  limit?: number;
}

export interface KDriveShareLinkOptions {
  right: 'public' | 'password' | 'inherit';
  password?: string;
  /** Unix timestamp (seconds). */
  valid_until?: number;
  can_download?: boolean;
  can_edit?: boolean;
  can_see_stats?: boolean;
}

export interface KDriveUploadOptions {
  directory_id: number;
  file_name: string;
  content: Uint8Array;
  /** What to do when a file with the same name exists (default: rename). */
  conflict?: 'error' | 'rename' | 'version';
  /** Optional sub-path (relative to directory_id) created on the fly. */
  directory_path?: string;
  /** Unix timestamp (seconds). */
  last_modified_at?: number;
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

type QueryParams = Record<string, string | number | boolean | undefined>;

/** Result of a binary (non JSON) API call such as a file download. */
export interface BinaryResponse {
  bytes: Uint8Array;
  contentType: string | null;
  fileName?: string;
}

/** Encode a value for safe use as a single URL path segment (prevents path injection). */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value));
}

function parseContentDispositionFileName(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = /filename\*=(?:[^']*'[^']*')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : undefined;
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

  private buildUrl(path: string, queryParams?: QueryParams): string {
    let url = `${this.baseUrl}${path}`;
    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) params.append(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  }

  private async throwForStatus(response: Response): Promise<never> {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.description ?? errorJson.message ?? errorText;
    } catch {
      errorMessage = errorText;
    }
    const err = new Error(
      `Infomaniak API Error (${response.status}): ${errorMessage}`,
    ) as Error & { status: number; retryAfter?: number };
    err.status = response.status;
    if (response.status === 429) {
      const retryAfter = response.headers?.get?.('Retry-After');
      if (retryAfter) err.retryAfter = parseInt(retryAfter, 10);
    }
    throw err;
  }

  /** Rate-limit (token bucket) and retry 429/5xx responses with exponential backoff. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    await this.bucket.take();

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn();
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

  /** JSON request/response. */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: QueryParams,
  ): Promise<T> {
    return this.withRetry(async () => {
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

      const response = await fetch(this.buildUrl(path, queryParams), options);
      if (!response.ok) await this.throwForStatus(response);
      return (await response.json()) as T;
    });
  }

  /** Binary request (raw upload body and/or raw download response). */
  private async requestBinary(
    method: string,
    path: string,
    opts: {
      body?: Uint8Array;
      contentType?: string;
      queryParams?: QueryParams;
      /** Reject responses larger than this many bytes. */
      maxBytes?: number;
      /** Longer timeout for large transfers (default: 4x the regular timeout). */
      timeoutMs?: number;
    } = {},
  ): Promise<BinaryResponse> {
    return this.withRetry(async () => {
      const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
      if (opts.body) headers['Content-Type'] = opts.contentType ?? 'application/octet-stream';

      const response = await fetch(this.buildUrl(path, opts.queryParams), {
        method,
        headers,
        body: opts.body as BodyInit | undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs * 4),
      });
      if (!response.ok) await this.throwForStatus(response);

      const declared = response.headers.get('content-length');
      if (opts.maxBytes && declared && parseInt(declared, 10) > opts.maxBytes) {
        throw new Error(`Response too large (${declared} bytes, max ${opts.maxBytes} bytes)`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (opts.maxBytes && bytes.byteLength > opts.maxBytes) {
        throw new Error(`Response too large (${bytes.byteLength} bytes, max ${opts.maxBytes} bytes)`);
      }
      return {
        bytes,
        contentType: response.headers.get('content-type'),
        fileName: parseContentDispositionFileName(response.headers.get('content-disposition')),
      };
    });
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
    return this.request<ApiResponse<Domain>>('GET', `/1/domain/account/${accountId}/domain/${seg(domain)}`);
  }

  async getDomainNameservers(domain: string): Promise<ApiResponse<DomainNameserver[]>> {
    return this.request<ApiResponse<DomainNameserver[]>>('GET', `/1/domain/${seg(domain)}/nameserver`);
  }

  async updateDomainNameservers(domain: string, nameservers: DomainNameserver[]): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('PUT', `/1/domain/${seg(domain)}/nameserver`, { nameservers });
  }

  async renewDomain(domain: string, duration: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('POST', `/1/domain/${seg(domain)}/renew`, { duration });
  }

  async getDnsRecords(domain: string): Promise<ApiResponse<DnsRecord[]>> {
    return this.request<ApiResponse<DnsRecord[]>>('GET', `/1/domain/${seg(domain)}/dns/record`);
  }

  async createDnsRecord(domain: string, record: {
    source: string;
    type: string;
    target: string;
    ttl?: number;
    priority?: number;
  }): Promise<ApiResponse<DnsRecord>> {
    return this.request<ApiResponse<DnsRecord>>('POST', `/1/domain/${seg(domain)}/dns/record`, record);
  }

  async updateDnsRecord(domain: string, recordId: number, record: {
    source?: string;
    type?: string;
    target?: string;
    ttl?: number;
    priority?: number;
  }): Promise<ApiResponse<DnsRecord>> {
    return this.request<ApiResponse<DnsRecord>>('PUT', `/1/domain/${seg(domain)}/dns/record/${recordId}`, record);
  }

  async deleteDnsRecord(domain: string, recordId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('DELETE', `/1/domain/${seg(domain)}/dns/record/${recordId}`);
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
  //
  // Endpoints below follow Infomaniak's official `mcp-server-kdrive` and the
  // open-source kDrive Android application (ApiRoutes.kt). The root directory
  // of a drive always has id 1 (KDRIVE_ROOT_DIRECTORY_ID).

  async getKDrives(accountId: number): Promise<ApiResponse<KDrive[]>> {
    return this.request<ApiResponse<KDrive[]>>('GET', `/2/drive`, undefined, { account_id: accountId });
  }

  async getKDrive(driveId: number): Promise<ApiResponse<KDrive>> {
    return this.request<ApiResponse<KDrive>>('GET', `/2/drive/${seg(driveId)}`);
  }

  async listKDriveFiles(
    driveId: number,
    directoryId: number = KDRIVE_ROOT_DIRECTORY_ID,
    options: KDriveListOptions = {},
  ): Promise<KDriveCursorResponse<KDriveFile[]>> {
    return this.request<KDriveCursorResponse<KDriveFile[]>>(
      'GET',
      `/3/drive/${seg(driveId)}/files/${seg(directoryId)}/files`,
      undefined,
      {
        'type[]': options.type,
        cursor: options.cursor,
        limit: options.limit,
        order_by: options.order_by,
        order: options.order,
        with: 'path,capabilities,is_favorite,sharelink',
      },
    );
  }

  async getKDriveFile(driveId: number, fileId: number): Promise<ApiResponse<KDriveFile>> {
    return this.request<ApiResponse<KDriveFile>>(
      'GET',
      `/3/drive/${seg(driveId)}/files/${seg(fileId)}`,
      undefined,
      { with: 'path,capabilities,is_favorite,sharelink,users,version' },
    );
  }

  async searchKDriveFiles(
    driveId: number,
    query: string,
    options: KDriveSearchOptions = {},
  ): Promise<KDriveCursorResponse<KDriveFile[]>> {
    const params: Record<string, string | number | boolean | undefined> = {
      query,
      directory_id: options.directory_id,
      depth: options.depth,
      'types[]': options.type,
      cursor: options.cursor,
      limit: options.limit ?? 25,
      with: 'path',
    };
    if (options.modified_after || options.modified_before) {
      params.modified_at = 'custom';
      params.modified_after = options.modified_after;
      params.modified_before = options.modified_before;
    }
    return this.request<KDriveCursorResponse<KDriveFile[]>>(
      'GET',
      `/3/drive/${seg(driveId)}/files/search`,
      undefined,
      params,
    );
  }

  async createKDriveDirectory(
    driveId: number,
    name: string,
    parentId: number = KDRIVE_ROOT_DIRECTORY_ID,
    onlyForMe = false,
  ): Promise<ApiResponse<KDriveFile>> {
    return this.request<ApiResponse<KDriveFile>>(
      'POST',
      `/3/drive/${seg(driveId)}/files/${seg(parentId)}/directory`,
      { name, only_for_me: onlyForMe },
    );
  }

  async moveKDriveFile(driveId: number, fileId: number, destinationDirectoryId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>(
      'POST',
      `/3/drive/${seg(driveId)}/files/${seg(fileId)}/move/${seg(destinationDirectoryId)}`,
    );
  }

  async copyKDriveFile(driveId: number, fileId: number, destinationDirectoryId: number): Promise<ApiResponse<KDriveFile>> {
    return this.request<ApiResponse<KDriveFile>>(
      'POST',
      `/3/drive/${seg(driveId)}/files/${seg(fileId)}/copy/${seg(destinationDirectoryId)}`,
    );
  }

  async renameKDriveFile(driveId: number, fileId: number, name: string): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('POST', `/2/drive/${seg(driveId)}/files/${seg(fileId)}/rename`, { name });
  }

  /** Moves a file or directory to the trash (recoverable). */
  async deleteKDriveFile(driveId: number, fileId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('DELETE', `/2/drive/${seg(driveId)}/files/${seg(fileId)}`);
  }

  async uploadKDriveFile(driveId: number, options: KDriveUploadOptions): Promise<ApiResponse<KDriveFile>> {
    const result = await this.requestBinary('POST', `/3/drive/${seg(driveId)}/upload`, {
      body: options.content,
      contentType: 'application/octet-stream',
      queryParams: {
        directory_id: options.directory_id,
        file_name: options.file_name,
        total_size: options.content.byteLength,
        conflict: options.conflict ?? 'rename',
        directory_path: options.directory_path,
        last_modified_at: options.last_modified_at,
      },
    });
    return JSON.parse(new TextDecoder().decode(result.bytes)) as ApiResponse<KDriveFile>;
  }

  async downloadKDriveFile(driveId: number, fileId: number, maxBytes?: number): Promise<BinaryResponse> {
    return this.requestBinary('GET', `/2/drive/${seg(driveId)}/files/${seg(fileId)}/download`, { maxBytes });
  }

  // Share links
  async getKDriveShareLink(driveId: number, fileId: number): Promise<ApiResponse<KDriveShareLink>> {
    return this.request<ApiResponse<KDriveShareLink>>('GET', `/2/drive/${seg(driveId)}/files/${seg(fileId)}/link`);
  }

  async createKDriveShareLink(driveId: number, fileId: number, options: KDriveShareLinkOptions): Promise<ApiResponse<KDriveShareLink>> {
    return this.request<ApiResponse<KDriveShareLink>>('POST', `/2/drive/${seg(driveId)}/files/${seg(fileId)}/link`, options);
  }

  async updateKDriveShareLink(driveId: number, fileId: number, options: Partial<KDriveShareLinkOptions>): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('PUT', `/2/drive/${seg(driveId)}/files/${seg(fileId)}/link`, options);
  }

  async deleteKDriveShareLink(driveId: number, fileId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('DELETE', `/2/drive/${seg(driveId)}/files/${seg(fileId)}/link`);
  }

  // Access (sharing with users)
  async listKDriveFileAccess(driveId: number, fileId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>(
      'GET',
      `/2/drive/${seg(driveId)}/files/${seg(fileId)}/access`,
      undefined,
      { with: 'user', no_avatar_default: 1 },
    );
  }

  async inviteKDriveAccess(
    driveId: number,
    fileId: number,
    invitation: { emails: string[]; right: 'read' | 'write' | 'manage'; message?: string; lang?: string },
  ): Promise<ApiResponse<unknown>> {
    const body: Record<string, unknown> = { emails: invitation.emails, right: invitation.right };
    if (invitation.message) body.message = invitation.message;
    return this.request<ApiResponse<unknown>>(
      'POST',
      `/2/drive/${seg(driveId)}/files/${seg(fileId)}/access/invitations`,
      body,
      { lang: invitation.lang ?? 'en' },
    );
  }

  // Trash
  async listKDriveTrash(driveId: number, options: { cursor?: string; limit?: number } = {}): Promise<KDriveCursorResponse<KDriveFile[]>> {
    return this.request<KDriveCursorResponse<KDriveFile[]>>('GET', `/3/drive/${seg(driveId)}/trash`, undefined, {
      cursor: options.cursor,
      limit: options.limit,
    });
  }

  async restoreKDriveFile(driveId: number, fileId: number, destinationDirectoryId?: number): Promise<ApiResponse<unknown>> {
    const body = destinationDirectoryId !== undefined ? { destination_directory_id: destinationDirectoryId } : undefined;
    return this.request<ApiResponse<unknown>>('POST', `/2/drive/${seg(driveId)}/trash/${seg(fileId)}/restore`, body);
  }

  /** Permanently deletes a single trashed file (irreversible). */
  async deleteKDriveTrashedFile(driveId: number, fileId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('DELETE', `/2/drive/${seg(driveId)}/trash/${seg(fileId)}`);
  }

  /** Permanently deletes everything in the trash (irreversible). */
  async emptyKDriveTrash(driveId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('DELETE', `/2/drive/${seg(driveId)}/trash`);
  }

  // Favorites, recents, shared with me, activity
  async listKDriveFavorites(driveId: number, options: { cursor?: string; limit?: number } = {}): Promise<KDriveCursorResponse<KDriveFile[]>> {
    return this.request<KDriveCursorResponse<KDriveFile[]>>('GET', `/3/drive/${seg(driveId)}/files/favorites`, undefined, {
      cursor: options.cursor,
      limit: options.limit,
      with: 'path',
    });
  }

  async addKDriveFavorite(driveId: number, fileId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('POST', `/2/drive/${seg(driveId)}/files/${seg(fileId)}/favorite`);
  }

  async removeKDriveFavorite(driveId: number, fileId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('DELETE', `/2/drive/${seg(driveId)}/files/${seg(fileId)}/favorite`);
  }

  async listKDriveRecents(driveId: number, type?: 'file' | 'dir'): Promise<KDriveCursorResponse<KDriveFile[]>> {
    return this.request<KDriveCursorResponse<KDriveFile[]>>('GET', `/3/drive/${seg(driveId)}/files/recents`, undefined, {
      'type[]': type,
      with: 'path',
    });
  }

  async listKDriveSharedWithMe(driveId: number, type?: 'file' | 'dir'): Promise<KDriveCursorResponse<KDriveFile[]>> {
    return this.request<KDriveCursorResponse<KDriveFile[]>>('GET', `/3/drive/${seg(driveId)}/files/shared_with_me`, undefined, {
      'type[]': type,
    });
  }

  async getKDriveActivity(
    driveId: number,
    fileId?: number,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<KDriveCursorResponse<KDriveActivity[]>> {
    const path = fileId !== undefined
      ? `/3/drive/${seg(driveId)}/files/${seg(fileId)}/activities`
      : `/3/drive/${seg(driveId)}/files/activities`;
    return this.request<KDriveCursorResponse<KDriveActivity[]>>('GET', path, undefined, {
      with: fileId !== undefined ? 'user' : 'file,user',
      cursor: options.cursor,
      limit: options.limit ?? 50,
      no_avatar_default: 1,
    });
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
