import { bootstrap } from '../../src/main/bootstrap.js';
import { CalendarAdapter } from '../../src/adapters/outbound/infomaniak/calendar.adapter.js';
import { task } from '../../src/domain/calendar/event.js';
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
    if (url.pathname === '/1/calendar/pim/task') return Response.json(fixture.tasks);
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
      [...names, 'list_tasks'].map((name) => prefix + name).sort(),
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

    // FIX-12C / F1: detail nulls are distinct from the historical list DTO.
    for (const fields of [
      { location: null, rrule: null },
      { location: null, rrule: fixture.event.data.rrule },
      { location: fixture.event.data.location, rrule: null },
      { location: fixture.event.data.location, rrule: fixture.event.data.rrule },
      { location: '', rrule: '' },
      { location: undefined, rrule: undefined },
    ]) {
      const detail = await setup({
        response: () => ({
          ...fixture.observedEventDetail,
          data: { ...fixture.observedEventDetail.data, ...fields },
        }),
      });
      const domain = await detail.invoke('get_event', { event_id: 'event/42' });
      const rpc = await detail.rpc('tools/call', {
        name: prefix + 'get_event',
        arguments: { event_id: 'event/42' },
      });
      expect(rpc.error).toBeUndefined();
      expect(rpc.result.isError).not.toBe(true);
      expect(rpc.result.content).toEqual([
        { type: 'text', text: JSON.stringify(rpc.result.structuredContent, null, 2) },
      ]);
      const textOutput = JSON.parse(rpc.result.content[0].text);
      for (const output of [domain, rpc.result.structuredContent, textOutput]) {
        for (const key of ['location', 'rrule'] as const) {
          if (fields[key] == null) {
            expect(output.event).not.toHaveProperty(key);
          } else {
            expect(output.event).toHaveProperty(key, fields[key]);
          }
        }
      }
      expect(detail.calls).toHaveLength(2);
      for (const call of detail.calls) {
        expect(call.method).toBe('GET');
        expect(call.url.origin).toBe('https://api.infomaniak.com');
        expect(call.url.pathname).toBe('/1/calendar/pim/event/event%2F42');
      }
      expect(detail.clock.wait).not.toHaveBeenCalled();
    }
    const invalidDetail = await setup({
      response: () => ({
        ...fixture.observedEventDetail,
        data: { ...fixture.observedEventDetail.data, meet_room_url: null },
      }),
    });
    await expect(
      invalidDetail.module.invoke(prefix + 'get_event', { event_id: 42 }, policy),
    ).rejects.toThrow('Invalid Infomaniak response');
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
    const nullDetail = await setup({
      response: (method, url) =>
        url.pathname === '/2/profile'
          ? fixture.profile
          : method === 'GET'
            ? fixture.observedEventDetail
            : fixture.event,
    });
    await nullDetail.invoke('update_event', {
      event_id: 'event/42',
      title: 'New',
      notify_attendees: true,
    });
    expect(nullDetail.calls.map((call) => [call.method, call.url.pathname])).toEqual([
      ['GET', '/1/calendar/pim/event/event%2F42'],
      ['GET', '/2/profile'],
      ['PUT', '/1/calendar/pim/event/event%2F42'],
    ]);
    expect(nullDetail.calls.at(-1)!.body).toStrictEqual({
      ...app.calls.find((call) => call.method === 'PUT')!.body,
      location: '',
      rrule: '',
    });
    expect(nullDetail.clock.wait).not.toHaveBeenCalled();
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
        listTasks: vi.fn(),
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
      'read',
    ]);
    for (const tool of tools) {
      expect(tool.rawApi).toBe(false);
      expect(tool.experimental).toBe(false);
    }
  });
});

// Relevé /1/calendar/pim/event: integer identities, string dates, nullable recurrence and meeting URL.
it('FIX-12B parses observed Calendar types without converting string dates', async () => {
  const app = await setup({ response: () => fixture.observedEvents });
  const result = await app.invoke('list_events', {
    calendar_id: 7,
    timezone: 'UTC',
    from: '2026-03-01',
    to: '2026-04-01',
  });
  expect(result).toStrictEqual({
    events: [
      {
        id: 42,
        calendarId: 7,
        title: 'Meeting',
        description: undefined,
        timezoneStart: undefined,
        timezoneEnd: undefined,
        fullday: undefined,
        freebusy: undefined,
        private: undefined,
        attendees: undefined,
        start: '2026-03-29T01:30:00+01:00',
        end: '2026-03-29T03:30:00+02:00',
      },
    ],
  });
});

describe('FEAT-15 task list', () => {
  const name = prefix + 'list_tasks';
  const expectedTask = {
    id: 63,
    calendarId: 7,
    type: 'todo',
    title: 'Synthetic task',
    description: 'Synthetic description',
    location: 'Synthetic location',
    private: false,
    done: false,
    progress: 0,
    priority: 5,
    hasAttachments: false,
  };

  it('declares exactly the task list with required integer input and domain output', () => {
    const added = tools.filter((tool) => tool.name.includes('task'));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      name,
      classification: 'read',
      idempotent: true,
      experimental: false,
      rawApi: false,
      limits: {},
    });
    expect(added[0].inputSchema.parse({ calendar_id: 7 })).toEqual({ calendar_id: 7 });
    expect(task.parse(expectedTask)).toStrictEqual(expectedTask);
    for (const key of Object.keys(expectedTask)) {
      const missing: Record<string, unknown> = { ...expectedTask };
      delete missing[key];
      expect(task.safeParse(missing).success).toBe(false);
      expect(task.safeParse({ ...expectedTask, [key]: null }).success).toBe(false);
    }
  });

  it('returns an empty list, then the synthetic T1 sample, over the sole GET route', async () => {
    for (const data of [[], fixture.tasks.data]) {
      const app = await setup({ readOnly: true, response: () => ({ result: 'success', data }) });
      const expected = { tasks: data.length ? [expectedTask] : [] };
      expect(await app.invoke('list_tasks', { calendar_id: 7 })).toStrictEqual(expected);
      const rpc = await app.rpc('tools/call', { name, arguments: { calendar_id: 7 } });
      expect(rpc.result.isError).not.toBe(true);
      expect(rpc.result.structuredContent).toStrictEqual(expected);
      expect(rpc.result.content).toStrictEqual([
        { type: 'text', text: JSON.stringify(expected, null, 2) },
      ]);
      expect(app.calls).toHaveLength(2);
      for (const call of app.calls) {
        expect(call.method).toBe('GET');
        expect(call.url.origin).toBe('https://api.infomaniak.com');
        expect(call.url.pathname).toBe('/1/calendar/pim/task');
        expect(Object.fromEntries(call.url.searchParams)).toEqual({ calendar_id: '7' });
        expect(call.body).toBeUndefined();
      }
      expect(app.clock.wait).not.toHaveBeenCalled();
    }
  });

  it('passes an integer query to the gateway and explicitly projects only consumed fields', async () => {
    const app = await setup();
    const gateway = new InfomaniakGateway({
      token: 'offline-placeholder',
      timeoutMs: 1000,
      bucket: new TokenBucket(app.clock),
      fetch: app.fetcher,
      clock: app.clock,
      random: () => 0,
      utcNow: () => 0,
    });
    const request = vi.spyOn(gateway, 'request');
    const output = await new CalendarAdapter(gateway).listTasks({ calendar_id: 7 });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      { method: 'GET', pathSegments: ['1', 'calendar', 'pim', 'task'], query: { calendar_id: 7 } },
      expect.anything(),
    );
    expect(output).toStrictEqual({ tasks: [expectedTask] });
    expect(output.tasks[0]).not.toBe(fixture.tasks.data[0]);
    for (const key of ['due_date', 'raw', 'created_at', 'updated_at', 'calendar_id', 'has_attachments'])
      expect(output.tasks[0]).not.toHaveProperty(key);
  });

  it.each([{}, { calendar_id: '7' }, { calendar_id: 7.5 }, { calendar_id: null }])(
    'rejects invalid task input before any call: %j',
    async (input) => {
      const app = await setup();
      await expect(app.module.invoke(name, input, policy)).rejects.toThrow();
      expect(app.fetcher).not.toHaveBeenCalled();
    },
  );

  it('rejects missing, null and wrongly typed consumed T1 fields without leaking values', async () => {
    const wrong: Record<string, unknown> = {
      id: 'synthetic-sensitive-id', calendar_id: 'synthetic-sensitive-calendar',
      type: 'event', title: 12345, description: 12345, location: 12345,
      private: 'synthetic-sensitive-boolean', done: 'synthetic-sensitive-boolean',
      progress: 'synthetic-sensitive-progress', priority: 'synthetic-sensitive-priority',
      has_attachments: 'synthetic-sensitive-boolean',
    };
    for (const [key, value] of Object.entries(wrong)) {
      const missing = { ...fixture.tasks.data[0] };
      delete missing[key];
      for (const dto of [missing, { ...fixture.tasks.data[0], [key]: null }, { ...fixture.tasks.data[0], [key]: value }]) {
        const app = await setup({ response: () => ({ result: 'success', data: [dto] }) });
        let message = '';
        try {
          await app.module.invoke(name, { calendar_id: 7 }, policy);
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toContain('Invalid Infomaniak response');
        expect(message).toContain(key);
        expect(message).not.toContain(String(value));
        expect(message).not.toContain(fixture.tasks.data[0].title);
        expect(app.calls).toHaveLength(1);
      }
    }
  });

  it.each(['id', 'calendar_id', 'progress', 'priority'])(
    'rejects fractional %s without coercion',
    async (key) => {
      const app = await setup({
        response: () => ({ result: 'success', data: [{ ...fixture.tasks.data[0], [key]: 1.5 }] }),
      });
      await expect(app.module.invoke(name, { calendar_id: 7 }, policy))
        .rejects.toThrow('Invalid Infomaniak response');
    },
  );

  it('does not infer priority enums or progress bounds from the synthetic T1 sample', async () => {
    const app = await setup({
      response: () => ({
        result: 'success',
        data: [{ ...fixture.tasks.data[0], priority: -3, progress: 150 }],
      }),
    });
    expect(await app.invoke('list_tasks', { calendar_id: 7 })).toStrictEqual({
      tasks: [{ ...expectedTask, priority: -3, progress: 150 }],
    });
  });

  it.each([{ result: 'error', data: [] }, { result: 'success', data: {} }])(
    'rejects an invalid task envelope: %j',
    async (response) => {
      const app = await setup({ response: () => response });
      await expect(app.module.invoke(name, { calendar_id: 7 }, policy))
        .rejects.toThrow('Invalid Infomaniak response');
    },
  );

  it('is visible by default and callable read-only in all eight flag combinations', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.infomaniak.com/1/calendar/pim/task?calendar_id=7');
      expect(init?.method).toBe('GET');
      return Response.json(fixture.tasks);
    });
    for (const raw of [false, true])
      for (const experimental of [false, true])
        for (const chat of [false, true]) {
          const runtime = await bootstrap({
            INFOMANIAK_API_TOKEN: 'offline-placeholder',
            INFOMANIAK_READ_ONLY: 'true',
            INFOMANIAK_ALLOW_RAW_API: String(raw),
            INFOMANIAK_ALLOW_EXPERIMENTAL: String(experimental),
            ...(chat ? { KCHAT_HOST: 'chat.example.test', KCHAT_TOKEN: 'offline-chat-placeholder' } : {}),
          }, { fetch: fetcher, pattern: 'src/features/**/*.feature.ts' });
          expect(runtime.module.tools.filter((tool) => tool.name === name)).toHaveLength(1);
          const output = await runtime.module.invoke(name, { calendar_id: 7 }, runtime.config.policy);
          expect(output.isError).toBeUndefined();
          expect(output.structuredContent).toStrictEqual({ tasks: [expectedTask] });
        }
    expect(fetcher).toHaveBeenCalledTimes(8);
  });
});
