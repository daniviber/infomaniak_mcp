import { BODY_LIMIT } from '../../../application/drive/transfer.feature.js';

export interface BoundedFetchOptions {
  maxResponseBytes?: number;
}

// Wrapper provenance only: no provider responses or credentials are cached.
const bounds = new WeakMap<typeof fetch, number>();

export function createBoundedFetch(
  fetcher: typeof fetch,
  { maxResponseBytes = BODY_LIMIT }: BoundedFetchOptions = {},
): typeof fetch {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0)
    throw new Error('Invalid provider response limit');
  const existing = bounds.get(fetcher);
  if (existing !== undefined && existing <= maxResponseBytes) return fetcher;
  const bounded: typeof fetch = async (input, init) => {
    let response: Response;
    try {
      response = await fetcher(input, init);
    } catch {
      throw new Error('Provider request failed');
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    let size = 0;
    let finished = false;
    let abort: (() => void) | undefined;
    const clean = () => {
      finished = true;
      if (abort) signal?.removeEventListener('abort', abort);
    };
    const cancel = () => {
      clean();
      void reader.cancel().catch(() => undefined);
    };
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          abort = () => {
            if (finished) return;
            cancel();
            controller.error(new Error('Provider response failed'));
          };
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        },
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (finished) return;
            if (done) {
              clean();
              reader.releaseLock();
              controller.close();
            } else if (value.byteLength > maxResponseBytes - size) {
              cancel();
              controller.error(new Error('Provider response limit exceeded'));
            } else {
              size += value.byteLength;
              controller.enqueue(value);
            }
          } catch {
            if (finished) return;
            cancel();
            controller.error(new Error('Provider response failed'));
          }
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  bounds.set(bounded, maxResponseBytes);
  return bounded;
}
