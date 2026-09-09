import { z } from 'zod';
import {
  trashPageSchema,
  trashMutationSchema,
  emptyTrashSchema,
} from '../../domain/drive/trash.js';
import type { ToolContract } from '../../domain/tool-contract.js';
import { createFeatureModule, type ToolBinding } from '../feature-module.js';
import { PAGE_LIMIT_MIN, PAGE_LIMIT_MAX, PAGE_LIMIT_DEFAULT } from './navigation.feature.js';
import type { DriveTrashPort } from './trash.port.js';

const id = z.number().int().positive();
const driveInput = z.object({ drive_id: id });
const fileInput = driveInput.extend({ file_id: id });
const restoreInput = fileInput.extend({ destination_directory_id: id.optional() });
const listInput = driveInput.extend({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(PAGE_LIMIT_MIN).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
});
const specs = [
  [
    'infomaniak_list_kdrive_trash',
    'List a trash page; pass cursor while hasMore is true',
    listInput,
    trashPageSchema,
    'read',
  ],
  [
    'infomaniak_restore_kdrive_file',
    'Restore a trashed file or directory, optionally into another directory',
    restoreInput,
    trashMutationSchema,
    'write',
  ],
  [
    'infomaniak_delete_kdrive_trashed_file_permanently',
    'Permanently delete a trashed item. This cannot be undone.',
    fileInput,
    trashMutationSchema,
    'destructive',
  ],
  [
    'infomaniak_empty_kdrive_trash',
    'Permanently delete everything in the trash. This cannot be undone.',
    driveInput,
    emptyTrashSchema,
    'destructive',
  ],
] as const;
export const tools: readonly ToolContract[] = specs.map(
  ([name, description, inputSchema, outputSchema, classification]): ToolContract => ({
    name,
    description,
    inputSchema,
    outputSchema,
    classification,
    rawApi: false,
    experimental: false,
    idempotent: classification === 'read',
    limits:
      classification === 'read'
        ? {
            pageLimitMin: PAGE_LIMIT_MIN,
            pageLimitMax: PAGE_LIMIT_MAX,
            pageLimitDefault: PAGE_LIMIT_DEFAULT,
          }
        : {},
    text: (output) => JSON.stringify(output, null, 2),
  }),
);

export function createTrashBindings(port: DriveTrashPort): ToolBinding[] {
  const handlers: ToolBinding['handle'][] = [
    (input) => {
      const { drive_id, ...options } = listInput.parse(input);
      return port.list(drive_id, options);
    },
    (input) => {
      const v = restoreInput.parse(input);
      return port.restore(v.drive_id, v.file_id, v.destination_directory_id);
    },
    (input) => {
      const v = fileInput.parse(input);
      return port.permanentDelete(v.drive_id, v.file_id);
    },
    (input) => port.empty(driveInput.parse(input).drive_id),
  ];
  return tools.map((contract, index) => ({ contract, handle: handlers[index] }));
}

export function createTrashFeature(port: DriveTrashPort) {
  return createFeatureModule(createTrashBindings(port));
}
