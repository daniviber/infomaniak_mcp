import { z } from 'zod';
import { itemSchema } from '../../../domain/drive/item.js';
import {
  trashPageSchema,
  trashMutationSchema,
  emptyTrashSchema,
} from '../../../domain/drive/trash.js';
import type { DriveTrashPort } from '../../../application/drive/trash.port.js';
import type { PageRequest } from '../../../application/drive/navigation.port.js';
import type { InfomaniakGateway } from './gateway.js';

// Relevé /3/drive/{id}/trash: same item fields; Unix integer dates and nullable created_at inherited from the folder row.
const itemDto = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  type: z.enum(['dir', 'file']),
  size: z.number().int().nonnegative().optional(),
  created_at: z.number().int().nullable().optional(),
  last_modified_at: z.number().int().optional(),
  added_at: z.number().int().optional(),
  parent_id: z.number().int().nonnegative().optional(),
  mime_type: z.string().optional(),
  extension_type: z.string().optional(),
  path: z.string().optional(),
  visibility: z.string().optional(),
  status: z.string().optional(),
  is_favorite: z.boolean().optional(),
});
const envelope = <T extends z.ZodType>(data: T) => z.object({ result: z.literal('success'), data });
const pageDto = envelope(z.array(itemDto))
  .extend({
    cursor: z.string().min(1).nullable().optional(),
    has_more: z.boolean().optional(),
  })
  .refine((page) => !page.has_more || Boolean(page.cursor), 'Missing next cursor');

function mapItem(dto: z.infer<typeof itemDto>) {
  return itemSchema.parse({
    id: dto.id,
    name: dto.name,
    type: dto.type,
    sizeBytes: dto.size,
    ...(dto.created_at == null ? {} : { createdAt: new Date(dto.created_at * 1000).toISOString() }),
    modifiedAt:
      dto.last_modified_at === undefined
        ? undefined
        : new Date(dto.last_modified_at * 1000).toISOString(),
    addedAt: dto.added_at === undefined ? undefined : new Date(dto.added_at * 1000).toISOString(),
    parentId: dto.parent_id,
    mimeType: dto.mime_type,
    extensionType: dto.extension_type,
    path: dto.path,
    visibility: dto.visibility,
    status: dto.status,
    isFavorite: dto.is_favorite,
  });
}
function mapPage(dto: z.infer<typeof pageDto>) {
  return trashPageSchema.parse({
    items: dto.data.map(mapItem),
    hasMore: dto.has_more ?? false,
    ...(dto.has_more ? { cursor: dto.cursor } : {}),
  });
}

export class KDriveTrashAdapter implements DriveTrashPort {
  constructor(private readonly gateway: InfomaniakGateway) {}

  async list(driveId: number, options: PageRequest) {
    const dto = await this.gateway.request(
      {
        method: 'GET',
        pathSegments: ['3', 'drive', driveId, 'trash'],
        query: { cursor: options.cursor, limit: options.limit },
      },
      pageDto,
    );
    return mapPage(dto);
  }
  async restore(driveId: number, fileId: number, destinationDirectoryId?: number) {
    await this.gateway.request(
      {
        method: 'POST',
        pathSegments: ['2', 'drive', driveId, 'trash', fileId, 'restore'],
        body:
          destinationDirectoryId === undefined
            ? undefined
            : { destination_directory_id: destinationDirectoryId },
        idempotent: false,
      },
      envelope(z.unknown()),
    );
    return trashMutationSchema.parse({ driveId, fileId, operation: 'restore', success: true });
  }
  async permanentDelete(driveId: number, fileId: number) {
    await this.gateway.request(
      {
        method: 'DELETE',
        pathSegments: ['2', 'drive', driveId, 'trash', fileId],
        idempotent: false,
      },
      envelope(z.unknown()),
    );
    return trashMutationSchema.parse({
      driveId,
      fileId,
      operation: 'permanentDelete',
      success: true,
    });
  }
  async empty(driveId: number) {
    await this.gateway.request(
      {
        method: 'DELETE',
        pathSegments: ['2', 'drive', driveId, 'trash'],
        idempotent: false,
      },
      envelope(z.unknown()),
    );
    return emptyTrashSchema.parse({ driveId, operation: 'empty', success: true });
  }
}
