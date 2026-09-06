import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { bootstrap } from '../../src/main/bootstrap.js';
import { createHttpApplication } from '../../src/main/http.js';
import { createLegacyHttpApplication } from '../../src/main/legacy.js';
import { startModernStdio } from '../../src/adapters/inbound/mcp/modern-stdio.js';
import { runLegacyStdio } from '../../src/adapters/inbound/mcp/legacy-stdio.js';

const pattern = fileURLToPath(new URL('../../src/features/**/*.feature.ts', import.meta.url));
const bearer = 'MVP_HTTP_SENTINEL_NOT_A_SECRET';
const defaults = { INFOMANIAK_API_TOKEN: 'MVP_PROVIDER_SENTINEL', MCP_HTTP_AUTH_TOKEN: bearer };
const all = {
  ...defaults,
  INFOMANIAK_ALLOW_RAW_API: 'true',
  INFOMANIAK_ALLOW_EXPERIMENTAL: 'true',
  KCHAT_HOST: 'chat.example.test',
  KCHAT_TOKEN: 'MVP_CHAT_SENTINEL',
};
const names = (entries: readonly { name: string }[]) => entries.map(({ name }) => name).sort();
const clock = {
  now: () => 0,
  wait: async () => {
    throw new Error('Unexpected quota wait');
  },
};
const ok = (data: unknown) => Response.json({ result: 'success', data });

// Stateful provider double: every accepted route is explicit; no network fallback.
function provider() {
  let item: Record<string, unknown> | undefined;
  let trashed = false;
  let event: Record<string, unknown> | undefined;
  let invalid = false;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.infomaniak.com');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${defaults.INFOMANIAK_API_TOKEN}`,
    );
    const route = `${init?.method ?? 'GET'} ${url.pathname}`;
    const body = () => JSON.parse(String(init?.body)) as Record<string, unknown>;
    switch (route) {
      case 'GET /3/drive/7/files/1/files':
        return ok(invalid ? [{ id: 'invalid' }] : item && !trashed ? [item] : []);
      case 'POST /3/drive/7/upload':
        expect(Buffer.from(init?.body as Uint8Array).toString()).toBe('MVP offline');
        item = { id: 42, name: url.searchParams.get('file_name'), type: 'file', size: 11 };
        return ok(item);
      case 'POST /2/drive/7/files/42/rename':
        expect(item).toBeDefined();
        item = { ...item, name: body().name };
        return ok(null);
      case 'DELETE /2/drive/7/files/42':
        expect(item).toBeDefined();
        trashed = true;
        return ok(null);
      case 'GET /3/drive/7/trash':
        return ok(trashed ? [item] : []);
      case 'POST /2/drive/7/trash/42/restore':
        expect(trashed).toBe(true);
        trashed = false;
        return ok(null);
      case 'GET /2/drive/7/files/42/download':
        expect(item).toBeDefined();
        expect(trashed).toBe(false);
        return new Response('MVP offline', { headers: { 'content-type': 'text/plain' } });
      case 'GET /1/calendar/pim/calendar':
        return ok([{ id: '7', name: 'Offline', default: true }]);
      case 'GET /2/profile':
        return ok({ email: 'owner@example.test' });
      case 'GET /1/calendar/pim/event':
        return ok(event ? [event] : []);
      case 'POST /1/calendar/pim/event':
        expect(event).toBeUndefined();
        event = { ...body(), id: 'mvp-event' };
        return ok(event);
      case 'GET /1/calendar/pim/event/mvp-event':
        expect(event).toBeDefined();
        return ok(event);
      case 'PUT /1/calendar/pim/event/mvp-event':
        expect(event).toBeDefined();
        event = body();
        return ok(event);
      case 'DELETE /1/calendar/pim/event/mvp-event':
        expect(event).toBeDefined();
        event = undefined;
        return ok(null);
      default:
        throw new Error(`Unscripted provider route: ${route}`);
    }
  });
  return {
    fetcher,
    invalidate: () => {
      invalid = true;
    },
  };
}

async function session(
  era: 'modern' | 'legacy',
  transport: 'stdio' | 'http',
  env: Record<string, string>,
  fetcher: typeof fetch,
) {
  const options = { pattern, clock, fetch: fetcher };
  const runtime = await (
    transport === 'stdio'
      ? bootstrap
      : era === 'modern'
        ? createHttpApplication
        : createLegacyHttpApplication
  )(env, options);
  const client = new Client(
    { name: 'mvp-offline', version: '1' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  const closers: (() => Promise<void>)[] = [];
  let url: URL | undefined;
  const localFetch: typeof fetch = async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    expect(target.origin).toBe(url?.origin);
    return fetch(input, { ...init, redirect: 'error' });
  };
  try {
    let wire;
    if ('app' in runtime) {
      closers.push(runtime.close);
      const server = createServer(runtime.app);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      closers.push(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing loopback listener');
      url = new URL(`http://127.0.0.1:${address.port}/mcp`);
      wire = new StreamableHTTPClientTransport(url, {
        fetch: localFetch,
        requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
      });
    } else {
      const input = new PassThrough();
      const output = new PassThrough();
      const handle = (era === 'modern' ? startModernStdio : runLegacyStdio)(runtime.createServer, {
        transport: new StdioServerTransport(input, output),
      });
      closers.push(async () => {
        await handle.close();
        input.destroy();
        output.destroy();
      });
      wire = new StdioServerTransport(output, input);
    }
    closers.push(() => client.close());
    await client.connect(wire, era === 'legacy' ? { prior: { kind: 'legacy' } } : {});
    return {
      runtime,
      client,
      url,
      localFetch,
      close: async () => {
        for (const close of closers.reverse()) await close();
      },
    };
  } catch (error) {
    for (const close of closers.reverse()) await close();
    throw error;
  }
}

async function success(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBeUndefined();
  expect(result.content).toEqual([
    { type: 'text', text: JSON.stringify(result.structuredContent, null, 2) },
  ]);
  return result.structuredContent;
}

// Global counts are deliberately compared, never hard-coded in this test.
describe('MVP offline acceptance', () => {
  it('matches independent inventories, declarations and configured visibility', async () => {
    const noFetch = vi.fn<typeof fetch>(async () => {
      throw new Error('Discovery must not call provider');
    });
    const full = await bootstrap(all, { pattern, clock, fetch: noFetch });
    for (const path of [
      '../../test/fixtures/baseline-tools.json',
      '../../product/inventory/tools.json',
    ]) {
      const entries = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
        name: string;
      }[];
      expect(new Set(names(entries)).size).toBe(entries.length);
      expect(names(entries)).toEqual(names(full.module.tools));
    }
    for (const raw of [false, true])
      for (const experimental of [false, true])
        for (const chat of [false, true]) {
          const env = {
            ...defaults,
            INFOMANIAK_ALLOW_RAW_API: String(raw),
            INFOMANIAK_ALLOW_EXPERIMENTAL: String(experimental),
            ...(chat ? { KCHAT_HOST: all.KCHAT_HOST, KCHAT_TOKEN: all.KCHAT_TOKEN } : {}),
          };
          const normal = await bootstrap(env, { pattern, clock, fetch: noFetch });
          const readOnly = await bootstrap(
            { ...env, INFOMANIAK_READ_ONLY: 'true' },
            { pattern, clock, fetch: noFetch },
          );
          const expected = full.module.tools.filter(
            (tool) =>
              (!tool.experimental || experimental) &&
              (!tool.rawApi || raw) &&
              (!tool.name.startsWith('infomaniak_kchat_') || chat),
          );
          expect(names(normal.module.tools)).toEqual(names(expected));
          expect(names(readOnly.module.tools)).toEqual(names(expected));
        }
    expect(noFetch).not.toHaveBeenCalled();
  });

  for (const era of ['modern', 'legacy'] as const)
    for (const transport of ['stdio', 'http'] as const) {
      it(`${era} ${transport}: discovery, read-only, refusals, DTO and cycles on doubles`, async () => {
        const double = provider();
        const read = await session(
          era,
          transport,
          { ...all, INFOMANIAK_READ_ONLY: 'true' },
          double.fetcher,
        );
        try {
          expect(read.client.getProtocolEra()).toBe(era);
          expect(read.client.getNegotiatedProtocolVersion()).toBe(
            era === 'modern' ? '2026-07-28' : '2025-11-25',
          );
          if (era === 'modern') expect(await read.client.discover()).toHaveProperty('_meta');
          expect(names((await read.client.listTools()).tools)).toEqual(
            names(read.runtime.module.tools),
          );
          expect(
            await success(read.client, 'infomaniak_list_kdrive_files', { drive_id: 7 }),
          ).toEqual({ items: [], hasMore: false });
          expect(await success(read.client, 'infomaniak_calendar_list_calendars')).toEqual({
            calendars: [{ id: '7', name: 'Offline', default: true }],
          });
          const before = double.fetcher.mock.calls.length;
          for (const [name, args] of [
            ['infomaniak_delete_kdrive_trashed_file_permanently', { drive_id: 7, file_id: 42 }],
            ['infomaniak_api_call', { method: 'POST', endpoint: '/1/ping' }],
          ] as const) {
            expect(await read.client.callTool({ name, arguments: args })).toMatchObject({
              isError: true,
              content: [{ type: 'text', text: `[POLICY_DENIED] read_only: ${name}` }],
              structuredContent: {
                error: { code: 'POLICY_DENIED', reason: 'read_only', tool: name },
              },
            });
          }
          if ('app' in read.runtime) {
            for (const [headers, status] of [
              [{}, 401],
              [{ Authorization: `Bearer ${bearer}`, Host: 'foreign.example.test' }, 403],
              [{ Authorization: `Bearer ${bearer}`, Origin: 'https://foreign.example.test' }, 403],
            ] as const) {
              const response = await request(read.runtime.app)
                .post('/mcp')
                .set(headers)
                .set('Content-Type', 'application/json')
                .send('{invalid');
              expect(response.status).toBe(status);
            }
          }
          expect(double.fetcher.mock.calls.length).toBe(before);
        } finally {
          await read.close();
        }

        const write = await session(era, transport, all, double.fetcher);
        try {
          const client = write.client;
          expect(
            await success(client, 'infomaniak_upload_kdrive_file', {
              drive_id: 7,
              directory_id: 1,
              file_name: 'mvp.txt',
              text_content: 'MVP offline',
            }),
          ).toMatchObject({ item: { id: 42, name: 'mvp.txt' } });
          await success(client, 'infomaniak_rename_kdrive_file', {
            drive_id: 7,
            file_id: 42,
            name: 'renamed.txt',
          });
          expect(
            await success(client, 'infomaniak_list_kdrive_files', { drive_id: 7 }),
          ).toMatchObject({ items: [{ id: 42, name: 'renamed.txt' }] });
          await success(client, 'infomaniak_delete_kdrive_file', { drive_id: 7, file_id: 42 });
          expect(await success(client, 'infomaniak_list_kdrive_files', { drive_id: 7 })).toEqual({
            items: [],
            hasMore: false,
          });
          expect(
            await success(client, 'infomaniak_list_kdrive_trash', { drive_id: 7 }),
          ).toMatchObject({ items: [{ id: 42 }] });
          await success(client, 'infomaniak_restore_kdrive_file', { drive_id: 7, file_id: 42 });
          expect(await success(client, 'infomaniak_list_kdrive_trash', { drive_id: 7 })).toEqual({
            items: [],
            hasMore: false,
          });
          expect(
            await success(client, 'infomaniak_download_kdrive_file', { drive_id: 7, file_id: 42 }),
          ).toMatchObject({ content: 'MVP offline', sizeBytes: 11 });
          for (const [start, end, localStart, localEnd] of [
            [
              '2026-03-29T00:30:00Z',
              '2026-03-29T01:30:00Z',
              '2026-03-29 01:30:00',
              '2026-03-29 03:30:00',
            ],
            [
              '2026-10-25T00:30:00Z',
              '2026-10-25T01:30:00Z',
              '2026-10-25 02:30:00',
              '2026-10-25 02:30:00',
            ],
          ]) {
            expect(
              await success(client, 'infomaniak_calendar_create_event', {
                calendar_id: '7',
                title: 'DST offline',
                timezone: 'Europe/Zurich',
                start,
                end,
              }),
            ).toMatchObject({
              event: {
                id: 'mvp-event',
                start: localStart,
                end: localEnd,
                timezoneStart: 'Europe/Zurich',
              },
            });
            expect(
              await success(client, 'infomaniak_calendar_get_event', { event_id: 'mvp-event' }),
            ).toMatchObject({ event: { title: 'DST offline' } });
            expect(
              await success(client, 'infomaniak_calendar_update_event', {
                event_id: 'mvp-event',
                title: 'Updated',
              }),
            ).toMatchObject({ event: { title: 'Updated', start: localStart, end: localEnd } });
            expect(
              await success(client, 'infomaniak_calendar_delete_event', {
                event_id: 'mvp-event',
                calendar_id: '7',
              }),
            ).toEqual({ deleted: true, eventId: 'mvp-event' });
            expect(
              await success(client, 'infomaniak_calendar_list_events', {
                calendar_id: '7',
                timezone: 'Europe/Zurich',
                from: start,
                to: end,
              }),
            ).toEqual({ events: [] });
          }
          double.invalidate();
          const invalid = await client.callTool({
            name: 'infomaniak_list_kdrive_files',
            arguments: { drive_id: 7 },
          });
          expect(invalid.isError).toBe(true);
          expect(JSON.stringify(invalid)).toContain('Invalid Infomaniak response');
          expect(JSON.stringify(invalid)).not.toContain(defaults.INFOMANIAK_API_TOKEN);
        } finally {
          await write.close();
        }
      });
    }
});
