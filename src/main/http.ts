#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { bootstrap } from './bootstrap.js';
import { createModernHttpHandler } from '../adapters/inbound/http/modern-http.js';
import { createBoundedFetch } from '../adapters/outbound/infomaniak/bounded-fetch.js';
import type { SecurityLogger } from '../adapters/inbound/http/security.js';

export async function createHttpApplication(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: NonNullable<Parameters<typeof bootstrap>[1]> & { onSecurityEvent?: SecurityLogger } = {},
) {
  const runtime = await bootstrap(env, {
    ...options,
    fetch: createBoundedFetch(options.fetch ?? fetch),
  });
  const handler = createModernHttpHandler({
    server: runtime.createServer,
    ...runtime.config.http,
    onSecurityEvent: options.onSecurityEvent,
  });
  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin: [...runtime.config.http.allowedOrigins],
      credentials: false,
      preflightContinue: true,
    }),
  );
  app.all('/mcp', handler);
  return { ...runtime, app, close: handler.close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const runtime = await createHttpApplication();
    const listener = runtime.app.listen(runtime.config.http.port, runtime.config.http.host);
    listener.on('error', () => {
      process.stderr.write('HTTP server failed\n');
      process.exitCode = 1;
      void runtime.close();
    });
  } catch {
    process.stderr.write('HTTP startup failed\n');
    process.exitCode = 1;
  }
}
