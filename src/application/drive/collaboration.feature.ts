import { z } from 'zod';
import {
  accessRightSchema,
  linkRightSchema,
  accessSchema,
  shareLinkSchema,
  acknowledgementSchema,
  activityPageSchema,
} from '../../domain/drive/collaboration.js';
import { itemPageSchema } from '../../domain/drive/item.js';
import type { ToolContract } from '../../domain/tool-contract.js';
import type { ToolBinding } from '../feature-module.js';
import type { DriveCollaborationPort } from './collaboration.port.js';
import {
  PAGE_LIMIT_MIN,
  PAGE_LIMIT_MAX,
  PAGE_LIMIT_DEFAULT,
  paginationSchema,
} from './navigation.feature.js';

const id = z.number().int().positive();
const fileInput = z.object({ drive_id: id, file_id: id });
const settings = z.object({
  right: linkRightSchema,
  password: z.string().min(1).optional(),
  valid_until: z.number().int().nonnegative().optional(),
  can_download: z.boolean().optional(),
  can_edit: z.boolean().optional(),
  can_see_stats: z.boolean().optional(),
});
const createInput = fileInput
  .extend(settings.shape)
  .refine((v) => v.right !== 'password' || Boolean(v.password), {
    message: 'Password required',
    path: ['password'],
  });
const updateInput = fileInput
  .extend(settings.partial().shape)
  .refine((v) => v.right !== 'password' || Boolean(v.password), {
    message: 'Password required',
    path: ['password'],
  });
const inviteInput = fileInput.extend({
  emails: z.array(z.email()).min(1),
  right: accessRightSchema,
  message: z.string().optional(),
  lang: z.enum(['fr', 'en', 'de', 'it', 'es']).default('en'),
});
const pageInput = z.object({ drive_id: id, ...paginationSchema.shape });
const filteredInput = pageInput.extend({ type: z.enum(['file', 'dir']).optional() });
const activityInput = pageInput.extend({ file_id: id.optional() });

function contract(
  name: string,
  inputSchema: z.ZodObject,
  outputSchema: z.ZodObject,
  classification: ToolContract['classification'],
  paginated = false,
): ToolContract {
  return {
    name,
    description: name.replace('infomaniak_', '').replaceAll('_', ' '),
    inputSchema,
    outputSchema,
    classification,
    rawApi: false,
    idempotent: classification === 'read',
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
    'infomaniak_get_kdrive_share_link',
    fileInput,
    z.object({ link: shareLinkSchema }),
    'read',
  ),
  contract(
    'infomaniak_share_kdrive_file',
    createInput,
    z.object({ link: shareLinkSchema }),
    'write',
  ),
  contract('infomaniak_update_kdrive_share_link', updateInput, acknowledgementSchema, 'write'),
  contract('infomaniak_delete_kdrive_share_link', fileInput, acknowledgementSchema, 'destructive'),
  contract(
    'infomaniak_list_kdrive_file_access',
    fileInput,
    z.object({ access: z.array(accessSchema) }),
    'read',
  ),
  contract(
    'infomaniak_invite_kdrive_access',
    inviteInput,
    z.object({ invitations: z.array(accessSchema) }),
    'write',
  ),
  contract('infomaniak_list_kdrive_favorites', pageInput, itemPageSchema, 'read', true),
  contract('infomaniak_add_kdrive_favorite', fileInput, acknowledgementSchema, 'write'),
  contract('infomaniak_remove_kdrive_favorite', fileInput, acknowledgementSchema, 'write'),
  contract('infomaniak_list_kdrive_recents', filteredInput, itemPageSchema, 'read', true),
  contract('infomaniak_list_kdrive_shared_with_me', filteredInput, itemPageSchema, 'read', true),
  contract('infomaniak_get_kdrive_activity', activityInput, activityPageSchema, 'read', true),
];
export function createCollaborationBindings(port: DriveCollaborationPort): ToolBinding[] {
  const handlers: ToolBinding['handle'][] = [
    (input) => {
      const v = fileInput.parse(input);
      return port.getShareLink(v.drive_id, v.file_id);
    },
    (input) => {
      const { drive_id, file_id, ...options } = createInput.parse(input);
      return port.createShareLink(drive_id, file_id, options);
    },
    (input) => {
      const { drive_id, file_id, ...options } = updateInput.parse(input);
      return port.updateShareLink(drive_id, file_id, options);
    },
    (input) => {
      const v = fileInput.parse(input);
      return port.deleteShareLink(v.drive_id, v.file_id);
    },
    (input) => {
      const v = fileInput.parse(input);
      return port.listAccess(v.drive_id, v.file_id);
    },
    (input) => {
      const { drive_id, file_id, ...options } = inviteInput.parse(input);
      return port.inviteAccess(drive_id, file_id, options);
    },
    (input) => {
      const { drive_id, ...options } = pageInput.parse(input);
      return port.listFavorites(drive_id, options);
    },
    (input) => {
      const v = fileInput.parse(input);
      return port.addFavorite(v.drive_id, v.file_id);
    },
    (input) => {
      const v = fileInput.parse(input);
      return port.removeFavorite(v.drive_id, v.file_id);
    },
    (input) => {
      const { drive_id, ...options } = filteredInput.parse(input);
      return port.recents(drive_id, options);
    },
    (input) => {
      const { drive_id, ...options } = filteredInput.parse(input);
      return port.sharedWithMe(drive_id, options);
    },
    (input) => {
      const { drive_id, file_id, ...options } = activityInput.parse(input);
      return port.activity(drive_id, file_id, options);
    },
  ];
  return tools.map((contract, index) => ({ contract, handle: handlers[index] }));
}
