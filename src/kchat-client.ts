/**
 * kChat API Client
 *
 * A TypeScript client for the kChat (Mattermost-compatible) API.
 * Base URL: https://{host}/api/v4/
 * Authentication: Bearer Token (personal access token)
 */

export interface KChatConfig {
  readonly host: string;
  readonly token: string;
}

export interface KChatTeam {
  id: string;
  name: string;
  display_name: string;
  type: string;
}

export interface KChatChannel {
  id: string;
  team_id: string;
  name: string;
  display_name: string;
  type: string;
  header: string;
  purpose: string;
}

export interface KChatPost {
  id: string;
  channel_id: string;
  user_id: string;
  message: string;
  create_at: number;
  update_at: number;
}

export interface KChatUser {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  nickname: string;
}

export interface KChatPostList {
  order: string[];
  posts: Record<string, KChatPost>;
}

export class KChatClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: KChatConfig) {
    this.baseUrl = `https://${config.host}/api/v4`;
    this.token = config.token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) {
          params.append(key, String(value));
        }
      }
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    if (body !== undefined && (method === "POST" || method === "PUT" || method === "PATCH")) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText) as { message?: string };
        errorMessage = errorJson.message ?? errorText;
      } catch {
        errorMessage = errorText;
      }
      throw new Error(`kChat API Error (${response.status}): ${errorMessage}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const data = await response.json();
    return data as T;
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  async getMe(): Promise<KChatUser> {
    return this.request<KChatUser>("GET", "/users/me");
  }

  async searchUsers(term: string): Promise<KChatUser[]> {
    return this.request<KChatUser[]>("GET", "/users/search", undefined, { term });
  }

  async listUsers(params?: {
    inTeamId?: string;
    inChannelId?: string;
    page?: number;
    perPage?: number;
  }): Promise<KChatUser[]> {
    return this.request<KChatUser[]>("GET", "/users", undefined, {
      in_team: params?.inTeamId,
      in_channel: params?.inChannelId,
      page: params?.page,
      per_page: params?.perPage,
    });
  }

  // ─── Teams ────────────────────────────────────────────────────────────────

  async listTeams(): Promise<KChatTeam[]> {
    return this.request<KChatTeam[]>("GET", "/teams");
  }

  async getTeam(teamId: string): Promise<KChatTeam> {
    return this.request<KChatTeam>("GET", `/teams/${teamId}`);
  }

  async listMyTeams(): Promise<KChatTeam[]> {
    return this.request<KChatTeam[]>("GET", "/users/me/teams");
  }

  // ─── Channels ─────────────────────────────────────────────────────────────

  async listChannels(teamId: string): Promise<KChatChannel[]> {
    return this.request<KChatChannel[]>("GET", `/teams/${teamId}/channels`);
  }

  async listMyChannels(teamId: string): Promise<KChatChannel[]> {
    return this.request<KChatChannel[]>("GET", `/users/me/teams/${teamId}/channels`);
  }

  async getChannel(channelId: string): Promise<KChatChannel> {
    return this.request<KChatChannel>("GET", `/channels/${channelId}`);
  }

  async createDirectChannel(userIds: [string, string]): Promise<KChatChannel> {
    return this.request<KChatChannel>("POST", "/channels/direct", userIds);
  }

  // ─── Posts ────────────────────────────────────────────────────────────────

  async getChannelPosts(
    channelId: string,
    page?: number,
    perPage?: number,
  ): Promise<KChatPostList> {
    return this.request<KChatPostList>("GET", `/channels/${channelId}/posts`, undefined, {
      page,
      per_page: perPage,
    });
  }

  async createPost(channelId: string, message: string, rootId?: string): Promise<KChatPost> {
    const body: { channel_id: string; message: string; root_id?: string } = {
      channel_id: channelId,
      message,
    };
    if (rootId !== undefined) {
      body.root_id = rootId;
    }
    return this.request<KChatPost>("POST", "/posts", body);
  }

  async deletePost(postId: string): Promise<void> {
    return this.request<void>("DELETE", `/posts/${postId}`);
  }

  async searchPosts(
    teamId: string,
    terms: string,
    isOrSearch?: boolean,
  ): Promise<KChatPostList> {
    return this.request<KChatPostList>("POST", `/teams/${teamId}/posts/search`, {
      terms,
      is_or_search: isOrSearch ?? false,
    });
  }
}

export default KChatClient;
