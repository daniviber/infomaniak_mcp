import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMcpHandler, isJsonContentType, isLegacyRequest } from '@modelcontextprotocol/server';
import { toNodeHandler, toWebRequest } from '@modelcontextprotocol/node';
import type { FeatureModule } from '../../../application/feature-module.js';
import type { InvocationContext } from '../../../domain/tool-contract.js';
import { ENVELOPE_RESERVE } from '../../../application/drive/transfer.feature.js';
import { createModernServer, type createModernServerFactory } from '../mcp/modern-server.js';
import { BodyLimitError, readBody, type createModernHttpHandler } from './modern-http.js';
import { createSecurityGuard, rejectHttp, type SecurityLogger } from './security.js';

export function createLegacyHttpHandler(
  registry: {
    module: FeatureModule;
    createServer: ReturnType<typeof createModernServerFactory>;
    config: { policy: InvocationContext; toolsTtlMs: number };
  },
  options: Omit<Parameters<typeof createModernHttpHandler>[0], 'server'>,
) {
  if (!Number.isSafeInteger(options.maxBodyBytes) || options.maxBodyBytes < ENVELOPE_RESERVE)
    throw new Error('Invalid HTTP body limit');
  const log: SecurityLogger =
    options.onSecurityEvent ??
    ((event) => {
      process.stderr.write(`HTTP security: ${event}\n`);
    });
  const guard = createSecurityGuard({ ...options, log });
  const legacy = createMcpHandler(registry.createServer, {
    legacy: 'stateless',
    onerror: () => log('internal_error'),
  });
  const modern = createModernServer(
    registry.module,
    registry.config.policy,
    registry.config.toolsTtlMs,
  );
  const legacyNode = toNodeHandler(legacy, { onerror: () => log('internal_error') });
  const modernNode = toNodeHandler(modern, { onerror: () => log('internal_error') });
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
    if (!isJsonContentType(req.headers['content-type'])) {
      log('request_rejected');
      rejectHttp(res, 415, 'Unsupported content type');
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
    try {
      // Both SDK adapters receive the bounded, parsed value: neither rereads req.
      const probe = await toWebRequest(req, parsed);
      const node = (await isLegacyRequest(probe)) ? legacyNode : modernNode;
      await node(req, res, parsed);
    } catch {
      log('internal_error');
      rejectHttp(res, 500, 'Internal server error');
    }
  };
  return Object.assign(handler, {
    close: async () => {
      await Promise.all([legacy.close(), modern.close()]);
    },
  });
}
