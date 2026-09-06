import { z } from 'zod';
import {
  channel,
  deletion,
  identifier,
  post,
  postList,
  team,
  user,
} from '../../domain/chat/chat.js';
import type { ToolContract } from '../../domain/tool-contract.js';
import type { ChatPort } from './chat.port.js';
import { createFeatureModule } from '../feature-module.js';

const empty = z.object({});
const teamInput = z.object({ team_id: identifier });
const channelInput = z.object({ channel_id: identifier });
const postsInput = channelInput.extend({
  page: z.number().int().min(0).optional(),
  per_page: z.number().int().min(1).max(200).optional(),
});
const createInput = channelInput.extend({
  message: z.string().min(1),
  root_id: z.string().optional(),
});
const deleteInput = z.object({ post_id: identifier });
const searchInput = teamInput.extend({
  terms: z.string().min(1),
  is_or_search: z.boolean().optional(),
});
const directInput = z.object({ user_ids: z.tuple([identifier, identifier]) });
const searchUsersInput = z.object({ term: z.string().min(1) });
const usersInput = z.object({
  in_team_id: z.string().optional(),
  in_channel_id: z.string().optional(),
});
function contract(
  name: string,
  description: string,
  inputSchema: z.ZodObject,
  outputSchema: z.ZodObject,
  classification: ToolContract['classification'] = 'read',
): ToolContract {
  return {
    name: `infomaniak_kchat_${name}`,
    description,
    inputSchema,
    outputSchema,
    classification,
    rawApi: false,
    experimental: false,
    idempotent: classification === 'read',
    limits: name === 'get_channel_posts' ? { perPage: 200 } : {},
    text: (output) => JSON.stringify(output, null, 2),
  };
}
export const tools = [
  contract('get_me', 'Get the current kChat user profile', empty, z.object({ user })),
  contract('list_teams', 'List kChat teams', empty, z.object({ teams: z.array(team) })),
  contract(
    'list_my_teams',
    'List teams of the current kChat user',
    empty,
    z.object({ teams: z.array(team) }),
  ),
  contract(
    'list_channels',
    'List channels in a kChat team',
    teamInput,
    z.object({ channels: z.array(channel) }),
  ),
  contract(
    'list_my_channels',
    'List channels of the current kChat user in a team',
    teamInput,
    z.object({ channels: z.array(channel) }),
  ),
  contract('get_channel', 'Get a kChat channel', channelInput, z.object({ channel })),
  contract('get_channel_posts', 'Get posts in a kChat channel', postsInput, postList),
  contract('create_post', 'Publish a kChat message', createInput, z.object({ post }), 'write'),
  contract('delete_post', 'Delete a kChat post', deleteInput, deletion, 'destructive'),
  contract('search_posts', 'Search posts in a kChat team', searchInput, postList),
  contract(
    'create_direct',
    'Create or get a direct channel between two kChat users',
    directInput,
    z.object({ channel }),
    'write',
  ),
  contract(
    'search_users',
    'Search kChat users',
    searchUsersInput,
    z.object({ users: z.array(user) }),
  ),
  contract(
    'list_users',
    'List kChat users filtered by team or channel',
    usersInput,
    z.object({ users: z.array(user) }),
  ),
] as const;

export function createChatHandlers(port: ChatPort) {
  return {
    infomaniak_kchat_get_me: async (input: unknown) => {
      empty.parse(input);
      return port.getMe();
    },
    infomaniak_kchat_list_teams: async (input: unknown) => {
      empty.parse(input);
      return port.listTeams();
    },
    infomaniak_kchat_list_my_teams: async (input: unknown) => {
      empty.parse(input);
      return port.listMyTeams();
    },
    infomaniak_kchat_list_channels: (input: unknown) =>
      port.listChannels(teamInput.parse(input).team_id),
    infomaniak_kchat_list_my_channels: (input: unknown) =>
      port.listMyChannels(teamInput.parse(input).team_id),
    infomaniak_kchat_get_channel: (input: unknown) =>
      port.getChannel(channelInput.parse(input).channel_id),
    infomaniak_kchat_get_channel_posts: (input: unknown) => {
      const value = postsInput.parse(input);
      return port.getChannelPosts(value.channel_id, value.page, value.per_page);
    },
    infomaniak_kchat_create_post: (input: unknown) => {
      const value = createInput.parse(input);
      return port.createPost(value.channel_id, value.message, value.root_id);
    },
    infomaniak_kchat_delete_post: (input: unknown) =>
      port.deletePost(deleteInput.parse(input).post_id),
    infomaniak_kchat_search_posts: (input: unknown) => {
      const value = searchInput.parse(input);
      return port.searchPosts(value.team_id, value.terms, value.is_or_search);
    },
    infomaniak_kchat_create_direct: (input: unknown) =>
      port.createDirect(directInput.parse(input).user_ids),
    infomaniak_kchat_search_users: (input: unknown) =>
      port.searchUsers(searchUsersInput.parse(input).term),
    infomaniak_kchat_list_users: (input: unknown) => {
      const value = usersInput.parse(input);
      return port.listUsers(value.in_team_id, value.in_channel_id);
    },
  };
}
export function createChatFeature(port: ChatPort) {
  const handlers = createChatHandlers(port);
  return createFeatureModule(
    tools.map((contract) => ({
      contract,
      handle: handlers[contract.name as keyof typeof handlers],
    })),
  );
}
