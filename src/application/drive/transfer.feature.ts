import { z } from 'zod';
import {
  downloadSchema,
  mutationSchema,
  transferredItemSchema,
} from '../../domain/drive/transfer.js';
import type { ToolContract } from '../../domain/tool-contract.js';
import { createFeatureModule, type ToolBinding } from '../feature-module.js';
import type { DriveTransferPort } from './transfer.port.js';
import { PAGE_LIMIT_MIN, PAGE_LIMIT_MAX, PAGE_LIMIT_DEFAULT } from './navigation.feature.js';

// Shared navigation bounds remain owned by FEAT-02; no transfer operation paginates.
export { PAGE_LIMIT_MIN, PAGE_LIMIT_MAX, PAGE_LIMIT_DEFAULT };
export const DOWNLOAD_LIMIT = 10 * 1024 * 1024;
export const UPLOAD_LIMIT = 50 * 1024 * 1024;
export const BODY_LIMIT = 20 * 1024 * 1024;
export const ENVELOPE_RESERVE = 64 * 1024;
export interface TransferLimits {
  downloadLimit: number;
  uploadLimit: number;
  bodyLimit: number;
}
export type TransferOptions = Partial<TransferLimits>;

function resolveLimits(options: TransferOptions): TransferLimits {
  const limits = {
    downloadLimit: DOWNLOAD_LIMIT,
    uploadLimit: UPLOAD_LIMIT,
    bodyLimit: BODY_LIMIT,
    ...options,
  };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid transfer limit');
  }
  if (limits.bodyLimit < ENVELOPE_RESERVE) throw new Error('Body limit below envelope reserve');
  return limits;
}

const id = z.number().int().positive();
const name = z
  .string()
  .min(1)
  .regex(/^[^/\\\x00]+$/);
const fileInput = z.object({ drive_id: id, file_id: id });
const downloadInput = fileInput.extend({
  encoding: z.enum(['auto', 'utf-8', 'base64']).default('auto'),
});
const mkdirInput = z.object({
  drive_id: id,
  name,
  parent_id: id.default(1),
  only_for_me: z.boolean().default(false),
});
const destinationInput = fileInput.extend({ destination_directory_id: id });
const renameInput = fileInput.extend({ name });

function uploadInput(limits: TransferLimits) {
  const effectiveLimit = Math.min(limits.uploadLimit, limits.bodyLimit - ENVELOPE_RESERVE);
  // Preserve every input field for admission, including metadata unknown to this version.
  return z
    .looseObject({
      drive_id: id,
      file_name: name,
      directory_id: id.optional(),
      text_content: z.string().optional(),
      base64_content: z.string().optional(),
      content_type: z.string().min(1).optional(),
      conflict: z.enum(['error', 'rename', 'version']).optional(),
      directory_path: z.string().optional(),
      last_modified_at: z.number().int().nonnegative().optional(),
    })
    .superRefine((input, ctx) => {
      if (
        (input.base64_content?.length ?? 0) > effectiveLimit ||
        Buffer.byteLength(JSON.stringify(input), 'utf8') > effectiveLimit
      ) {
        ctx.addIssue({ code: 'custom', message: 'Upload arguments limit exceeded' });
        return;
      }
      if ((input.text_content === undefined) === (input.base64_content === undefined)) {
        ctx.addIssue({ code: 'custom', message: 'Provide exactly one content encoding' });
        return;
      }
      const encoded = input.base64_content;
      const padding = encoded?.endsWith('==') ? 2 : encoded?.endsWith('=') ? 1 : 0;
      if (
        encoded !== undefined &&
        (encoded.length % 4 !== 0 ||
          /[^A-Za-z0-9+/]/.test(encoded.slice(0, encoded.length - padding)))
      ) {
        ctx.addIssue({ code: 'custom', message: 'Invalid base64 content' });
      }
    });
}

function definitions(options: TransferOptions = {}) {
  const limits = resolveLimits(options);
  const upload = uploadInput(limits);
  const specs = [
    [
      'infomaniak_download_kdrive_file',
      'Download a bounded file',
      downloadInput,
      downloadSchema,
      'read',
    ],
    [
      'infomaniak_upload_kdrive_file',
      'Upload a file within the JSON arguments admission limit',
      upload,
      transferredItemSchema,
      'write',
    ],
    [
      'infomaniak_create_kdrive_directory',
      'Create a directory',
      mkdirInput,
      transferredItemSchema,
      'write',
    ],
    [
      'infomaniak_move_kdrive_file',
      'Move a file or directory',
      destinationInput,
      mutationSchema,
      'write',
    ],
    [
      'infomaniak_copy_kdrive_file',
      'Copy a file or directory',
      destinationInput,
      transferredItemSchema,
      'write',
    ],
    [
      'infomaniak_rename_kdrive_file',
      'Rename a file or directory',
      renameInput,
      mutationSchema,
      'write',
    ],
    [
      'infomaniak_delete_kdrive_file',
      'Move a file or directory to trash',
      fileInput,
      mutationSchema,
      'destructive',
    ],
  ] as const;
  const contracts: ToolContract[] = specs.map(
    ([name, description, inputSchema, outputSchema, classification]) => ({
      name,
      description,
      inputSchema,
      outputSchema,
      classification,
      rawApi: false,
      experimental: false,
      idempotent: classification === 'read',
      limits: {
        ...limits,
        envelopeReserve: ENVELOPE_RESERVE,
        effectiveInputLimit: Math.min(limits.uploadLimit, limits.bodyLimit - ENVELOPE_RESERVE),
      },
      text: (output) => JSON.stringify(output, null, 2),
    }),
  );
  return { contracts, limits, upload };
}

export const tools: readonly ToolContract[] = definitions().contracts;

export function createTransferBindings(
  port: DriveTransferPort,
  options: TransferOptions = {},
): ToolBinding[] {
  const { contracts, limits, upload } = definitions(options);
  const handles: ToolBinding['handle'][] = [
    async (input) => {
      const v = downloadInput.parse(input);
      const output = await port.download(v.drive_id, v.file_id, v.encoding, limits.downloadLimit);
      if (output.sizeBytes > limits.downloadLimit) throw new Error('Download limit exceeded');
      return output;
    },
    (input) => port.upload(upload.parse(input), limits.uploadLimit),
    (input) => {
      const v = mkdirInput.parse(input);
      return port.mkdir(v.drive_id, v.name, v.parent_id, v.only_for_me);
    },
    (input) => {
      const v = destinationInput.parse(input);
      return port.move(v.drive_id, v.file_id, v.destination_directory_id);
    },
    (input) => {
      const v = destinationInput.parse(input);
      return port.copy(v.drive_id, v.file_id, v.destination_directory_id);
    },
    (input) => {
      const v = renameInput.parse(input);
      return port.rename(v.drive_id, v.file_id, v.name);
    },
    (input) => {
      const v = fileInput.parse(input);
      return port.trash(v.drive_id, v.file_id);
    },
  ];
  return contracts.map((contract, index) => ({ contract, handle: handles[index] }));
}

// FEAT-00 enforces policy before input validation and before every port invocation.
export function createTransferFeature(port: DriveTransferPort, options: TransferOptions = {}) {
  return createFeatureModule(createTransferBindings(port, options));
}

export function assertDecodedUploadSize(sizeBytes: number, uploadLimit: number): void {
  if (sizeBytes > uploadLimit) throw new Error('Upload limit exceeded');
}
