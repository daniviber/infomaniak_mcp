import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostHeaderValidation, originValidation } from '@modelcontextprotocol/node';

export interface HttpAuth {
  token?: string;
  allowUnauthenticated: boolean;
  host: string;
}
export type SecurityEvent =
  | 'auth_rejected'
  | 'host_rejected'
  | 'origin_rejected'
  | 'body_rejected'
  | 'request_rejected'
  | 'internal_error';
export type SecurityLogger = (event: SecurityEvent) => void;

export function validateHttpAuth(auth: HttpAuth): void {
  if (auth.token !== undefined) {
    if (auth.token.length < 16) throw new Error('Invalid HTTP authentication configuration');
  } else if (!auth.allowUnauthenticated || !['127.0.0.1', '::1', 'localhost'].includes(auth.host)) {
    throw new Error('HTTP transport requires MCP_HTTP_AUTH_TOKEN');
  }
}

export function rejectHttp(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }));
}

export function createSecurityGuard(options: {
  auth: HttpAuth;
  allowedHosts: readonly string[];
  allowedOrigins: readonly string[];
  log: SecurityLogger;
}) {
  validateHttpAuth(options.auth);
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  const expected = options.auth.token === undefined ? undefined : digest(options.auth.token);
  const hosts = hostHeaderValidation([...options.allowedHosts]);
  const origins = originValidation(options.allowedOrigins.map((value) => new URL(value).hostname));
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    if (expected) {
      const header = req.headers.authorization ?? '';
      const match = /^Bearer (\S+)$/i.exec(header);
      // Equal-sized digests ensure timingSafeEqual also covers unequal token lengths.
      const equal = timingSafeEqual(expected, digest(match?.[1] ?? ''));
      if (!match || !equal) {
        options.log('auth_rejected');
        res.setHeader('WWW-Authenticate', 'Bearer');
        rejectHttp(res, 401, 'Unauthorized');
        return false;
      }
    }
    if (!hosts(req, res)) {
      options.log('host_rejected');
      return false;
    }
    if (!origins(req, res)) {
      options.log('origin_rejected');
      return false;
    }
    return true;
  };
}
