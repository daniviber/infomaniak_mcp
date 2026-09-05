import { z } from 'zod';
import { itemPageSchema } from './item.js';

export const trashPageSchema = itemPageSchema;
export const trashMutationSchema = z.object({
  driveId: z.number().int().positive(),
  fileId: z.number().int().positive(),
  operation: z.enum(['restore', 'permanentDelete']),
  success: z.literal(true),
});
export const emptyTrashSchema = z.object({
  driveId: z.number().int().positive(),
  operation: z.literal('empty'),
  success: z.literal(true),
});
export type TrashPage = z.infer<typeof trashPageSchema>;
export type TrashMutation = z.infer<typeof trashMutationSchema>;
export type EmptyTrash = z.infer<typeof emptyTrashSchema>;
