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
}

export class InfomaniakGateway {
  constructor(private readonly options: GatewayOptions) {}

  async request<T>(request: GatewayRequest, outputSchema: z.ZodType<T>): Promise<T> {
    const base = this.options.base ?? 'https://api.infomaniak.com';
    const path = request.pathSegments
      .map((segment) => encodeURIComponent(String(segment)))
      .join('/');
    const url = `${base.replace(/\/$/, '')}/${path}`;
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
        if (attempt < attempts) continue;
        throw new Error('Infomaniak request failed');
      }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < attempts) continue;
        throw new Error(`Infomaniak HTTP ${response.status}`);
      }
      try {
        const payload: unknown = await response.json();
        outputSchema.parse(payload);
        // Validation only: retain provider key order for the frozen legacy text mapping.
        return payload as T;
      } catch {
        throw new Error('Invalid Infomaniak response');
      }
    }
    throw new Error('Infomaniak request failed');
  }
}
