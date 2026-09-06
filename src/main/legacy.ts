#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { bootstrap } from './bootstrap.js';
import { runLegacyStdio } from '../adapters/inbound/mcp/legacy-stdio.js';
import { createLegacyHttpHandler } from '../adapters/inbound/http/legacy-http.js';
import type { SecurityLogger } from '../adapters/inbound/http/security.js';

export async function createLegacyHttpApplication(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: NonNullable<Parameters<typeof bootstrap>[1]> & { onSecurityEvent?: SecurityLogger } = {},
) {
  const runtime = await bootstrap(env, options);
  const handler = createLegacyHttpHandler(runtime, {
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

// Explicit 2025 entry: stdio by default, HTTP with `node build/main/legacy.js --http`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--http')) {
      const runtime = await createLegacyHttpApplication();
      const listener = runtime.app.listen(runtime.config.http.port, runtime.config.http.host);
      listener.on('error', () => {
        process.stderr.write('HTTP server failed\n');
        process.exitCode = 1;
        void runtime.close();
      });
    } else {
      const runtime = await bootstrap();
      runLegacyStdio(runtime.createServer, {
        onerror: () => process.stderr.write('Stdio server failed\n'),
      });
    }
  } catch {
    process.stderr.write('Legacy startup failed\n');
    process.exitCode = 1;
  }
}
