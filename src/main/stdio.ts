#!/usr/bin/env node
import { startModernStdio } from '../adapters/inbound/mcp/modern-stdio.js';
import { bootstrap } from './bootstrap.js';

try {
  const runtime = await bootstrap();
  startModernStdio(runtime.createServer, { onerror: (error) => console.error(error.message) });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
