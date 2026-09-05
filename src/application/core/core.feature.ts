import { z } from 'zod';
import {
  accountSchema,
  profileSchema,
  productSchema,
  type Account,
  type Profile,
  type Product,
} from '../../domain/account/account.js';
import type { ToolContract } from '../../domain/tool-contract.js';
import type { ToolBinding } from '../feature-module.js';

export interface CorePort {
  ping(): Promise<{ message: string }>;
  getProfile(): Promise<{ profile: Profile }>;
  listAccounts(): Promise<{ accounts: Account[] }>;
  getAccount(accountId: number): Promise<{ account: Account }>;
  listProducts(accountId: number): Promise<{ products: Product[] }>;
}
const empty = z.object({});
const accountInput = z.object({ account_id: z.number().int().positive() });
const definitions: [string, z.ZodObject, z.ZodObject][] = [
  ['infomaniak_ping', empty, z.object({ message: z.string() })],
  ['infomaniak_get_profile', empty, z.object({ profile: profileSchema })],
  ['infomaniak_list_accounts', empty, z.object({ accounts: z.array(accountSchema) })],
  ['infomaniak_get_account', accountInput, z.object({ account: accountSchema })],
  ['infomaniak_list_products', accountInput, z.object({ products: z.array(productSchema) })],
];
export const tools: readonly ToolContract[] = definitions.map(
  ([name, inputSchema, outputSchema]) => ({
    name,
    description: name.replace('infomaniak_', '').replaceAll('_', ' '),
    inputSchema,
    outputSchema,
    classification: 'read',
    rawApi: false,
    idempotent: true,
    experimental: false,
    limits: {},
    text: (output) => JSON.stringify(output, null, 2),
  }),
);
export function createCoreBindings(port: CorePort): ToolBinding[] {
  const handlers: ToolBinding['handle'][] = [
    () => port.ping(),
    () => port.getProfile(),
    () => port.listAccounts(),
    (input) => port.getAccount(accountInput.parse(input).account_id),
    (input) => port.listProducts(accountInput.parse(input).account_id),
  ];
  return tools.map((contract, index) => ({ contract, handle: handlers[index] }));
}
