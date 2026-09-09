import { z } from 'zod';

export const accountSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  legalEntityType: z.string().optional(),
  createdAt: z.string().optional(),
});
export const profileSchema = z.object({
  id: z.number().int().positive(),
  login: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  currentAccountId: z.number().int().positive().optional(),
});
export const productSchema = z.object({
  id: z.number().int().positive(),
  serviceId: z.number().int().positive(),
  serviceName: z.string(),
  accountId: z.number().int().positive(),
  customerName: z.string(),
});
export type Account = z.infer<typeof accountSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Product = z.infer<typeof productSchema>;
