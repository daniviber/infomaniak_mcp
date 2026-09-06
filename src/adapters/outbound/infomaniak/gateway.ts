import { z } from 'zod';

export interface GatewayClock {
  now(): number;
  wait(milliseconds: number): Promise<void>;
}

/** One bucket is composed in main and shared by every product and token. */
export class TokenBucket {
  private tokens = 60;
  private updatedAt: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly clock: GatewayClock) {
    this.updatedAt = clock.now();
  }

  acquire(): Promise<void> {
    const acquired = this.queue.then(async () => {
      for (;;) {
        const now = this.clock.now();
        this.tokens = Math.min(60, this.tokens + Math.max(0, now - this.updatedAt) / 1000);
        this.updatedAt = now;
        if (this.tokens >= 1) {
          this.tokens -= 1;
          return;
        }
        await this.clock.wait(Math.ceil((1 - this.tokens) * 1000));
      }
    });
    this.queue = acquired.catch(() => undefined);
    return acquired;
  }
}

export interface GatewayRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pathSegments: readonly (string | number)[];
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  idempotent?: boolean;
}

export interface GatewayOptions {
  token: string;
  /** Injectable for kChat; the Infomaniak composition uses the fixed default. */
  base?: string;
  timeoutMs: number;
  bucket: TokenBucket;
  fetch: typeof fetch;
  clock: GatewayClock;
  random: () => number;
  /** UTC epoch milliseconds, independent of the quota clock. */
  utcNow: () => number;
}

/** Multiplicative jitter: base * (1 + random()), clamped to 8 seconds.
 * A valid Retry-After is never shortened by jitter (only by its 30 second cap).
 */
export function retryDelay(
  attempt: number,
  random: () => number,
  retryAfter: string | null,
  utcNow: () => number,
): number {
  if (retryAfter !== null) {
    const value = retryAfter.trim();
    const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
    const date = /^[A-Za-z]{3}, /.test(value) ? Date.parse(value) : NaN;
    const delay = Number.isFinite(seconds) ? seconds * 1000 : date - utcNow();
    if (Number.isFinite(delay)) return Math.min(30000, Math.max(0, delay));
  }
  return Math.min(8000, 500 * 2 ** (attempt - 1) * (1 + random()));
}

export class InfomaniakGateway {
  constructor(private readonly options: GatewayOptions) {}

  async download(
    pathSegments: readonly (string | number)[],
    options: { query?: GatewayRequest['query']; maxBytes: number },
  ): Promise<{ bytes: Uint8Array; contentType: string; fileName: string | null }> {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
      throw new Error('Invalid download limit');
    const base = this.options.base ?? 'https://api.infomaniak.com';
    const path = pathSegments.map((segment) => encodeURIComponent(String(segment))).join('/');
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) query.append(key, String(value));
    }
    const url = `${base.replace(/\/$/, '')}/${path}${query.size ? `?${query}` : ''}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.options.bucket.acquire();
      const signal = AbortSignal.timeout(this.options.timeoutMs);
      let response: Response;
      try {
        response = await this.options.fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.options.token}` },
          signal,
          redirect: 'error',
        });
      } catch {
        if (attempt < 3) {
          await this.options.clock.wait(
            retryDelay(attempt, this.options.random, null, this.options.utcNow),
          );
          continue;
        }
        throw new Error('Infomaniak request failed');
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          await this.options.clock.wait(
            retryDelay(
              attempt,
              this.options.random,
              response.status === 429 ? response.headers.get('Retry-After') : null,
              this.options.utcNow,
            ),
          );
          continue;
        }
        throw new Error(`Infomaniak HTTP ${response.status}`);
      }
      const reader = response.body?.getReader();
      const buffer = new Uint8Array(options.maxBytes);
      let size = 0;
      let exceeded = false;
      let abort: (() => void) | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        abort = () => reject(new Error('Infomaniak request failed'));
        signal.addEventListener('abort', abort, { once: true });
      });
      try {
        if (reader) {
          for (;;) {
            signal.throwIfAborted();
            const { done, value } = await Promise.race([reader.read(), timedOut]);
            if (done) break;
            // Inspect at most the first excess byte; never retain an oversized chunk.
            const observed = Math.min(value.byteLength, options.maxBytes - size + 1);
            if (size + observed > options.maxBytes) {
              exceeded = true;
              throw new Error('Download limit exceeded');
            }
            buffer.set(value.subarray(0, observed), size);
            size += observed;
          }
        }
        const bytes = buffer.subarray(0, size);
        const disposition = response.headers.get('Content-Disposition') ?? '';
        const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
        const plain = /filename=(?:"([^"]*)"|([^;]+))/i.exec(disposition);
        return {
          bytes,
          contentType: response.headers.get('Content-Type') ?? 'application/octet-stream',
          fileName: extended
            ? decodeURIComponent(extended[1])
            : (plain?.[1] ?? plain?.[2]?.trim() ?? null),
        };
      } catch {
        // Cancellation is initiated immediately, including on streams with false/missing length.
        void reader?.cancel().catch(() => undefined);
        throw new Error(exceeded ? 'Download limit exceeded' : 'Infomaniak request failed');
      } finally {
        if (abort) signal.removeEventListener('abort', abort);
        reader?.releaseLock();
      }
    }
    throw new Error('Infomaniak request failed');
  }

  async upload(
    pathSegments: readonly (string | number)[],
    options: {
      query: NonNullable<GatewayRequest['query']>;
      bytes: Uint8Array;
      contentType: string;
    },
  ): Promise<unknown> {
    const base = this.options.base ?? 'https://api.infomaniak.com';
    const path = pathSegments.map((segment) => encodeURIComponent(String(segment))).join('/');
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) query.append(key, String(value));
    }
    const url = `${base.replace(/\/$/, '')}/${path}${query.size ? `?${query}` : ''}`;
    await this.options.bucket.acquire();
    let response: Response;
    try {
      response = await this.options.fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          'Content-Type': options.contentType,
        },
        body: Buffer.from(options.bytes),
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: 'error',
      });
    } catch {
      throw new Error('Infomaniak request failed');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Infomaniak HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error('Invalid Infomaniak response');
    }
  }

  async request<T>(request: GatewayRequest, outputSchema: z.ZodType<T>): Promise<T> {
    return (await this.requestWithStatus(request, outputSchema)).data;
  }

  async requestWithStatus<T>(
    request: GatewayRequest,
    outputSchema: z.ZodType<T>,
  ): Promise<{ status: number; data: T }> {
    const base = this.options.base ?? 'https://api.infomaniak.com';
    const path = request.pathSegments
      .map((segment) => encodeURIComponent(String(segment)))
      .join('/');
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) query.append(key, String(value));
    }
    const url = `${base.replace(/\/$/, '')}/${path}${query.size ? `?${query}` : ''}`;
    const attempts = request.method === 'GET' || request.idempotent ? 3 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.options.bucket.acquire();
      let response: Response;
      try {
        response = await this.options.fetch(url, {
          method: request.method,
          headers: {
            Authorization: `Bearer ${this.options.token}`,
            'Content-Type': 'application/json',
          },
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal: AbortSignal.timeout(this.options.timeoutMs),
          redirect: 'error',
        });
      } catch {
        if (attempt < attempts) {
          await this.options.clock.wait(
            retryDelay(attempt, this.options.random, null, this.options.utcNow),
          );
          continue;
        }
        throw new Error('Infomaniak request failed');
      }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
          await this.options.clock.wait(
            retryDelay(
              attempt,
              this.options.random,
              response.status === 429 ? response.headers.get('Retry-After') : null,
              this.options.utcNow,
            ),
          );
          continue;
        }
        throw new Error(`Infomaniak HTTP ${response.status}`);
      }
      try {
        const body =
          response.status === 204 || response.headers.get('Content-Length') === '0'
            ? ''
            : await response.text();
        const payload: unknown = body === '' ? undefined : JSON.parse(body);
        outputSchema.parse(payload);
        // Validation only: retain provider key order for the frozen legacy text mapping.
        return { status: response.status, data: payload as T };
      } catch (error) {
        const issues =
          error instanceof z.ZodError
            ? error.issues
                .map((issue) => {
                  const types =
                    issue.code === 'invalid_type'
                      ? issue.message.match(/^Invalid input: expected ([a-z]+), received ([a-z]+)$/)
                      : null;
                  return `${issue.path.join('.')}: ${issue.code}${types ? ` expected ${types[1]} received ${types[2]}` : ''}`;
                })
                .join('; ')
            : 'invalid_json';
        throw new Error(`Invalid Infomaniak response: ${issues}`);
      }
    }
    throw new Error('Infomaniak request failed');
  }
}
