import { serveStdio, type ServeStdioOptions } from '@modelcontextprotocol/server/stdio';
import type { createModernServerFactory } from './modern-server.js';

export function startModernStdio(
  factory: ReturnType<typeof createModernServerFactory>,
  options: Pick<ServeStdioOptions, 'transport' | 'onerror'> = {},
) {
  return serveStdio(factory, { ...options, legacy: 'reject' });
}
