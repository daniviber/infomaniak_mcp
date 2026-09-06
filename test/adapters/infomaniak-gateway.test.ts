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
      'Invalid Infomaniak response: ok: invalid_type',
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

describe('binary gateway transfers', () => {
  it.each([undefined, '1', '3', '99999999'])(
    'bounds streaming independently of Content-Length %s',
    async (length) => {
      const cancel = vi.fn();
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array([pulls]));
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(stream, {
          headers: length === undefined ? {} : { 'Content-Length': length },
        }),
      );
      await expect(setup(fetcher).download(['2', 'drive'], { maxBytes: 3 })).rejects.toThrow(
        'Download limit exceeded',
      );
      expect(pulls).toBe(4);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('cancels a single oversized chunk without reading any following chunks', async () => {
    const cancel = vi.fn();
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) =>
      controller.enqueue(new Uint8Array(1024 * 1024)),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 })));
    await expect(setup(fetcher).download(['file'], { maxBytes: 3 })).rejects.toThrow(
      'Download limit exceeded',
    );
    expect(pull).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([0, 3])('accepts exactly %i bytes and maps binary metadata', async (size) => {
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) controller.close();
        else {
          sent = true;
          controller.enqueue(new Uint8Array(size).fill(42));
        }
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': 'attachment; filename="photo.png"',
        },
      }),
    );
    await expect(
      setup(fetcher).download(['2', 'a/b?'], {
        maxBytes: size,
        query: { 'type[]': 'x y', omit: undefined, zero: 0 },
      }),
    ).resolves.toEqual({
      bytes: new Uint8Array(size).fill(42),
      contentType: 'image/png',
      fileName: 'photo.png',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.infomaniak.com/2/a%2Fb%3F?type%5B%5D=x+y&zero=0',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer secret-token' },
        signal: expect.any(AbortSignal),
        redirect: 'error',
      }),
    );
  });

  it('decodes extended UTF-8 filename and defaults absent binary metadata', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            'Content-Disposition': "attachment; filename=old; filename*=UTF-8''%C3%A9t%C3%A9.txt",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null));
    const gateway = setup(fetcher);
    expect((await gateway.download(['file'], { maxBytes: 0 })).fileName).toBe('été.txt');
    await expect(gateway.download(['file'], { maxBytes: 0 })).resolves.toEqual({
      bytes: new Uint8Array(),
      fileName: null,
      contentType: 'application/octet-stream',
    });
  });

  it.each([429, 503, 'network', 'timeout'] as const)(
    'retries download %s using the injected clock',
    async (failure) => {
      const time = clock();
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
        if (typeof failure === 'number')
          return new Response('secret-token', { status: failure, headers: { 'Retry-After': '2' } });
        throw new Error('secret-token');
      });
      await expect(
        setup(fetcher, new TokenBucket(time), time).download(['file'], { maxBytes: 3 }),
      ).rejects.toThrow(
        typeof failure === 'number' ? `Infomaniak HTTP ${failure}` : 'Infomaniak request failed',
      );
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(time.wait.mock.calls).toEqual(failure === 429 ? [[2000], [2000]] : [[500], [1000]]);
    },
  );

  it('does not retry download client errors or stream failures and redacts errors', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('secret-token', { status: 403 }))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error('secret-token private-url'));
            },
          }),
        ),
      );
    const gateway = setup(fetcher);
    await expect(gateway.download(['file'], { maxBytes: 3 })).rejects.toThrow(
      /^Infomaniak HTTP 403$/,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(gateway.download(['file'], { maxBytes: 3 })).rejects.toThrow(
      /^Infomaniak request failed$/,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('cancels a stalled download when its timeout signal aborts without sleeping', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          controller.abort(new Error('secret-token'));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream));
    try {
      await expect(setup(fetcher).download(['file'], { maxBytes: 3 })).rejects.toThrow(
        /^Infomaniak request failed$/,
      );
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledWith(1000);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });

  it.each([-1, NaN, Infinity, 1.1])(
    'rejects invalid binary download bound %s before HTTP',
    async (maxBytes) => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(setup(fetcher).download(['file'], { maxBytes })).rejects.toThrow(
        'Invalid download limit',
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('uploads raw bytes with encoded path/query, bearer, content type and timeout', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ result: 'success', data: { id: 42 } }));
    const bytes = new Uint8Array([0, 255, 10]);
    await expect(
      setup(fetcher).upload(['3', 'a/b?'], {
        query: { file_name: 'é &?.txt', omit: undefined },
        bytes,
        contentType: 'image/png',
      }),
    ).resolves.toEqual({ result: 'success', data: { id: 42 } });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.infomaniak.com/3/a%2Fb%3F?file_name=%C3%A9+%26%3F.txt',
      expect.objectContaining({
        method: 'POST',
        body: Buffer.from(bytes),
        headers: { Authorization: 'Bearer secret-token', 'Content-Type': 'image/png' },
        signal: expect.any(AbortSignal),
        redirect: 'error',
      }),
    );
  });

  it.each([429, 503, 'network', 'timeout', 'json'] as const)(
    'never retries upload on %s and redacts failure data',
    async (failure) => {
      const time = clock();
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
        if (typeof failure === 'number') return new Response('secret-token', { status: failure });
        if (failure === 'json') return new Response('secret-token');
        throw failure === 'timeout'
          ? new DOMException('secret-token', 'TimeoutError')
          : new Error('secret-token');
      });
      await expect(
        setup(fetcher, new TokenBucket(time), time).upload(['file'], {
          query: {},
          bytes: new Uint8Array(),
          contentType: 'application/octet-stream',
        }),
      ).rejects.toThrow(
        typeof failure === 'number'
          ? `Infomaniak HTTP ${failure}`
          : failure === 'json'
            ? 'Invalid Infomaniak response'
            : 'Infomaniak request failed',
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(time.wait).not.toHaveBeenCalled();
    },
  );

  it('shares request/download/upload quota across gateways', async () => {
    const time = clock();
    const bucket = new TokenBucket(time);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ok: true }));
    const a = setup(fetcher, bucket, time);
    const b = setup(fetcher, bucket, time);
    for (let i = 0; i < 60; i++) await a.request(request, schema);
    await b.download(['file'], { maxBytes: 20 });
    await a.upload(['file'], {
      query: {},
      bytes: new Uint8Array(),
      contentType: 'application/octet-stream',
    });
    expect(fetcher).toHaveBeenCalledTimes(62);
    expect(time.wait.mock.calls).toEqual([[1000], [1000]]);
  });
});

describe('binary gateway quota and configuration', () => {
  it('acquires shared quota again for each download retry', async () => {
    const time = clock();
    const bucket = new TokenBucket(time);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ok: true }));
    const gateway = setup(fetcher, bucket, time);
    for (let i = 0; i < 60; i++) await gateway.request(request, schema);
    fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
    await expect(gateway.download(['file'], { maxBytes: 3 })).rejects.toThrow(
      'Infomaniak HTTP 503',
    );
    expect(fetcher).toHaveBeenCalledTimes(63);
    expect(time.wait.mock.calls).toEqual([[1000], [500], [500], [1000]]);
  });

  it('uses the injected base and token for both binary methods', async () => {
    const time = clock();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ result: 'success' }));
    const gateway = new InfomaniakGateway({
      base: 'https://custom.example/api/',
      token: 'binary-token',
      timeoutMs: 42,
      bucket: new TokenBucket(time),
      fetch: fetcher,
      clock: time,
      random: () => 0,
      utcNow: () => 0,
    });
    await gateway.download(['a/b'], { maxBytes: 100 });
    await gateway.upload(['a/b'], {
      query: {},
      bytes: new Uint8Array(),
      contentType: 'application/octet-stream',
    });
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('https://custom.example/api/a%2Fb');
      expect(init?.headers).toHaveProperty('Authorization', 'Bearer binary-token');
    }
  });
});

describe('generic empty successful responses', () => {
  const responses = [
    ['204', () => new Response(null, { status: 204 })],
    [
      'content-length zero',
      () => new Response(null, { status: 200, headers: { 'Content-Length': '0' } }),
    ],
    ['empty body', () => new Response('', { status: 201 })],
  ] as const;
  it.each(responses)('passes undefined to the output schema for %s', async (_name, response) => {
    const validate = vi.fn((value: unknown) => value === undefined);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
    await expect(
      setup(fetcher).request(
        { method: 'DELETE', pathSegments: ['resource', 'id'] },
        z.custom<undefined>(validate),
      ),
    ).resolves.toBeUndefined();
    expect(validate).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(responses)(
    'still rejects %s when the output schema requires a body',
    async (_name, response) => {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
      await expect(setup(fetcher).request(request, schema)).rejects.toThrow(
        'Invalid Infomaniak response',
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('does not parse a body declared absent by content-length', async () => {
    const response = new Response('unread', { headers: { 'Content-Length': '0' } });
    const read = vi.spyOn(response, 'text');
    await expect(
      setup(vi.fn<typeof fetch>().mockResolvedValue(response)).request(request, z.undefined()),
    ).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['null', 'false', '0', '""'])(
    'preserves a nonempty JSON %s instead of treating it as absent',
    async (body) => {
      await expect(
        setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(body))).request(
          request,
          z.unknown(),
        ),
      ).resolves.toEqual(JSON.parse(body));
    },
  );
  it('keeps invalid nonempty JSON a response error', async () => {
    await expect(
      setup(vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-token'))).request(
        request,
        z.unknown(),
      ),
    ).rejects.toThrow('Invalid Infomaniak response');
  });
});

describe('additive requestWithStatus', () => {
  it.each([
    [200, () => Response.json({ extra: 'retained', ok: true }), { extra: 'retained', ok: true }],
    [204, () => new Response(null, { status: 204 }), undefined],
    [200, () => new Response('unread', { headers: { 'Content-Length': '0' } }), undefined],
    [201, () => new Response('', { status: 201 }), undefined],
  ] as const)(
    'exposes actual HTTP %i while request retains the original payload',
    async (status, response, data) => {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
      const gateway = setup(fetcher);
      const validate = vi.fn(() => true);
      const output = z.unknown().refine(validate);
      const invoke = { method: 'DELETE' as const, pathSegments: ['resource', 'id'] };
      await expect(gateway.requestWithStatus(invoke, output)).resolves.toStrictEqual({
        status,
        data,
      });
      await expect(gateway.request(invoke, output)).resolves.toStrictEqual(data);
      expect(validate.mock.calls).toEqual([[data], [data]]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it('request delegates the unchanged arguments and returns data without a schema transform', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ extra: 1, ok: true }));
    const gateway = setup(fetcher);
    const withStatus = vi.spyOn(gateway, 'requestWithStatus');
    const output = schema.transform(() => ({ transformed: true }));
    const value = await gateway.request(request, output);
    expect(value).toEqual({ extra: 1, ok: true });
    expect(Object.keys(value)).toEqual(['extra', 'ok']);
    expect(withStatus).toHaveBeenCalledExactlyOnceWith(request, output);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['request', 'requestWithStatus'] as const)(
    '%s shares auth, encoded destination, quota and Retry-After',
    async (entry) => {
      const time = clock();
      const bucket = new TokenBucket(time);
      const acquire = vi.spyOn(bucket, 'acquire');
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response('secret-token', { status: 429, headers: { 'Retry-After': '2' } }),
        )
        .mockResolvedValueOnce(new Response('secret-token', { status: 503 }))
        .mockResolvedValueOnce(Response.json({ ok: true }, { status: 202 }));
      const gateway = setup(fetcher, bucket, time);
      const invoke = { ...request, query: { term: 'a & b' } };
      const result = await gateway[entry](invoke, schema);
      expect(result).toEqual(
        entry === 'request' ? { ok: true } : { status: 202, data: { ok: true } },
      );
      expect(time.wait.mock.calls).toEqual([[2000], [1000]]);
      expect(acquire).toHaveBeenCalledTimes(3);
      expect(fetcher).toHaveBeenCalledTimes(3);
      for (const [address, init] of fetcher.mock.calls) {
        expect(new URL(String(address)).pathname).toBe('/2/drive/a%2Fb%3Fc%23d');
        expect(new URL(String(address)).searchParams.get('term')).toBe('a & b');
        expect(init).toMatchObject({
          method: 'GET',
          redirect: 'error',
          headers: { Authorization: 'Bearer secret-token', 'Content-Type': 'application/json' },
        });
        expect(init?.signal).toBeInstanceOf(AbortSignal);
      }
    },
  );

  it.each(['request', 'requestWithStatus'] as const)(
    '%s preserves failures, attempt bounds and expurgated messages',
    async (entry) => {
      const scenarios = [
        {
          response: async () => new Response('secret-token', { status: 403 }),
          error: 'Infomaniak HTTP 403',
          attempts: 1,
        },
        {
          response: async () => new Response('secret-token', { status: 503 }),
          error: 'Infomaniak HTTP 503',
          attempts: 3,
        },
        {
          response: async () => {
            throw new Error('secret-token');
          },
          error: 'Infomaniak request failed',
          attempts: 3,
        },
        {
          response: async () => new Response('secret-token'),
          error: 'Invalid Infomaniak response: invalid_json',
          attempts: 1,
        },
        {
          response: async () => Response.json({ ok: 'secret-token' }),
          error: 'Invalid Infomaniak response: ok: invalid_type',
          attempts: 1,
        },
        {
          response: async () => new Response(null, { status: 204 }),
          error: 'Invalid Infomaniak response: : invalid_type',
          attempts: 1,
        },
      ];
      for (const scenario of scenarios) {
        const time = clock();
        const fetcher = vi.fn<typeof fetch>().mockImplementation(scenario.response);
        const gateway = setup(fetcher, new TokenBucket(time), time);
        await expect(gateway[entry](request, schema)).rejects.toThrow(new Error(scenario.error));
        expect(fetcher).toHaveBeenCalledTimes(scenario.attempts);
        expect(time.wait.mock.calls).toEqual(scenario.attempts === 3 ? [[500], [1000]] : []);
      }
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'does not add retries to non-idempotent %s through requestWithStatus',
    async (method) => {
      const time = clock();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response('secret-token', { status: 503 }));
      await expect(
        setup(fetcher, new TokenBucket(time), time).requestWithStatus(
          { ...request, method },
          schema,
        ),
      ).rejects.toThrow('Infomaniak HTTP 503');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(time.wait).not.toHaveBeenCalled();
    },
  );
});
