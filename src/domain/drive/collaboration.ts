import { z } from 'zod';
import { itemSchema } from './item.js';

export const accessRightSchema = z.enum(['read', 'write', 'manage']);
export const linkRightSchema = z.enum(['public', 'password', 'inherit']);
export const accessSchema = z.object({
  id: z.number().int().nonnegative(),
  right: accessRightSchema,
  type: z.enum(['team', 'user', 'invitation']),
});
export const shareLinkSchema = z.object({
  url: z.url(),
  right: linkRightSchema,
  fileId: z.number().int().positive().nullable().optional(),
  validUntil: z.union([z.number(), z.string(), z.null()]).optional(),
});
export const acknowledgementSchema = z.object({
  ok: z.literal(true),
  action: z.enum(['updateShareLink', 'deleteShareLink', 'addFavorite', 'removeFavorite']),
  fileId: z.number().int().positive(),
});
export const activitySchema = z.object({
  id: z.number().int().positive(),
  action: z.string(),
  createdAt: z.number(),
  file: itemSchema.optional(),
});
export const activityPageSchema = z.object({
  items: z.array(activitySchema),
  hasMore: z.boolean(),
  cursor: z.string().min(1).optional(),
});
export type Access = z.infer<typeof accessSchema>;
export type ShareLink = z.infer<typeof shareLinkSchema>;
export type Acknowledgement = z.infer<typeof acknowledgementSchema>;
export type ActivityPage = z.infer<typeof activityPageSchema>;
