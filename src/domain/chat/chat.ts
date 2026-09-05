import { z } from 'zod';

export const identifier = z.string().min(1);
export const user = z.object({
  id: identifier,
  username: z.string().optional(),
  email: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  nickname: z.string().optional(),
});
export const team = z.object({
  id: identifier,
  name: z.string().optional(),
  displayName: z.string().optional(),
  type: z.string().optional(),
});
export const channel = team.extend({
  teamId: z.string().optional(),
  header: z.string().optional(),
  purpose: z.string().optional(),
});
export const post = z.object({
  id: identifier,
  channelId: identifier,
  userId: identifier,
  message: z.string(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
export const postList = z.object({
  order: z.array(identifier),
  posts: z.record(identifier, post),
});
export const deletion = z.object({
  ok: z.literal(true),
  action: z.literal('delete_post'),
  postId: identifier,
});
export type User = z.infer<typeof user>;
export type Team = z.infer<typeof team>;
export type Channel = z.infer<typeof channel>;
export type Post = z.infer<typeof post>;
export type PostList = z.infer<typeof postList>;
export type Deletion = z.infer<typeof deletion>;
