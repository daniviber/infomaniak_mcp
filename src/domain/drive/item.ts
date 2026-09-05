import { z } from 'zod';

export const driveSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  accountId: z.number().int().positive(),
  usedBytes: z.number().int().nonnegative(),
  capacityBytes: z.number().int().nonnegative(),
});

export const itemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  type: z.enum(['dir', 'file']),
  sizeBytes: z.number().int().nonnegative().optional(),
  createdAt: z.number().optional(),
  modifiedAt: z.number().optional(),
  addedAt: z.number().optional(),
  parentId: z.number().int().nonnegative().optional(),
  mimeType: z.string().optional(),
  extensionType: z.string().optional(),
  path: z.string().optional(),
  visibility: z.string().optional(),
  status: z.string().optional(),
  isFavorite: z.boolean().optional(),
});

export const itemPageSchema = z.object({
  items: z.array(itemSchema),
  hasMore: z.boolean(),
  cursor: z.string().min(1).optional(),
});

export type Drive = z.infer<typeof driveSchema>;
export type DriveItem = z.infer<typeof itemSchema>;
export type ItemPage = z.infer<typeof itemPageSchema>;
