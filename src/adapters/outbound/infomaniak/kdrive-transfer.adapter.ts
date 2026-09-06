import { z } from 'zod';
import { itemSchema } from '../../../domain/drive/item.js';
import {
  downloadSchema,
  mutationSchema,
  transferredItemSchema,
  type UploadInput,
} from '../../../domain/drive/transfer.js';
import type { DriveTransferPort } from '../../../application/drive/transfer.port.js';
import { assertDecodedUploadSize } from '../../../application/drive/transfer.feature.js';
import type { InfomaniakGateway } from './gateway.js';

const itemDto = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number().int().nonnegative().optional(),
  parent_id: z.number().int().nonnegative().optional(),
  mime_type: z.string().optional(),
});
const itemEnvelope = z.object({ result: z.literal('success'), data: itemDto });
const successEnvelope = z.object({ result: z.literal('success') });
function mapItem(payload: unknown) {
  try {
    const { data } = itemEnvelope.parse(payload);
    return transferredItemSchema.parse({
      item: itemSchema.parse({
        id: data.id,
        name: data.name,
        type: data.type,
        sizeBytes: data.size,
        parentId: data.parent_id,
        mimeType: data.mime_type,
      }),
    });
  } catch {
    throw new Error('Invalid Infomaniak response');
  }
}

export class KDriveTransferAdapter implements DriveTransferPort {
  constructor(private readonly gateway: InfomaniakGateway) {}

  async download(
    driveId: number,
    fileId: number,
    encoding: 'auto' | 'utf-8' | 'base64',
    maxBytes: number,
  ) {
    const result = await this.gateway.download(
      ['2', 'drive', driveId, 'files', fileId, 'download'],
      { maxBytes },
    );
    const contentType = result.contentType.split(';')[0].trim().toLowerCase();
    const text =
      encoding === 'utf-8' ||
      (encoding === 'auto' &&
        (contentType.startsWith('text/') || /(?:json|xml|javascript)$/.test(contentType)));
    return downloadSchema.parse({
      fileId,
      fileName: result.fileName,
      contentType,
      sizeBytes: result.bytes.byteLength,
      encoding: text ? 'utf-8' : 'base64',
      content: text
        ? new TextDecoder().decode(result.bytes)
        : Buffer.from(result.bytes).toString('base64'),
    });
  }

  async upload(input: UploadInput, maxBytes: number) {
    const bytes =
      input.text_content !== undefined
        ? Buffer.from(input.text_content, 'utf8')
        : Buffer.from(input.base64_content ?? '', 'base64');
    assertDecodedUploadSize(bytes.byteLength, maxBytes);
    if (input.base64_content !== undefined && bytes.toString('base64') !== input.base64_content)
      throw new Error('Invalid base64 content');
    return mapItem(
      await this.gateway.upload(['3', 'drive', input.drive_id, 'upload'], {
        bytes,
        contentType: input.content_type ?? 'application/octet-stream',
        query: {
          directory_id: input.directory_id ?? 1,
          file_name: input.file_name,
          total_size: bytes.byteLength,
          conflict: input.conflict ?? 'rename',
          directory_path: input.directory_path,
          last_modified_at: input.last_modified_at,
        },
      }),
    );
  }

  async mkdir(driveId: number, name: string, parentId: number, onlyForMe: boolean) {
    return mapItem(
      await this.gateway.request(
        {
          method: 'POST',
          pathSegments: ['3', 'drive', driveId, 'files', parentId, 'directory'],
          body: { name, only_for_me: onlyForMe },
        },
        itemEnvelope,
      ),
    );
  }
  async move(driveId: number, fileId: number, destinationDirectoryId: number) {
    await this.gateway.request(
      {
        method: 'POST',
        pathSegments: ['3', 'drive', driveId, 'files', fileId, 'move', destinationDirectoryId],
      },
      successEnvelope,
    );
    return mutationSchema.parse({ fileId, operation: 'move', success: true });
  }
  async copy(driveId: number, fileId: number, destinationDirectoryId: number) {
    return mapItem(
      await this.gateway.request(
        {
          method: 'POST',
          pathSegments: ['3', 'drive', driveId, 'files', fileId, 'copy', destinationDirectoryId],
        },
        itemEnvelope,
      ),
    );
  }
  async rename(driveId: number, fileId: number, name: string) {
    await this.gateway.request(
      {
        method: 'POST',
        pathSegments: ['2', 'drive', driveId, 'files', fileId, 'rename'],
        body: { name },
      },
      successEnvelope,
    );
    return mutationSchema.parse({ fileId, operation: 'rename', success: true });
  }
  async trash(driveId: number, fileId: number) {
    await this.gateway.request(
      { method: 'DELETE', pathSegments: ['2', 'drive', driveId, 'files', fileId] },
      successEnvelope,
    );
    return mutationSchema.parse({ fileId, operation: 'trash', success: true });
  }
}
