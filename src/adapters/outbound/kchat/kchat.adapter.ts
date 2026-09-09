import { z } from 'zod';
import type { ChatPort } from '../../../application/chat/chat.port.js';
import { identifier } from '../../../domain/chat/chat.js';
import type { InfomaniakGateway } from '../infomaniak/gateway.js';

// Provenance and synthetic examples: test/fixtures/kchat.json.
// Optional descriptive fields follow admission addendum 6; mapping identifiers remain required.
const userDto = z.object({
  id: identifier,
  username: z.string().optional(),
  email: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  nickname: z.string().optional(),
});
const teamDto = z.object({
  id: identifier,
  name: z.string().optional(),
  display_name: z.string().optional(),
  type: z.string().optional(),
});
const channelDto = teamDto.extend({
  team_id: z.string().optional(),
  header: z.string().optional(),
  purpose: z.string().optional(),
});
const postDto = z.object({
  id: identifier,
  channel_id: identifier,
  user_id: identifier,
  message: z.string(),
  create_at: z.number().optional(),
  update_at: z.number().optional(),
});
const postsDto = z.object({ order: z.array(identifier), posts: z.record(identifier, postDto) });
const mapUser = (value: z.infer<typeof userDto>) => ({
  id: value.id,
  username: value.username,
  email: value.email,
  firstName: value.first_name,
  lastName: value.last_name,
  nickname: value.nickname,
});
const mapTeam = (value: z.infer<typeof teamDto>) => ({
  id: value.id,
  name: value.name,
  displayName: value.display_name,
  type: value.type,
});
const mapChannel = (value: z.infer<typeof channelDto>) => ({
  ...mapTeam(value),
  teamId: value.team_id,
  header: value.header,
  purpose: value.purpose,
});
const mapPost = (value: z.infer<typeof postDto>) => ({
  id: value.id,
  channelId: value.channel_id,
  userId: value.user_id,
  message: value.message,
  createdAt: value.create_at,
  updatedAt: value.update_at,
});
const mapPosts = (value: z.infer<typeof postsDto>) => ({
  order: value.order,
  posts: Object.fromEntries(Object.entries(value.posts).map(([id, post]) => [id, mapPost(post)])),
});

export class KChatAdapter implements ChatPort {
  constructor(private readonly gateway: InfomaniakGateway) {}

  async getMe() {
    return {
      user: mapUser(
        await this.gateway.request({ method: 'GET', pathSegments: ['users', 'me'] }, userDto),
      ),
    };
  }
  async listTeams() {
    return {
      teams: (
        await this.gateway.request({ method: 'GET', pathSegments: ['teams'] }, z.array(teamDto))
      ).map(mapTeam),
    };
  }
  async listMyTeams() {
    return {
      teams: (
        await this.gateway.request(
          { method: 'GET', pathSegments: ['users', 'me', 'teams'] },
          z.array(teamDto),
        )
      ).map(mapTeam),
    };
  }
  async listChannels(teamId: string) {
    return {
      channels: (
        await this.gateway.request(
          { method: 'GET', pathSegments: ['teams', teamId, 'channels'] },
          z.array(channelDto),
        )
      ).map(mapChannel),
    };
  }
  async listMyChannels(teamId: string) {
    return {
      channels: (
        await this.gateway.request(
          { method: 'GET', pathSegments: ['users', 'me', 'teams', teamId, 'channels'] },
          z.array(channelDto),
        )
      ).map(mapChannel),
    };
  }
  async getChannel(channelId: string) {
    return {
      channel: mapChannel(
        await this.gateway.request(
          { method: 'GET', pathSegments: ['channels', channelId] },
          channelDto,
        ),
      ),
    };
  }
  async getChannelPosts(channelId: string, page?: number, perPage?: number) {
    return mapPosts(
      await this.gateway.request(
        {
          method: 'GET',
          pathSegments: ['channels', channelId, 'posts'],
          query: { page, per_page: perPage },
        },
        postsDto,
      ),
    );
  }
  async createPost(channelId: string, message: string, rootId?: string) {
    return {
      post: mapPost(
        await this.gateway.request(
          {
            method: 'POST',
            pathSegments: ['posts'],
            body: {
              channel_id: channelId,
              message,
              ...(rootId === undefined ? {} : { root_id: rootId }),
            },
          },
          postDto,
        ),
      ),
    };
  }
  async deletePost(postId: string) {
    await this.gateway.request({ method: 'DELETE', pathSegments: ['posts', postId] }, z.unknown());
    return { ok: true as const, action: 'delete_post' as const, postId };
  }
  async searchPosts(teamId: string, terms: string, isOrSearch = false) {
    return mapPosts(
      await this.gateway.request(
        {
          method: 'POST',
          pathSegments: ['teams', teamId, 'posts', 'search'],
          body: { terms, is_or_search: isOrSearch },
          idempotent: true,
        },
        postsDto,
      ),
    );
  }
  async createDirect(userIds: [string, string]) {
    return {
      channel: mapChannel(
        await this.gateway.request(
          { method: 'POST', pathSegments: ['channels', 'direct'], body: userIds },
          channelDto,
        ),
      ),
    };
  }
  async searchUsers(term: string) {
    return {
      users: (
        await this.gateway.request(
          { method: 'POST', pathSegments: ['users', 'search'], body: { term }, idempotent: true },
          z.array(userDto),
        )
      ).map(mapUser),
    };
  }
  async listUsers(inTeamId?: string, inChannelId?: string) {
    return {
      users: (
        await this.gateway.request(
          {
            method: 'GET',
            pathSegments: ['users'],
            query: { in_team: inTeamId, in_channel: inChannelId },
          },
          z.array(userDto),
        )
      ).map(mapUser),
    };
  }
}
