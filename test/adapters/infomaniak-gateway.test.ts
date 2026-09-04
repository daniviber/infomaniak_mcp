import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';

function clock() {
  let now = 0;
  return {
    now: () => now,
    wait: vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    }),
  };
}

function setup(fetcher: typeof fetch, bucket = new TokenBucket(clock())) {
  return new InfomaniakGateway({ token: 'secret-token', timeoutMs: 1000, bucket, fetch: fetcher });
}

const schema = z.object({ ok: z.boolean() });
const request = { method: 'GET' as const, pathSegments: ['2', 'drive', 'a/b?c#d'] };

describe('Infomaniak gateway', () => {
  it('encodes each segment, sends bearer and a timeout signal, validates DTOs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    await expect(setup(fetcher).request(request, schema)).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.infomaniak.com/2/drive/a%2Fb%3Fc%23d',
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret-token', 'Content-Type': 'application/json' },
        signal: expect.any(AbortSignal),
        redirect: 'error',
      }),
    );
  });

  it('shares 60 tokens per minute across gateways, including concurrent requests', async () => {
    const time = clock();
    const bucket = new TokenBucket(time);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ok: true }));
    const drive = setup(fetcher, bucket);
    const calendar = setup(fetcher, bucket);
    await Promise.all(
      Array.from({ length: 62 }, (_, i) => (i % 2 ? drive : calendar).request(request, schema)),
    );
    expect(fetcher).toHaveBeenCalledTimes(62);
    expect(time.now()).toBe(2000);
    expect(time.wait.mock.calls).toEqual([[1000], [1000]]);
  });

  it.each([
    ['GET', false, 3],
    ['POST', false, 1],
    ['POST', true, 3],
    ['DELETE', false, 1],
  ] as const)('bounds retries for %s idempotent=%s', async (method, idempotent, attempts) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('secret-token', { status: 503 }));
    await expect(
      setup(fetcher).request({ ...request, method, idempotent }, schema),
    ).rejects.toThrow('Infomaniak HTTP 503');
    expect(fetcher).toHaveBeenCalledTimes(attempts);
  });

  it('does not retry a client error or a malformed DTO, and redacts provider data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('secret-token', { status: 403 }));
    await expect(setup(fetcher).request(request, schema)).rejects.toThrow('Infomaniak HTTP 403');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear().mockResolvedValue(Response.json({ ok: 'secret-token' }));
    await expect(setup(fetcher).request(request, schema)).rejects.toThrow(
      'Invalid Infomaniak response',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('redacts network failures and accepts an injected kChat base and token', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('secret-token https://private.example'));
    const gateway = new InfomaniakGateway({
      base: 'https://chat.example/api/v4',
      token: 'chat-token',
      timeoutMs: 1000,
      bucket: new TokenBucket(clock()),
      fetch: fetcher,
    });
    await expect(
      gateway.request({ method: 'POST', pathSegments: ['posts'], body: { message: 'hi' } }, schema),
    ).rejects.toThrow(/^Infomaniak request failed$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://chat.example/api/v4/posts');
    expect(fetcher.mock.calls[0][1]?.headers).toHaveProperty('Authorization', 'Bearer chat-token');
  });
});
