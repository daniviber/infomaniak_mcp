import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { createCalendarFeature, tools } from '../../src/application/calendar/calendar.feature.js';
import type { CalendarPort } from '../../src/application/calendar/calendar.port.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { discoverFeatureModules } from '../../src/main/discover-feature-modules.js';
import { createModernServer } from '../../src/adapters/inbound/mcp/modern-server.js';

const fixture = JSON.parse(readFileSync('test/fixtures/calendar.json', 'utf8'));
const policy = { readOnly: false, allowRawApi: false, allowExperimental: false };
const prefix = 'infomaniak_calendar_';
const command = {
  title: 'Meeting',
  start: '2026-03-29 02:30',
  end: '2026-03-29 04:30',
  timezone: 'Europe/Zurich',
  calendar_id: '7',
};
async function setup(
  options: {
    readOnly?: boolean;
    calendarToken?: string;
    response?: (method: string, url: URL) => unknown;
  } = {},
) {
  let stored = structuredClone(fixture.event.data);
  let deleted = false;
  const calls: {
    method: string;
    url: URL;
    body: Record<string, unknown> | undefined;
    authorization: string | null;
  }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      url,
      body,
      authorization: new Headers(init?.headers).get('Authorization'),
    });
    if (options.response) return Response.json(options.response(method, url));
    if (url.pathname === '/2/profile') return Response.json(fixture.profile);
    if (url.pathname.endsWith('/calendar')) return Response.json(fixture.calendars);
    if (method === 'POST' || method === 'PUT') {
      stored = { ...stored, ...body };
      return Response.json({ result: 'success', data: stored });
    }
    if (method === 'DELETE') {
      deleted = true;
      return Response.json(fixture.deleted);
    }
    if (url.pathname.endsWith('/event'))
      return Response.json({ result: 'success', data: deleted ? [] : [stored] });
    return Response.json({ result: 'success', data: stored });
  });
  const clock = {
    now: () => 0,
    wait: vi.fn(async () => {
      throw new Error('Unexpected wait');
    }),
  };
  const config = loadRuntimeConfig({
    INFOMANIAK_API_TOKEN: 'offline-placeholder',
    INFOMANIAK_CALENDAR_TOKEN: options.calendarToken,
  });
  const bucket = new TokenBucket(clock);
  const createGateway = vi.fn(
    ({ token }: { token: string }) =>
      new InfomaniakGateway({
        token,
        timeoutMs: 1000,
        bucket,
        fetch: fetcher,
        clock,
        random: () => 0,
        utcNow: () => 0,
      }),
  );
  const gateway = createGateway({ token: config.token });
  createGateway.mockClear();
  const module = await discoverFeatureModules('src/features/calendar.feature.ts', {
    gateway,
    createGateway,
    config,
    clock,
  });
  const context = { ...policy, readOnly: options.readOnly ?? false };
  const server = createModernServer(module, context);
  async function rpc(method: string, params: Record<string, unknown> = {}) {
    const response = await server.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Method': method,
          ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params: {
            ...params,
            _meta: {
              [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
              [CLIENT_CAPABILITIES_META_KEY]: {},
            },
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    return response.json();
  }
  async function invoke(name: string, input: unknown = {}) {
    const result = await module.invoke(prefix + name, input, context);
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(result.structuredContent, null, 2) },
    ]);
    expect(JSON.stringify(result.structuredContent)).not.toContain('provider_only');
    return result.structuredContent;
  }
  return { module, invoke, rpc, calls, fetcher, clock, createGateway };
}

describe('Calendar offline feature', () => {
  it('discovers and serves the six original names through MCP, including CRUD', async () => {
    const app = await setup();
    const names = [
      'list_calendars',
      'list_events',
      'get_event',
      'create_event',
      'update_event',
      'delete_event',
    ];
    const listed = await app.rpc('tools/list');
    expect(listed.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
      names.map((name) => prefix + name).sort(),
    );
    const inputs = [
      {},
      { from: '2026-03-29', to: '2026-03-29' },
      { event_id: 'event/42' },
      command,
      { event_id: 'event/42', title: 'Changed' },
      { event_id: 'event/42' },
    ];
    for (const [index, name] of names.entries()) {
      const response = await app.rpc('tools/call', {
        name: prefix + name,
        arguments: inputs[index],
      });
      expect(response.error).toBeUndefined();
      expect(response.result.isError).not.toBe(true);
      expect(response.result.structuredContent).toBeDefined();
      expect(response.result.content).toEqual([
        { type: 'text', text: JSON.stringify(response.result.structuredContent, null, 2) },
      ]);
      expect(JSON.stringify(response.result)).not.toContain('provider_only');
    }
    expect(await app.invoke('list_events', { from: '2026-03-29', to: '2026-03-29' })).toEqual({
      events: [],
    });
    expect(app.calls.some((call) => call.url.pathname.endsWith('/event/event%2F42'))).toBe(true);
    expect(app.clock.wait).not.toHaveBeenCalled();
  });
  it('maps calendars and full event details to validated domain output', async () => {
    const app = await setup();
    expect(await app.invoke('list_calendars')).toEqual({
      calendars: [{ id: '7', name: 'Personal', default: true, color: '#123456' }],
    });
    const result = await app.invoke('get_event', { event_id: 42 });
    expect(result.event).toMatchObject({
      id: 'event/42',
      calendarId: '7',
      title: 'Meeting',
      timezoneStart: 'Europe/Zurich',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      attendees: [
        { email: 'guest@example.test', name: 'Guest', organizer: false, state: 'ACCEPTED' },
      ],
    });
    expect(result.event).not.toHaveProperty('calendar_id');
    expect(result.event).not.toHaveProperty('alarms');
  });
  it('creates participants with the mailbox organizer and recurrence', async () => {
    const app = await setup();
    const result = await app.invoke('create_event', {
      ...command,
      calendar_id: undefined,
      attendees: ['new@example.test'],
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
      fullday: true,
      private: true,
      location: 'Office',
      freebusy: 'free',
    });
    const body = app.calls.find((call) => call.method === 'POST')!.body;
    expect(body).toMatchObject({
      calendar_id: '7',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
      fullday: true,
      private: true,
      location: 'Office',
      freebusy: 'free',
      timezone_start: 'Europe/Zurich',
      timezone_end: 'Europe/Zurich',
      attendees: [
        {
          address: 'new@example.test',
          name: 'new@example.test',
          className: 'Attendee',
          organizer: false,
          state: 'NEEDS-ACTION',
        },
        {
          address: 'owner@example.test',
          name: 'Owner',
          className: 'Attendee',
          organizer: true,
          state: 'ACCEPTED',
        },
      ],
    });
    expect(result.event).toMatchObject({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=15' });
  });
  it('updates only supplied fields while preserving the full PUT payload', async () => {
    const app = await setup();
    await app.invoke('update_event', {
      event_id: 'event/42',
      title: 'New',
      notify_attendees: true,
    });
    expect(app.calls.find((call) => call.method === 'PUT')!.body).toMatchObject({
      id: 'event/42',
      title: 'New',
      calendar_id: '7',
      description: 'Agenda',
      location: 'Room',
      start: '2026-03-29 01:30:00',
      end: '2026-03-29 03:30:00',
      attendees: fixture.event.data.attendees,
      alarms: fixture.event.data.alarms,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      notifyAttendees: true,
    });
    await app.invoke('update_event', {
      event_id: 'event/42',
      attendees: [],
      rrule: '',
      calendar_id: 8,
    });
    expect(app.calls.filter((call) => call.method === 'PUT')[1].body).toMatchObject({
      attendees: [],
      rrule: '',
      calendar_id: '8',
    });
  });
  it('replaces attendees on update and adds the organizer', async () => {
    const app = await setup();
    await app.invoke('update_event', { event_id: 42, attendees: ['replacement@example.test'] });
    expect(app.calls.find((call) => call.method === 'PUT')!.body!.attendees).toEqual([
      {
        address: 'replacement@example.test',
        name: 'replacement@example.test',
        className: 'Attendee',
        organizer: false,
        state: 'NEEDS-ACTION',
      },
      {
        address: 'owner@example.test',
        name: 'Owner',
        className: 'Attendee',
        organizer: true,
        state: 'ACCEPTED',
      },
    ]);
  });
  it.each([undefined, 8])(
    'deletes with calendar lookup or explicit calendar %s',
    async (calendar_id) => {
      const app = await setup();
      expect(await app.invoke('delete_event', { event_id: 'event/42', calendar_id })).toEqual({
        deleted: true,
        eventId: 'event/42',
      });
      expect(app.calls.filter((call) => call.method === 'GET')).toHaveLength(
        calendar_id === undefined ? 1 : 0,
      );
      expect(app.calls.at(-1)!.url.searchParams.get('calendar_id')).toBe(String(calendar_id ?? 7));
    },
  );
  it('uses the separately configured calendar token through the gateway factory', async () => {
    const app = await setup({ calendarToken: 'offline-calendar-placeholder' });
    await app.invoke('list_calendars');
    expect(app.createGateway).toHaveBeenCalledExactlyOnceWith({
      token: 'offline-calendar-placeholder',
    });
    expect(app.calls[0].authorization).toBe('Bearer offline-calendar-placeholder');
  });
  it('reuses the shared gateway when both tokens are identical', async () => {
    const app = await setup();
    await app.invoke('list_calendars');
    expect(app.createGateway).not.toHaveBeenCalled();
  });
  it('date-only queries cover the entire day and use the profile timezone and default calendar', async () => {
    const app = await setup();
    await app.invoke('list_events', { from: '2026-03-29', to: '2026-03-29' });
    expect(Object.fromEntries(app.calls.at(-1)!.url.searchParams)).toEqual({
      calendar_id: '7',
      from: '2026-03-29 00:00:00',
      to: '2026-03-29 23:59:59',
    });
  });
  it.each(['2026-03-29 02:30', '2026-10-25 02:30'])(
    'passes DST wall clock %s unchanged apart from seconds',
    async (start) => {
      const app = await setup();
      await app.invoke('create_event', { ...command, start, end: start });
      await app.invoke('update_event', { event_id: 42, start, end: start });
      for (const call of app.calls.filter(
        (call) => call.method === 'POST' || call.method === 'PUT',
      )) {
        expect(call.body).toMatchObject({
          start: `${start}:00`,
          end: `${start}:00`,
          timezone_start: 'Europe/Zurich',
          timezone_end: 'Europe/Zurich',
        });
      }
    },
  );
  it.each([
    ['2026-03-29T00:30:00Z', '2026-03-29 01:30:00'],
    ['2026-03-29T01:30:00Z', '2026-03-29 03:30:00'],
    ['2026-10-25T00:30:00Z', '2026-10-25 02:30:00'],
    ['2026-10-25T01:30:00Z', '2026-10-25 02:30:00'],
    ['2026-03-29T02:30:00+02:00', '2026-03-29 01:30:00'],
    ['2026-03-29T02:30:00+01:00', '2026-03-29 03:30:00'],
    ['2026-10-25T02:30:00+02:00', '2026-10-25 02:30:00'],
    ['2026-10-25T02:30:00+01:00', '2026-10-25 02:30:00'],
  ])(
    'converts explicit instant %s into %s across both 2026 transitions',
    async (start, expected) => {
      const app = await setup();
      await app.invoke('create_event', { ...command, start, end: start });
      await app.invoke('update_event', { event_id: 42, start, end: start });
      await app.invoke('list_events', {
        from: start,
        to: start,
        timezone: 'Europe/Zurich',
        calendar_id: 7,
      });
      for (const call of app.calls.filter(
        (call) => call.method === 'POST' || call.method === 'PUT',
      ))
        expect(call.body).toMatchObject({ start: expected, end: expected });
      expect(app.calls.at(-1)!.url.searchParams.get('from')).toBe(expected);
      expect(app.calls.at(-1)!.url.searchParams.get('to')).toBe(expected);
    },
  );
  it.each([
    ['list_calendars', {}, { result: 'success', data: [{ id: 7, name: 42 }] }],
    [
      'list_events',
      { from: '2026-03-29', to: '2026-03-29', timezone: 'UTC', calendar_id: 7 },
      { result: 'success', data: [{}] },
    ],
    [
      'get_event',
      { event_id: 42 },
      { result: 'success', data: { ...fixture.event.data, id: null } },
    ],
    [
      'get_event',
      { event_id: 42 },
      { result: 'success', data: { ...fixture.event.data, attendees: [{ address: 'bad' }] } },
    ],
    ['delete_event', { event_id: 42, calendar_id: 7 }, { result: 'error', data: true }],
  ])('rejects invalid provider DTO for %s', async (name, input, payload) => {
    const app = await setup({ response: () => payload });
    await expect(app.module.invoke(prefix + name, input, policy)).rejects.toThrow(
      'Invalid Infomaniak response',
    );
  });
  it.each(['POST', 'PUT'])(
    'rejects invalid %s event response at the gateway boundary',
    async (method) => {
      const app = await setup({
        response: (verb, url) =>
          verb === method
            ? { result: 'success', data: { ...fixture.event.data, title: 12 } }
            : url.pathname === '/2/profile'
              ? fixture.profile
              : fixture.event,
      });
      await expect(
        app.module.invoke(
          prefix + (method === 'POST' ? 'create_event' : 'update_event'),
          method === 'POST' ? command : { event_id: 42 },
          policy,
        ),
      ).rejects.toThrow('Invalid Infomaniak response');
    },
  );
  it.each([
    { attendees: ['invalid'] },
    { rrule: 'WEEKLY' },
    { timezone: 'Not/AZone' },
    { title: '' },
    { start: '2026/03/29 12:00' },
  ])('rejects invalid input before outbound calls: %j', async (change) => {
    const app = await setup();
    await expect(
      app.module.invoke(prefix + 'create_event', { ...command, ...change }, policy),
    ).rejects.toThrow();
    expect(app.fetcher).not.toHaveBeenCalled();
  });
  it('retains the baseline invalid date message', async () => {
    const app = await setup();
    const start = '2026/03/29 12:00';
    await expect(
      app.module.invoke(prefix + 'create_event', { ...command, start }, policy),
    ).rejects.toThrow(
      `Invalid date/time "${start}". Use "YYYY-MM-DD HH:mm:ss" (wall-clock in the calendar timezone) or ISO 8601 with an offset.`,
    );
  });
  it.each(['create_event', 'update_event', 'delete_event'])(
    'denies %s before any port method, even with invalid input',
    async (name) => {
      const port = {
        listCalendars: vi.fn(),
        listEvents: vi.fn(),
        getEvent: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      } satisfies CalendarPort;
      const feature = createCalendarFeature(port);
      const result = await feature.invoke(prefix + name, {}, { ...policy, readOnly: true });
      expect(result.structuredContent).toEqual({
        error: { code: 'POLICY_DENIED', reason: 'read_only', tool: prefix + name },
      });
      for (const method of Object.values(port)) expect(method).not.toHaveBeenCalled();
    },
  );
  it('allows reads in read-only mode and blocks all three writes through MCP', async () => {
    const app = await setup({ readOnly: true });
    await app.invoke('list_calendars');
    app.fetcher.mockClear();
    for (const [name, input] of [
      ['create_event', command],
      ['update_event', { event_id: 42 }],
      ['delete_event', { event_id: 42 }],
    ] as const) {
      const response = await app.rpc('tools/call', { name: prefix + name, arguments: input });
      expect(response.result.isError).toBe(true);
      expect(response.result.structuredContent.error.code).toBe('POLICY_DENIED');
    }
    expect(app.fetcher).not.toHaveBeenCalled();
  });
  it('declares authorization explicitly in every contract', () => {
    expect(tools.map((tool) => tool.classification)).toEqual([
      'read',
      'read',
      'read',
      'write',
      'write',
      'destructive',
    ]);
    for (const tool of tools) {
      expect(tool.rawApi).toBe(false);
      expect(tool.experimental).toBe(false);
    }
  });
});
