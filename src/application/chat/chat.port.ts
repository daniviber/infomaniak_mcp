import type { Channel, Deletion, Post, PostList, Team, User } from '../../domain/chat/chat.js';

export interface ChatPort {
  getMe(): Promise<{ user: User }>;
  listTeams(): Promise<{ teams: Team[] }>;
  listMyTeams(): Promise<{ teams: Team[] }>;
  listChannels(teamId: string): Promise<{ channels: Channel[] }>;
  listMyChannels(teamId: string): Promise<{ channels: Channel[] }>;
  getChannel(channelId: string): Promise<{ channel: Channel }>;
  getChannelPosts(channelId: string, page?: number, perPage?: number): Promise<PostList>;
  createPost(channelId: string, message: string, rootId?: string): Promise<{ post: Post }>;
  deletePost(postId: string): Promise<Deletion>;
  searchPosts(teamId: string, terms: string, isOrSearch?: boolean): Promise<PostList>;
  createDirect(userIds: [string, string]): Promise<{ channel: Channel }>;
  searchUsers(term: string): Promise<{ users: User[] }>;
  listUsers(inTeamId?: string, inChannelId?: string): Promise<{ users: User[] }>;
}
