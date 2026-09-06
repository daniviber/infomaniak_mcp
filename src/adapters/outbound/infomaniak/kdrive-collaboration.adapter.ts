import { z } from 'zod';
import {
  accessRightSchema,
  accessSchema,
  shareLinkSchema,
  acknowledgementSchema,
  activityPageSchema,
  type Access,
  type Acknowledgement,
} from '../../../domain/drive/collaboration.js';
import { itemSchema, itemPageSchema } from '../../../domain/drive/item.js';
import type {
  DriveCollaborationPort,
  ShareLinkOptions,
  InvitationOptions,
  CollaborationPageRequest,
} from '../../../application/drive/collaboration.port.js';
import type { PageRequest } from '../../../application/drive/navigation.port.js';
import type { InfomaniakGateway, GatewayRequest } from './gateway.js';

const envelope = <T extends z.ZodType>(data: T) => z.object({ result: z.literal('success'), data });
const memberDto = z.object({ id: z.number().int().nonnegative(), right: accessRightSchema });
const accessDto = envelope(
  z.object({
    teams: z.array(memberDto),
    users: z.array(memberDto),
    invitations: z.array(memberDto),
  }),
);
// Minimal invitation response fallback and provenance are recorded in the fixture.
const invitationsDto = envelope(z.array(memberDto));
const linkDto = envelope(
  z.object({
    url: z.url(),
    right: shareLinkSchema.shape.right,
    file_id: shareLinkSchema.shape.fileId,
    valid_until: shareLinkSchema.shape.validUntil,
  }),
);
const itemDto = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number().int().nonnegative().optional(),
  parent_id: z.number().int().nonnegative().optional(),
  path: z.string().optional(),
  is_favorite: z.boolean().optional(),
});
const activityDto = z.object({
  id: z.number().int().positive(),
  action: z.string(),
  created_at: z.number(),
  file: itemDto.optional(),
});
const page = <T extends z.ZodType>(item: T) =>
  envelope(z.array(item))
    .extend({ cursor: z.string().min(1).nullable().optional(), has_more: z.boolean().optional() })
    .refine((v) => !v.has_more || Boolean(v.cursor), 'Missing next cursor');
const itemsDto = page(itemDto);
const activitiesDto = page(activityDto);
const mapItem = (v: z.infer<typeof itemDto>) =>
  itemSchema.parse({
    id: v.id,
    name: v.name,
    type: v.type,
    sizeBytes: v.size,
    parentId: v.parent_id,
    path: v.path,
    isFavorite: v.is_favorite,
  });
const mapMember = (v: z.infer<typeof memberDto>, type: Access['type']) =>
  accessSchema.parse({ id: v.id, right: v.right, type });
const mapPagination = (v: { has_more?: boolean; cursor?: string | null }) => ({
  hasMore: v.has_more ?? false,
  ...(v.has_more ? { cursor: v.cursor } : {}),
});
const filePath = (driveId: number, fileId: number, resource: string) => [
  '2',
  'drive',
  driveId,
  'files',
  fileId,
  resource,
];

export class KDriveCollaborationAdapter implements DriveCollaborationPort {
  constructor(private readonly gateway: InfomaniakGateway) {}

  private async link(request: GatewayRequest) {
    const { data } = await this.gateway.request(request, linkDto);
    return {
      link: shareLinkSchema.parse({
        url: data.url,
        right: data.right,
        fileId: data.file_id,
        validUntil: data.valid_until,
      }),
    };
  }
  getShareLink(driveId: number, fileId: number) {
    return this.link({ method: 'GET', pathSegments: filePath(driveId, fileId, 'link') });
  }
  createShareLink(driveId: number, fileId: number, options: ShareLinkOptions) {
    return this.link({
      method: 'POST',
      pathSegments: filePath(driveId, fileId, 'link'),
      body: options,
    });
  }
  private async acknowledge(
    request: GatewayRequest,
    action: Acknowledgement['action'],
    fileId: number,
  ) {
    // Validate success only; mutation data is deliberately neither inspected nor returned.
    await this.gateway.request(request, z.object({ result: z.literal('success') }));
    return acknowledgementSchema.parse({ ok: true, action, fileId });
  }
  updateShareLink(driveId: number, fileId: number, options: Partial<ShareLinkOptions>) {
    return this.acknowledge(
      { method: 'PUT', pathSegments: filePath(driveId, fileId, 'link'), body: options },
      'updateShareLink',
      fileId,
    );
  }
  deleteShareLink(driveId: number, fileId: number) {
    return this.acknowledge(
      { method: 'DELETE', pathSegments: filePath(driveId, fileId, 'link') },
      'deleteShareLink',
      fileId,
    );
  }
  async listAccess(driveId: number, fileId: number) {
    const { data } = await this.gateway.request(
      {
        method: 'GET',
        pathSegments: filePath(driveId, fileId, 'access'),
        query: { with: 'user', no_avatar_default: 1 },
      },
      accessDto,
    );
    return {
      access: [
        ...data.teams.map((v) => mapMember(v, 'team')),
        ...data.users.map((v) => mapMember(v, 'user')),
        ...data.invitations.map((v) => mapMember(v, 'invitation')),
      ],
    };
  }
  async inviteAccess(driveId: number, fileId: number, options: InvitationOptions) {
    const { lang, ...body } = options;
    const { data } = await this.gateway.request(
      {
        method: 'POST',
        pathSegments: [...filePath(driveId, fileId, 'access'), 'invitations'],
        body,
        query: { lang: lang ?? 'en' },
      },
      invitationsDto,
    );
    return { invitations: data.map((v) => mapMember(v, 'invitation')) };
  }
  private async items(
    driveId: number,
    resource: string,
    options: CollaborationPageRequest,
    withPath: boolean,
  ) {
    const dto = await this.gateway.request(
      {
        method: 'GET',
        pathSegments: ['3', 'drive', driveId, 'files', resource],
        query: {
          cursor: options.cursor,
          limit: options.limit,
          'type[]': options.type,
          ...(withPath ? { with: 'path' } : {}),
        },
      },
      itemsDto,
    );
    return itemPageSchema.parse({ items: dto.data.map(mapItem), ...mapPagination(dto) });
  }
  listFavorites(driveId: number, options: PageRequest) {
    return this.items(driveId, 'favorites', options, true);
  }
  addFavorite(driveId: number, fileId: number) {
    return this.acknowledge(
      { method: 'POST', pathSegments: filePath(driveId, fileId, 'favorite') },
      'addFavorite',
      fileId,
    );
  }
  removeFavorite(driveId: number, fileId: number) {
    return this.acknowledge(
      { method: 'DELETE', pathSegments: filePath(driveId, fileId, 'favorite') },
      'removeFavorite',
      fileId,
    );
  }
  recents(driveId: number, options: CollaborationPageRequest) {
    return this.items(driveId, 'recents', options, true);
  }
  sharedWithMe(driveId: number, options: CollaborationPageRequest) {
    return this.items(driveId, 'shared_with_me', options, false);
  }
  async activity(driveId: number, fileId: number | undefined, options: PageRequest) {
    const dto = await this.gateway.request(
      {
        method: 'GET',
        pathSegments: [
          '3',
          'drive',
          driveId,
          'files',
          ...(fileId === undefined ? [] : [fileId]),
          'activities',
        ],
        query: {
          cursor: options.cursor,
          limit: options.limit,
          with: fileId === undefined ? 'file,user' : 'user',
          no_avatar_default: 1,
        },
      },
      activitiesDto,
    );
    return activityPageSchema.parse({
      items: dto.data.map((v) => ({
        id: v.id,
        action: v.action,
        createdAt: v.created_at,
        ...(v.file ? { file: mapItem(v.file) } : {}),
      })),
      ...mapPagination(dto),
    });
  }
}
