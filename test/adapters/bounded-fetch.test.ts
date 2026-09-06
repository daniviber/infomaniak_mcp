import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createBoundedFetch } from '../../src/adapters/outbound/infomaniak/bounded-fetch.js';
import { BODY_LIMIT } from '../../src/application/drive/transfer.feature.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';

const sentinel = 'PROVIDER_AND_STACK_SENTINEL';
function source(parts: string[], headers: Record<string, string> = {}) {
  const cancel = vi.fn();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    const part = parts.shift();
    if (part === undefined) controller.close();
    else controller.enqueue(new TextEncoder().encode(part));
  });
  const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
    headers,
  });
  return { response, cancel, pull };
}

describe('bounded provider fetch', () => {
  it.each([{}, { 'Content-Length': '1' }, { 'Content-Length': '999999' }])(
    'counts actual bytes with absent or false Content-Length %j and cancels at +1',
    async (headers) => {
      const stream = source(['éé', 'x', sentinel], headers);
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(stream.response);
      const bounded = createBoundedFetch(fetcher, { maxResponseBytes: 4 });
      const response = await bounded('https://provider.invalid');
      expect(stream.pull).not.toHaveBeenCalled();
      const materialize = vi.spyOn(stream.response, 'text');
      await expect(response.text()).rejects.toThrow(/^Provider response limit exceeded$/);
      expect(materialize).not.toHaveBeenCalled();
      expect(stream.cancel).toHaveBeenCalledTimes(1);
      expect(stream.pull).toHaveBeenCalledTimes(2);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['text', 'json', 'arrayBuffer'] as const)(
    'allows exact bound with %s',
    async (method) => {
      const stream = source(['{"a":', '1}']);
      const response = await createBoundedFetch(
        vi.fn<typeof fetch>().mockResolvedValue(stream.response),
        { maxResponseBytes: 7 },
      )('https://provider.invalid');
      await expect(response[method]()).resolves.toBeDefined();
      expect(stream.cancel).not.toHaveBeenCalled();
    },
  );

  it('cancels a single oversized chunk without forwarding it', async () => {
    const stream = source([sentinel]);
    const response = await createBoundedFetch(
      vi.fn<typeof fetch>().mockResolvedValue(stream.response),
      { maxResponseBytes: 1 },
    )('https://provider.invalid');
    await expect(response.body!.getReader().read()).rejects.toThrow(
      'Provider response limit exceeded',
    );
    expect(stream.cancel).toHaveBeenCalledTimes(1);
  });

  it('passes the original arguments and timeout signal through without double wrapping or caching', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('ok'));
    const first = createBoundedFetch(fetcher);
    expect(createBoundedFetch(first)).toBe(first);
    const signal = new AbortController().signal;
    const init = { signal, method: 'POST', body: 'request' };
    for (let i = 0; i < 2; i++)
      expect(await (await first('https://provider.invalid', init)).text()).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]).toBe(init);
    expect(createBoundedFetch(first, { maxResponseBytes: BODY_LIMIT + 1 })).toBe(first);
    expect(createBoundedFetch(first, { maxResponseBytes: 1 })).not.toBe(first);
  });

  it('preserves response status and headers including empty 2xx', async () => {
    const empty = new Response(null, { status: 204 });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(
        new Response('ok', {
          status: 201,
          headers: { 'Content-Type': 'text/plain', 'Retry-After': '2' },
        }),
      );
    const bounded = createBoundedFetch(fetcher);
    expect(await bounded('https://provider.invalid')).toBe(empty);
    const response = await bounded('https://provider.invalid');
    expect(response.status).toBe(201);
    expect(response.headers.get('Retry-After')).toBe('2');
    expect(await response.text()).toBe('ok');
  });

  it.each(['fetch', 'stream'] as const)('redacts %s failures', async (kind) => {
    const error = new Error(sentinel);
    error.stack = sentinel;
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (kind === 'fetch') throw error;
      return new Response(
        new ReadableStream({
          pull() {
            throw error;
          },
        }),
      );
    });
    try {
      await (await createBoundedFetch(fetcher)('https://provider.invalid')).text();
      expect.fail('Expected failure');
    } catch (caught) {
      expect(caught).toBeInstanceOf(Error);
      expect(String(caught)).toMatch(/Provider (request|response) failed/);
      expect((caught as Error).stack).not.toContain(sentinel);
    }
  });

  it.each([false, true])(
    'uses caller abort, including already aborted=%s, without a timer',
    async (already) => {
      const controller = new AbortController();
      const cancel = vi.fn();
      const response = new Response(
        new ReadableStream({ pull() {}, cancel }, { highWaterMark: 0 }),
      );
      if (already) controller.abort(new Error(sentinel));
      const bounded = await createBoundedFetch(vi.fn<typeof fetch>().mockResolvedValue(response))(
        'https://provider.invalid',
        { signal: controller.signal },
      );
      const pending = bounded.text();
      if (!already) controller.abort(new Error(sentinel));
      await expect(pending).rejects.toThrow(/^Provider response failed$/);
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('propagates consumer cancellation to the provider', async () => {
    const stream = source(['first', 'second']);
    const response = await createBoundedFetch(
      vi.fn<typeof fetch>().mockResolvedValue(stream.response),
    )('https://provider.invalid');
    await response.body!.cancel();
    expect(stream.cancel).toHaveBeenCalledTimes(1);
    expect(stream.pull).not.toHaveBeenCalled();
  });

  it.each([-1, Infinity, NaN, 0.5])('rejects invalid bound %s', (maxResponseBytes) => {
    expect(() => createBoundedFetch(vi.fn<typeof fetch>(), { maxResponseBytes })).toThrow(
      'Invalid provider response limit',
    );
  });

  it('keeps gateway backoff, status and no-body tolerance with doubles only', async () => {
    const wait = vi.fn(async () => {});
    const clock = { now: () => 0, wait };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(sentinel, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const gateway = new InfomaniakGateway({
      token: 'fixture',
      timeoutMs: 30000,
      bucket: new TokenBucket(clock),
      fetch: createBoundedFetch(fetcher),
      clock,
      random: () => 0,
      utcNow: () => 0,
    });
    await expect(
      gateway.requestWithStatus({ method: 'GET', pathSegments: ['test'] }, z.undefined()),
    ).resolves.toEqual({ status: 204, data: undefined });
    expect(wait.mock.calls).toEqual([[500]]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
