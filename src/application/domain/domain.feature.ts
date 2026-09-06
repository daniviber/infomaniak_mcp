import { z } from 'zod';
import {
  nameserverSchema,
  dnsRecordSchema,
  nameserversUpdatedSchema,
  renewedSchema,
  dnsDeletedSchema,
} from '../../domain/domain/domain.js';
import type { ToolContract } from '../../domain/tool-contract.js';
import type { ToolBinding } from '../feature-module.js';
import type { DomainPort } from './domain.port.js';

const domainInput = z.object({ domain: z.string().min(1) });
const nameserversInput = domainInput.extend({
  nameservers: z.array(z.object({ host: z.string().min(1), ip: z.string().optional() })).min(1),
});
const renewInput = domainInput.extend({ duration: z.number().int().positive() });
const recordInput = domainInput.extend({ record_id: z.string().min(1) });
const recordFields = z.object({
  source: z.string(),
  type: z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA']),
  target: z.string().min(1),
  ttl: z.number().min(60).max(86400).optional(),
  priority: z.number().min(0).max(65535).optional(),
});
const createInput = domainInput.extend(recordFields.shape);
const updateInput = recordInput.extend(recordFields.partial().shape);
function contract(
  name: string,
  inputSchema: z.ZodObject,
  outputSchema: z.ZodObject,
  classification: ToolContract['classification'],
  limits: ToolContract['limits'] = {},
  experimental = false,
): ToolContract {
  return {
    name,
    description: name.replace('infomaniak_', '').replaceAll('_', ' '),
    inputSchema,
    outputSchema,
    classification,
    rawApi: false,
    idempotent: classification === 'read',
    experimental,
    limits,
    text: (output) => JSON.stringify(output, null, 2),
  };
}
const dnsLimits = { ttlMin: 60, ttlMax: 86400, priorityMin: 0, priorityMax: 65535 };
export const tools: readonly ToolContract[] = [
  contract(
    'infomaniak_get_domain_nameservers',
    domainInput,
    z.object({ nameservers: z.array(nameserverSchema) }),
    'read',
    {},
    true,
  ),
  contract(
    'infomaniak_update_domain_nameservers',
    nameserversInput,
    nameserversUpdatedSchema,
    'write',
  ),
  contract('infomaniak_renew_domain', renewInput, renewedSchema, 'write'),
  contract(
    'infomaniak_list_dns_records',
    domainInput,
    z.object({ records: z.array(dnsRecordSchema) }),
    'read',
  ),
  contract(
    'infomaniak_create_dns_record',
    createInput,
    z.object({ record: dnsRecordSchema }),
    'write',
    dnsLimits,
  ),
  contract(
    'infomaniak_update_dns_record',
    updateInput,
    z.object({ record: dnsRecordSchema }),
    'write',
    dnsLimits,
  ),
  contract('infomaniak_delete_dns_record', recordInput, dnsDeletedSchema, 'destructive'),
];
export function createDomainBindings(port: DomainPort): ToolBinding[] {
  const handlers: ToolBinding['handle'][] = [
    (input) => port.getNameservers(domainInput.parse(input).domain),
    (input) => {
      const v = nameserversInput.parse(input);
      return port.updateNameservers(v.domain, v.nameservers);
    },
    (input) => {
      const v = renewInput.parse(input);
      return port.renew(v.domain, v.duration);
    },
    (input) => port.listDnsRecords(domainInput.parse(input).domain),
    (input) => {
      const { domain, ...record } = createInput.parse(input);
      return port.createDnsRecord(domain, record);
    },
    (input) => {
      const { domain, record_id, ...record } = updateInput.parse(input);
      return port.updateDnsRecord(domain, record_id, record);
    },
    (input) => {
      const v = recordInput.parse(input);
      return port.deleteDnsRecord(v.domain, v.record_id);
    },
  ];
  return tools.map((contract, index) => ({ contract, handle: handlers[index] }));
}
