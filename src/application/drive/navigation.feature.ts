import { z } from 'zod';
import { driveSchema, itemSchema, itemPageSchema } from '../../domain/drive/item.js';
import type { ToolContract } from '../../domain/tool-contract.js';
import type { ToolBinding } from '../feature-module.js';
import type { DriveNavigationPort } from './navigation.port.js';

export const PAGE_LIMIT_MIN = 1;
export const PAGE_LIMIT_MAX = 200;
export const PAGE_LIMIT_DEFAULT = 50;

const id = z.number().int().positive();
export const paginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(PAGE_LIMIT_MIN).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
});
const listDrivesInput = z.object({ account_id: id });
const getDriveInput = z.object({ drive_id: id });
const getItemInput = getDriveInput.extend({ file_id: id });
const listItemsInput = getDriveInput.extend({
  ...paginationSchema.shape,
  directory_id: id.default(1),
  type: z.enum(['file', 'dir']).optional(),
  order_by: z.enum(['name', 'size', 'last_modified_at', 'added_at', 'type']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
const searchInput = getDriveInput.extend({
  ...paginationSchema.shape,
  query: z.string().min(1),
  directory_id: id.optional(),
  depth: z.enum(['child', 'unlimited']).optional(),
  type: z.enum(['file', 'dir']).optional(),
  modified_after: z.string().min(1).optional(),
  modified_before: z.string().min(1).optional(),
});

function contract(
  name: string,
  description: string,
  inputSchema: z.ZodObject,
  outputSchema: z.ZodObject,
  paginated = false,
): ToolContract {
  return {
    name,
    description,
    inputSchema,
    outputSchema,
    classification: 'read',
    rawApi: false,
    idempotent: true,
    experimental: false,
    limits: paginated
      ? {
          pageLimitMin: PAGE_LIMIT_MIN,
          pageLimitMax: PAGE_LIMIT_MAX,
          pageLimitDefault: PAGE_LIMIT_DEFAULT,
        }
      : {},
    text: (output) => JSON.stringify(output, null, 2),
  };
}

export const tools: readonly ToolContract[] = [
  contract(
    'infomaniak_list_kdrives',
    'List all kDrives of an account',
    listDrivesInput,
    z.object({ drives: z.array(driveSchema) }),
  ),
  contract(
    'infomaniak_get_kdrive',
    'Get details of a kDrive',
    getDriveInput,
    z.object({ drive: driveSchema }),
  ),
  contract(
    'infomaniak_list_kdrive_files',
    'List a directory page (root directory: 1); pass cursor while hasMore is true',
    listItemsInput,
    itemPageSchema,
    true,
  ),
  contract(
    'infomaniak_get_kdrive_file',
    'Read file or directory metadata',
    getItemInput,
    z.object({ item: itemSchema }),
  ),
  contract(
    'infomaniak_search_kdrive_files',
    'Search files and directories by name; pass cursor while hasMore is true',
    searchInput,
    itemPageSchema,
    true,
  ),
];

export function createNavigationBindings(port: DriveNavigationPort): ToolBinding[] {
  const handlers: ToolBinding['handle'][] = [
    (input) => port.listDrives(listDrivesInput.parse(input).account_id),
    (input) => port.getDrive(getDriveInput.parse(input).drive_id),
    (input) => {
      const { drive_id, directory_id, ...options } = listItemsInput.parse(input);
      return port.listItems(drive_id, directory_id, options);
    },
    (input) => {
      const { drive_id, file_id } = getItemInput.parse(input);
      return port.getItem(drive_id, file_id);
    },
    (input) => {
      const { drive_id, query, ...options } = searchInput.parse(input);
      return port.search(drive_id, query, options);
    },
  ];
  return tools.map((contract, index) => ({ contract, handle: handlers[index] }));
}
