import { z } from 'zod';
import { accountSchema, profileSchema, productSchema } from '../../../domain/account/account.js';
import {
  nameserverSchema,
  dnsRecordSchema,
  type Nameserver,
} from '../../../domain/domain/domain.js';
import type { CorePort } from '../../../application/core/core.feature.js';
import type { DomainPort, DnsRecordInput } from '../../../application/domain/domain.port.js';
import type { InfomaniakGateway, GatewayRequest } from './gateway.js';

const id = z.number().int().positive();
const envelope = <T extends z.ZodType>(data: T) => z.object({ result: z.literal('success'), data });
// Relevé /1/account: created_at:int; /1/profile: firstname:string, lastname:string.
const accountDto = z.object({
  id,
  name: z.string(),
  legal_entity_type: z.string().optional(),
  created_at: z.number().int().optional(),
});
const profileDto = z.object({
  id,
  login: z.string(),
  email: z.string(),
  firstname: z.string(),
  lastname: z.string(),
  current_account_id: id.optional(),
});
const productDto = z.object({
  id,
  service_id: id,
  service_name: z.string(),
  account_id: id,
  customer_name: z.string(),
});
// Relevé /1/domain/{domain}/dns/record: id:string. Write DTO remains baseline.
const writeRecordDto = dnsRecordSchema.extend({ id });
const mapAccount = (v: z.infer<typeof accountDto>) =>
  accountSchema.parse({
    id: v.id,
    name: v.name,
    legalEntityType: v.legal_entity_type,
    createdAt: v.created_at === undefined ? undefined : new Date(v.created_at * 1000).toISOString(),
  });
const domainPath = (domain: string, ...suffix: (string | number)[]) => [
  '1',
  'domain',
  domain,
  ...suffix,
];

export class CoreDomainAdapter implements CorePort, DomainPort {
  constructor(private readonly gateway: InfomaniakGateway) {}

  async ping() {
    const { data } = await this.gateway.request(
      { method: 'GET', pathSegments: ['1', 'ping'] },
      envelope(z.string()),
    );
    return { message: data };
  }
  async getProfile() {
    const { data: v } = await this.gateway.request(
      { method: 'GET', pathSegments: ['1', 'profile'] },
      envelope(profileDto),
    );
    return {
      profile: profileSchema.parse({
        id: v.id,
        login: v.login,
        email: v.email,
        firstName: v.firstname,
        lastName: v.lastname,
        currentAccountId: v.current_account_id,
      }),
    };
  }
  async listAccounts() {
    const { data } = await this.gateway.request(
      { method: 'GET', pathSegments: ['1', 'account'] },
      envelope(z.array(accountDto)),
    );
    return { accounts: data.map(mapAccount) };
  }
  async getAccount(accountId: number) {
    const { data } = await this.gateway.request(
      { method: 'GET', pathSegments: ['1', 'account', accountId] },
      envelope(accountDto),
    );
    return { account: mapAccount(data) };
  }
  async listProducts(accountId: number) {
    const { data } = await this.gateway.request(
      { method: 'GET', pathSegments: ['1', 'account', accountId, 'product'] },
      envelope(z.array(productDto)),
    );
    return {
      products: data.map((v) =>
        productSchema.parse({
          id: v.id,
          serviceId: v.service_id,
          serviceName: v.service_name,
          accountId: v.account_id,
          customerName: v.customer_name,
        }),
      ),
    };
  }
  async getNameservers(domain: string) {
    const { data } = await this.gateway.request(
      { method: 'GET', pathSegments: domainPath(domain, 'nameserver') },
      envelope(z.array(nameserverSchema)),
    );
    return { nameservers: data.map((v) => nameserverSchema.parse(v)) };
  }
  async updateNameservers(domain: string, nameservers: Nameserver[]) {
    await this.gateway.request(
      {
        method: 'PUT',
        pathSegments: ['2', 'domains', 'domains', domain, 'nameservers'],
        body: { nameservers: nameservers.map((server) => server.host) },
      },
      z.unknown(),
    );
    return { ok: true as const, action: 'update_nameservers' as const, domain };
  }
  async renew(domain: string, duration: number) {
    await this.gateway.request(
      { method: 'POST', pathSegments: domainPath(domain, 'renew'), body: { duration } },
      z.unknown(),
    );
    return { ok: true as const, action: 'renew' as const, domain };
  }
  async listDnsRecords(domain: string) {
    const { data } = await this.gateway.request(
      { method: 'GET', pathSegments: domainPath(domain, 'dns', 'record') },
      envelope(z.array(dnsRecordSchema)),
    );
    return { records: data.map((v) => dnsRecordSchema.parse(v)) };
  }
  private async record(request: GatewayRequest) {
    const { data } = await this.gateway.request(request, envelope(writeRecordDto));
    return { record: dnsRecordSchema.parse({ ...data, id: String(data.id) }) };
  }
  createDnsRecord(domain: string, record: DnsRecordInput) {
    return this.record({
      method: 'POST',
      pathSegments: domainPath(domain, 'dns', 'record'),
      body: record,
    });
  }
  updateDnsRecord(domain: string, recordId: string, record: Partial<DnsRecordInput>) {
    return this.record({
      method: 'PUT',
      pathSegments: domainPath(domain, 'dns', 'record', recordId),
      body: record,
    });
  }
  async deleteDnsRecord(domain: string, recordId: string) {
    await this.gateway.request(
      { method: 'DELETE', pathSegments: domainPath(domain, 'dns', 'record', recordId) },
      z.unknown(),
    );
    return { ok: true as const, action: 'delete_dns_record' as const, domain, recordId };
  }
}
