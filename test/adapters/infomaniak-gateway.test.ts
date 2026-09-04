import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  InfomaniakGateway,
  TokenBucket,
  retryDelay,
} from '../../src/adapters/outbound/infomaniak/gateway.js';

function clock() {
  let now = 0;
  return {
    now: () => now,
    wait: vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    }),
  };
}

function setup(fetcher: typeof fetch, bucket = new TokenBucket(clock()), time = clock()) {
  return new InfomaniakGateway({
    token: 'secret-token',
    timeoutMs: 1000,
    bucket,
    fetch: fetcher,
    clock: time,
    random: () => 0,
    utcNow: () => 0,
  });
}

const schema = z.object({ ok: z.boolean() });
const request = { method: 'GET' as const, pathSegments: ['2', 'drive', 'a/b?c#d'] };

describe('Infomaniak gateway', () => {
  it('serializes defined query values with unchanged keys through URLSearchParams', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ok: true }));
    await setup(fetcher).request(
      {
        ...request,
        query: {
          account_id: 123,
          'type[]': 'file & folder',
          enabled: false,
          count: 0,
          empty: '',
          omitted: undefined,
        },
      },
      schema,
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://api.infomaniak.com/2/drive/a%2Fb%3Fc%23d?account_id=123&type%5B%5D=file+%26+folder&enabled=false&count=0&empty=',
    );
  });

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
    const time = clock();
    await expect(
      setup(fetcher, new TokenBucket(time), time).request(
        { ...request, method, idempotent },
        schema,
      ),
    ).rejects.toThrow('Infomaniak HTTP 503');
    expect(fetcher).toHaveBeenCalledTimes(attempts);
    expect(time.wait.mock.calls).toEqual(attempts === 3 ? [[500], [1000]] : []);
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
      clock: clock(),
      random: () => 0,
      utcNow: () => 0,
    });
    await expect(
      gateway.request({ method: 'POST', pathSegments: ['posts'], body: { message: 'hi' } }, schema),
    ).rejects.toThrow(/^Infomaniak request failed$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://chat.example/api/v4/posts');
    expect(fetcher.mock.calls[0][1]?.headers).toHaveProperty('Authorization', 'Bearer chat-token');
  });
});

describe('injected retry delays', () => {
  const utc = Date.parse('2026-09-04T00:00:00Z');
  it.each([
    ['2', 2000],
    ['60', 30000],
    ['Fri, 04 Sep 2026 00:00:03 GMT', 3000],
    ['Fri, 04 Sep 2026 00:01:00 GMT', 30000],
    ['Thu, 03 Sep 2026 23:59:59 GMT', 0],
    ['invalid', 750],
    ['-1', 750],
    ['', 750],
  ])(
    'honors Retry-After %s with fake UTC and without shortening valid delays',
    async (header, expected) => {
      const time = clock();
      const random = vi.fn(() => 0.5);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, { status: 429, headers: { 'Retry-After': header } }),
        )
        .mockResolvedValueOnce(Response.json({ ok: true }));
      const gateway = new InfomaniakGateway({
        token: 'test',
        timeoutMs: 1000,
        bucket: new TokenBucket(time),
        fetch: fetcher,
        clock: time,
        random,
        utcNow: () => utc,
      });
      await expect(gateway.request(request, schema)).resolves.toEqual({ ok: true });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(time.wait.mock.calls).toEqual([[expected]]);
      expect(random).toHaveBeenCalledTimes(expected === 750 ? 1 : 0);
    },
  );

  it.each([429, 503, 'network', 'timeout'] as const)(
    'waits at most twice for %s, including declared idempotent POST',
    async (failure) => {
      const time = clock();
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
        if (typeof failure === 'number') return new Response(null, { status: failure });
        throw failure === 'timeout'
          ? new DOMException('Fake timeout', 'TimeoutError')
          : new Error('Fake network failure');
      });
      await expect(
        setup(fetcher, new TokenBucket(time), time).request(
          { ...request, method: 'POST', idempotent: true },
          schema,
        ),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(time.wait.mock.calls).toEqual([[500], [1000]]);
    },
  );

  it.each([429, 503, 'timeout'] as const)(
    'does not wait or retry a non-idempotent POST on %s',
    async (failure) => {
      const time = clock();
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
        if (typeof failure === 'number')
          return new Response(null, { status: failure, headers: { 'Retry-After': '5' } });
        throw new DOMException('Fake timeout', 'TimeoutError');
      });
      await expect(
        setup(fetcher, new TokenBucket(time), time).request({ ...request, method: 'POST' }, schema),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(time.wait).not.toHaveBeenCalled();
    },
  );

  it('does not wait after immediate success', async () => {
    const time = clock();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    await setup(fetcher, new TokenBucket(time), time).request(request, schema);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(time.wait).not.toHaveBeenCalled();
  });

  it('applies quota separately before every retry across gateways', async () => {
    const time = clock();
    const bucket = new TokenBucket(time);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ok: true }));
    const first = setup(fetcher, bucket, time);
    const second = setup(fetcher, bucket, time);
    for (let i = 0; i < 60; i++) await first.request(request, schema);
    fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
    await expect(second.request(request, schema)).rejects.toThrow('Infomaniak HTTP 503');
    expect(fetcher).toHaveBeenCalledTimes(63);
    expect(time.wait.mock.calls).toEqual([[1000], [500], [500], [1000]]);
  });

  it('calculates reproducible exponential jitter with a final 8000ms cap at high ranks', () => {
    expect(
      [1, 2, 3, 4, 5, 100, 2048].map((rank) =>
        retryDelay(
          rank,
          () => 0,
          null,
          () => utc,
        ),
      ),
    ).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
    expect(
      [1, 2, 3, 4, 5, 100].map((rank) =>
        retryDelay(
          rank,
          () => 0.5,
          null,
          () => utc,
        ),
      ),
    ).toEqual([750, 1500, 3000, 6000, 8000, 8000]);
    expect(
      retryDelay(
        4,
        () => 1,
        null,
        () => utc,
      ),
    ).toBe(8000);
  });
});
