import { z } from 'zod';
import { driveSchema, itemSchema, itemPageSchema } from '../../../domain/drive/item.js';
import type {
  DriveNavigationPort,
  ListItemsOptions,
  SearchOptions,
} from '../../../application/drive/navigation.port.js';
import type { InfomaniakGateway } from './gateway.js';

// Relevé /2/drive and /2/drive/{id}: used_size:int.
const driveDto = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  account_id: z.number().int().positive(),
  used_size: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
});
// Relevé /3/drive/{id}/files/1[/files]: created_at:null, added_at:int, last_modified_at:int; size and mime_type absent on folders.
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

// /3/drive/{id}/files/search was not measured: retain its baseline numeric DTO.
const searchPageDto = envelope(
  z.array(
    itemDto.extend({
      created_at: z.number().optional(),
      last_modified_at: z.number().optional(),
      added_at: z.number().optional(),
    }),
  ),
)
  .extend({
    cursor: z.string().min(1).nullable().optional(),
    has_more: z.boolean().optional(),
  })
  .refine((page) => !page.has_more || Boolean(page.cursor), 'Missing next cursor');

function mapDrive(dto: z.infer<typeof driveDto>) {
  return driveSchema.parse({
    id: dto.id,
    name: dto.name,
    accountId: dto.account_id,
    usedBytes: dto.used_size,
    capacityBytes: dto.size,
  });
}
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
  return itemPageSchema.parse({
    items: dto.data.map(mapItem),
    hasMore: dto.has_more ?? false,
    ...(dto.has_more ? { cursor: dto.cursor } : {}),
  });
}

export class KDriveNavigationAdapter implements DriveNavigationPort {
  constructor(private readonly gateway: InfomaniakGateway) {}

  async listDrives(accountId: number) {
    const dto = await this.gateway.request(
      { method: 'GET', pathSegments: ['2', 'drive'], query: { account_id: accountId } },
      envelope(z.array(driveDto)),
    );
    return { drives: dto.data.map(mapDrive) };
  }
  async getDrive(driveId: number) {
    const dto = await this.gateway.request(
      { method: 'GET', pathSegments: ['2', 'drive', driveId] },
      envelope(driveDto),
    );
    return { drive: mapDrive(dto.data) };
  }
  async listItems(driveId: number, directoryId: number, options: ListItemsOptions) {
    const dto = await this.gateway.request(
      {
        method: 'GET',
        pathSegments: ['3', 'drive', driveId, 'files', directoryId, 'files'],
        query: {
          'type[]': options.type,
          cursor: options.cursor,
          limit: options.limit,
          order_by: options.order_by,
          order: options.order,
          with: 'path,capabilities,is_favorite,sharelink',
        },
      },
      pageDto,
    );
    return mapPage(dto);
  }
  async getItem(driveId: number, itemId: number) {
    const dto = await this.gateway.request(
      {
        method: 'GET',
        pathSegments: ['3', 'drive', driveId, 'files', itemId],
        query: { with: 'path,capabilities,is_favorite,sharelink,users,version' },
      },
      envelope(itemDto),
    );
    return { item: mapItem(dto.data) };
  }
  async search(driveId: number, query: string, options: SearchOptions) {
    const dto = await this.gateway.request(
      {
        method: 'GET',
        pathSegments: ['3', 'drive', driveId, 'files', 'search'],
        query: {
          query,
          directory_id: options.directory_id,
          depth: options.depth,
          'types[]': options.type,
          cursor: options.cursor,
          limit: options.limit,
          with: 'path',
          ...(options.modified_after || options.modified_before
            ? {
                modified_at: 'custom',
                modified_after: options.modified_after,
                modified_before: options.modified_before,
              }
            : {}),
        },
      },
      searchPageDto,
    );
    return mapPage(dto);
  }
}
