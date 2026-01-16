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

export class InfomaniakClient {
  private token: string;
  private baseUrl: string;

  constructor(config: InfomaniakConfig) {
    this.token = config.token;
    this.baseUrl = config.baseUrl || 'https://api.infomaniak.com';
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    
    // Add query parameters
    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) {
          params.append(key, String(value));
        }
      }
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
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
        errorMessage = errorJson.error?.description || errorJson.message || errorText;
      } catch {
        errorMessage = errorText;
      }
      throw new Error(`Infomaniak API Error (${response.status}): ${errorMessage}`);
    }

    const data = await response.json();
    return data as T;
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

  // kDrive
  async getKDrives(accountId: number): Promise<ApiResponse<KDrive[]>> {
    return this.request<ApiResponse<KDrive[]>>('GET', `/2/drive`, undefined, { account_id: accountId });
  }

  async getKDrive(driveId: number): Promise<ApiResponse<KDrive>> {
    return this.request<ApiResponse<KDrive>>('GET', `/2/drive/${driveId}`);
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
  async getVpsList(): Promise<ApiResponse<unknown[]>> {
    return this.request<ApiResponse<unknown[]>>('GET', `/1/vps`);
  }

  async getVps(vpsId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('GET', `/1/vps/${vpsId}`);
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
  async getDedicatedServers(): Promise<ApiResponse<unknown[]>> {
    return this.request<ApiResponse<unknown[]>>('GET', `/1/dedicated`);
  }

  async getDedicatedServer(serverId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('GET', `/1/dedicated/${serverId}`);
  }

  async rebootDedicatedServer(serverId: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('POST', `/1/dedicated/${serverId}/reboot`);
  }

  // SSL Certificates
  async getCertificates(accountId: number): Promise<ApiResponse<unknown[]>> {
    return this.request<ApiResponse<unknown[]>>('GET', `/1/certificate`, undefined, { account_id: accountId });
  }

  async getCertificate(certId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('GET', `/1/certificate/${certId}`);
  }

  // Invoicing
  async getInvoices(accountId: number): Promise<ApiResponse<unknown[]>> {
    return this.request<ApiResponse<unknown[]>>('GET', `/1/invoicing/${accountId}/invoice/list`);
  }

  async getInvoice(accountId: number, invoiceId: number): Promise<ApiResponse<unknown>> {
    return this.request<ApiResponse<unknown>>('GET', `/1/invoicing/${accountId}/invoice/${invoiceId}`);
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
