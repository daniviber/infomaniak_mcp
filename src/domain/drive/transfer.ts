import { z } from 'zod';
import { itemSchema } from './item.js';

export const downloadSchema = z.object({
  fileId: z.number().int().positive(),
  fileName: z.string().nullable(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  encoding: z.enum(['utf-8', 'base64']),
  content: z.string(),
});
export const transferredItemSchema = z.object({ item: itemSchema });
export const mutationSchema = z.object({
  fileId: z.number().int().positive(),
  operation: z.enum(['move', 'rename', 'trash']),
  success: z.literal(true),
});
export type Download = z.infer<typeof downloadSchema>;
export type TransferredItem = z.infer<typeof transferredItemSchema>;
export type Mutation = z.infer<typeof mutationSchema>;

export interface UploadInput {
  drive_id: number;
  file_name: string;
  directory_id?: number;
  text_content?: string;
  base64_content?: string;
  content_type?: string;
  conflict?: 'error' | 'rename' | 'version';
  directory_path?: string;
  last_modified_at?: number;
}
