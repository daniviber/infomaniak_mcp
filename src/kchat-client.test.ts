/**
 * Unit tests for KChatClient
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KChatClient } from './kchat-client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ok(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

describe('KChatClient', () => {
  let client: KChatClient;

  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockResolvedValue(ok({}));
    client = new KChatClient({ host: 'team.kchat.infomaniak.com', token: 'test-token' });
  });

  describe('path segments', () => {
    it('keeps an ordinary id unchanged', async () => {
      await client.deletePost('abc123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://team.kchat.infomaniak.com/api/v4/posts/abc123',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('does not let a post id turn a post deletion into another DELETE', async () => {
      // Unencoded, fetch resolves this to DELETE /api/v4/channels/xyz (archives the channel)
      await client.deletePost('../channels/xyz');

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(options.method).toBe('DELETE');
      expect(new URL(url).pathname).toBe('/api/v4/posts/..%2Fchannels%2Fxyz');
    });

    it.each<[string, (c: KChatClient) => Promise<unknown>]>([
      ['getTeam', (c) => c.getTeam('..')],
      ['listChannels', (c) => c.listChannels('..')],
      ['listMyChannels', (c) => c.listMyChannels('..')],
      ['getChannel', (c) => c.getChannel('..')],
      ['getChannelPosts', (c) => c.getChannelPosts('..')],
      ['deletePost', (c) => c.deletePost('..')],
      ['searchPosts', (c) => c.searchPosts('..', 'hello')],
    ])('%s refuses ".." as an id', async (_name, call) => {
      await expect(call(client)).rejects.toThrow(/path segment/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('searchUsers', () => {
    it('sends POST /users/search with the term in the body', async () => {
      mockFetch.mockResolvedValueOnce(ok([]));

      await client.searchUsers('alice');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://team.kchat.infomaniak.com/api/v4/users/search',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ term: 'alice' }) }),
      );
    });
  });

  describe('timeout', () => {
    it('gives up on a request that never answers', async () => {
      // A fetch that only settles when its signal aborts
      mockFetch.mockImplementationOnce(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
          }),
      );
      client = new KChatClient({ host: 'team.kchat.infomaniak.com', token: 'test-token', timeoutMs: 20 });

      await expect(client.getMe()).rejects.toThrow();
    }, 2000);

    it('uses a 30 second timeout by default', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');

      await client.getMe();

      expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    });
  });
});
