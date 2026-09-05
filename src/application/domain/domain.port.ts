import type {
  Nameserver,
  DnsRecord,
  NameserversUpdated,
  Renewed,
  DnsDeleted,
} from '../../domain/domain/domain.js';

export interface DnsRecordInput {
  source: string;
  type: string;
  target: string;
  ttl?: number;
  priority?: number;
}
export interface DomainPort {
  getNameservers(domain: string): Promise<{ nameservers: Nameserver[] }>;
  updateNameservers(domain: string, nameservers: Nameserver[]): Promise<NameserversUpdated>;
  renew(domain: string, duration: number): Promise<Renewed>;
  listDnsRecords(domain: string): Promise<{ records: DnsRecord[] }>;
  createDnsRecord(domain: string, record: DnsRecordInput): Promise<{ record: DnsRecord }>;
  updateDnsRecord(
    domain: string,
    recordId: number,
    record: Partial<DnsRecordInput>,
  ): Promise<{ record: DnsRecord }>;
  deleteDnsRecord(domain: string, recordId: number): Promise<DnsDeleted>;
}
