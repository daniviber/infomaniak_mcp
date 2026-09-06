import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMcpHandler, type McpServerFactory } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { ENVELOPE_RESERVE } from '../../../application/drive/transfer.feature.js';
import { createSecurityGuard, rejectHttp, type HttpAuth, type SecurityLogger } from './security.js';

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      req.off('data', data);
      req.off('end', end);
      req.off('error', failed);
      req.off('aborted', failed);
    };
    const failed = () => {
      cleanup();
      reject(new Error('Invalid request body'));
    };
    const data = (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > maxBytes) {
        cleanup();
        req.pause();
        reject(new BodyLimitError());
      } else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    req.on('data', data);
    req.once('end', end);
    req.once('error', failed);
    req.once('aborted', failed);
  });
}
class BodyLimitError extends Error {}

export function createModernHttpHandler(options: {
  server: McpServerFactory;
  auth: HttpAuth;
  allowedHosts: readonly string[];
  allowedOrigins: readonly string[];
  maxBodyBytes: number;
  onSecurityEvent?: SecurityLogger;
}) {
  if (!Number.isSafeInteger(options.maxBodyBytes) || options.maxBodyBytes < ENVELOPE_RESERVE)
    throw new Error('Invalid HTTP body limit');
  const log: SecurityLogger =
    options.onSecurityEvent ??
    ((event) => {
      process.stderr.write(`HTTP security: ${event}\n`);
    });
  const guard = createSecurityGuard({ ...options, log });
  const mcp = createMcpHandler(options.server, {
    legacy: 'reject',
    responseMode: 'json',
    onerror: () => log('internal_error'),
  });
  const node = toNodeHandler(mcp, { onerror: () => log('internal_error') });
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!guard(req, res)) return;
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      rejectHttp(res, 405, 'Method not allowed');
      return;
    }
    if (req.headers['mcp-session-id'] !== undefined || req.headers['last-event-id'] !== undefined) {
      log('request_rejected');
      rejectHttp(res, 400, 'Unsupported transport header');
      return;
    }
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
      log('request_rejected');
      rejectHttp(res, 415, 'Unsupported content encoding');
      return;
    }
    let parsed: unknown;
    try {
      const body = await readBody(req, options.maxBodyBytes);
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    } catch (error) {
      log('body_rejected');
      res.setHeader('Connection', 'close');
      rejectHttp(
        res,
        error instanceof BodyLimitError ? 413 : 400,
        error instanceof BodyLimitError ? 'Request body limit exceeded' : 'Invalid request body',
      );
      return;
    }
    await node(req, res, parsed);
  };
  return Object.assign(handler, { close: mcp.close });
}
