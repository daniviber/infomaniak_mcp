/**
 * Infomaniak Calendar API Client
 *
 * Wraps the Infomaniak "PIM" calendar endpoints used by the kSuite Calendar app.
 * Endpoints (verified against Infomaniak's official `mcp-server-calendar`):
 *
 *   GET    /1/calendar/pim/calendar                 list calendars of the token owner
 *   GET    /1/calendar/pim/event?calendar_id&from&to list events in a time range
 *   GET    /1/calendar/pim/event/{id}                get one event
 *   POST   /1/calendar/pim/event                     create an event
 *   PUT    /1/calendar/pim/event/{id}                update an event (full payload)
 *   DELETE /1/calendar/pim/event/{id}?calendar_id    delete an event
 *   GET    /2/profile                                token owner profile (timezone, email)
 *
 * IMPORTANT: the calendar API is *user scoped*. The token must be created while
 * logged in as the user who owns the mailbox whose calendar you want to access,
 * with the scopes `workspace:calendar` and `user_info`.
 *
 * Date/time convention: the API expects wall-clock values formatted as
 * `YYYY-MM-DD HH:mm:ss` together with an IANA timezone name. This client accepts
 * either wall-clock strings (interpreted in the target timezone) or ISO 8601
 * strings with an explicit offset / `Z` (converted to the target timezone).
 */

import type { ApiResponse, InfomaniakClient } from './infomaniak-client.js';

export interface Calendar {
  id: number | string;
  name: string;
  default?: boolean;
  color?: string;
  [key: string]: unknown;
}

export interface CalendarAttendee {
  address: string;
  name: string;
  className: 'Attendee';
  organizer: boolean;
  state: 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';
}

export interface CalendarEvent {
  id: number;
  calendar_id: number | string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  timezone_start?: string;
  timezone_end?: string;
  fullday?: boolean;
  freebusy?: string;
  type?: string;
  private?: boolean;
  rrule?: string;
  attendees?: CalendarAttendee[];
  alarms?: unknown[];
  attachments?: unknown[];
  meet_room_url?: string;
  bookable_resource_id?: number | null;
  [key: string]: unknown;
}

export interface CalendarProfile {
  id: number;
  email: string;
  display_name: string;
  preferences?: { timezone?: { name?: string } };
  [key: string]: unknown;
}

export interface CreateEventInput {
  title: string;
  start: string;
  end: string;
  calendar_id?: number | string;
  description?: string;
  location?: string;
  attendees?: string[];
  rrule?: string;
  fullday?: boolean;
  timezone?: string;
  freebusy?: 'busy' | 'free';
  private?: boolean;
}

export interface UpdateEventInput {
  title?: string;
  start?: string;
  end?: string;
  calendar_id?: number | string;
  description?: string;
  location?: string;
  attendees?: string[];
  rrule?: string;
  fullday?: boolean;
  timezone?: string;
  freebusy?: 'busy' | 'free';
  private?: boolean;
  notify_attendees?: boolean;
}

const WALL_CLOCK_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Format a Date as `YYYY-MM-DD HH:mm:ss` wall-clock time in the given IANA timezone.
 */
export function formatInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Normalize a user supplied date/time into the API wall-clock format for `timeZone`.
 *
 * - `YYYY-MM-DD HH:mm[:ss]` or `YYYY-MM-DDTHH:mm[:ss]` (no offset): taken as wall-clock in `timeZone`.
 * - `YYYY-MM-DD`: start of that day.
 * - Anything with an explicit offset or `Z`: converted to `timeZone`.
 */
export function toApiDateTime(input: string, timeZone: string, endOfDay = false): string {
  const value = input.trim();

  const wall = WALL_CLOCK_RE.exec(value);
  if (wall) {
    const [, day, hh, mm, ss] = wall;
    return `${day} ${hh}:${mm}:${ss ?? '00'}`;
  }

  if (DATE_ONLY_RE.test(value)) {
    return endOfDay ? `${value} 23:59:59` : `${value} 00:00:00`;
  }

  if (!HAS_OFFSET_RE.test(value)) {
    throw new Error(
      `Invalid date/time "${input}". Use "YYYY-MM-DD HH:mm:ss" (wall-clock in the calendar timezone) or ISO 8601 with an offset.`,
    );
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date/time "${input}".`);
  }
  return formatInTimeZone(date, timeZone);
}

function assertValidTimeZone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new Error(`Invalid IANA timezone "${tz}".`);
  }
}

export class CalendarClient {
  private profileCache?: CalendarProfile;

  constructor(private readonly api: InfomaniakClient) {}

  // ─── Profile ──────────────────────────────────────────────────────────────

  async getProfile(): Promise<CalendarProfile> {
    if (!this.profileCache) {
      const res = await this.api.call<CalendarProfile>('GET', '/2/profile');
      this.profileCache = res.data;
    }
    return this.profileCache;
  }

  private async resolveTimeZone(explicit?: string): Promise<string> {
    if (explicit) {
      assertValidTimeZone(explicit);
      return explicit;
    }
    const profile = await this.getProfile();
    return profile.preferences?.timezone?.name ?? 'UTC';
  }

  // ─── Calendars ────────────────────────────────────────────────────────────

  async listCalendars(): Promise<Calendar[]> {
    const res = await this.api.call<{ calendars?: Calendar[] } | Calendar[]>('GET', '/1/calendar/pim/calendar');
    const data = res.data;
    if (Array.isArray(data)) return data;
    return data?.calendars ?? [];
  }

  async getDefaultCalendar(): Promise<Calendar> {
    const calendars = await this.listCalendars();
    const chosen = calendars.find((c) => c.default) ?? calendars[0];
    if (!chosen) {
      throw new Error('No calendar found for this token. Check the token scopes (workspace:calendar, user_info).');
    }
    return chosen;
  }

  private async resolveCalendarId(explicit?: number | string): Promise<string> {
    if (explicit !== undefined && explicit !== null && String(explicit).length > 0) {
      return String(explicit);
    }
    const cal = await this.getDefaultCalendar();
    return String(cal.id);
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  async listEvents(options: {
    from: string;
    to: string;
    calendar_id?: number | string;
    timezone?: string;
  }): Promise<ApiResponse<CalendarEvent[]>> {
    const tz = await this.resolveTimeZone(options.timezone);
    const calendarId = await this.resolveCalendarId(options.calendar_id);
    return this.api.call<CalendarEvent[]>('GET', '/1/calendar/pim/event', undefined, {
      calendar_id: calendarId,
      from: toApiDateTime(options.from, tz),
      to: toApiDateTime(options.to, tz, true),
    });
  }

  async getEvent(eventId: number | string): Promise<ApiResponse<CalendarEvent>> {
    return this.api.call<CalendarEvent>('GET', `/1/calendar/pim/event/${encodeURIComponent(String(eventId))}`);
  }

  async createEvent(input: CreateEventInput): Promise<ApiResponse<CalendarEvent>> {
    const tz = await this.resolveTimeZone(input.timezone);
    const calendarId = await this.resolveCalendarId(input.calendar_id);
    const profile = await this.getProfile();

    const body: Record<string, unknown> = {
      title: input.title,
      start: toApiDateTime(input.start, tz),
      end: toApiDateTime(input.end, tz),
      description: input.description ?? '',
      freebusy: input.freebusy ?? 'busy',
      type: 'event',
      calendar_id: calendarId,
      fullday: input.fullday ?? false,
      private: input.private ?? false,
      timezone_start: tz,
      timezone_end: tz,
      attendees: this.buildAttendees(input.attendees, profile),
    };
    if (input.location !== undefined) body.location = input.location;
    if (input.rrule !== undefined) body.rrule = input.rrule;

    return this.api.call<CalendarEvent>('POST', '/1/calendar/pim/event', body);
  }

  async updateEvent(eventId: number | string, input: UpdateEventInput): Promise<ApiResponse<CalendarEvent>> {
    const existing = (await this.getEvent(eventId)).data;
    const profile = await this.getProfile();
    const tz = await this.resolveTimeZone(input.timezone ?? existing.timezone_start ?? undefined);
    const calendarId = String(input.calendar_id ?? existing.calendar_id);

    const attendees =
      input.attendees !== undefined ? this.buildAttendees(input.attendees, profile) : (existing.attendees ?? []);

    const body: Record<string, unknown> = {
      id: Number(eventId),
      calendar_id: calendarId,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description ?? '',
      location: input.location ?? existing.location ?? '',
      start: input.start ? toApiDateTime(input.start, tz) : normalizeApiDate(existing.start),
      end: input.end ? toApiDateTime(input.end, tz) : normalizeApiDate(existing.end),
      timezone_start: tz,
      timezone_end: tz,
      freebusy: input.freebusy ?? existing.freebusy ?? 'busy',
      type: existing.type ?? 'event',
      fullday: input.fullday ?? existing.fullday ?? false,
      private: input.private ?? existing.private ?? false,
      attendees,
      alarms: existing.alarms ?? [],
      attachments: existing.attachments ?? [],
      rrule: input.rrule !== undefined ? input.rrule : (existing.rrule ?? ''),
      meet_room_url: existing.meet_room_url ?? '',
      bookable_resource_id: existing.bookable_resource_id ?? null,
      notifyAttendees: input.notify_attendees ?? false,
      parent_updated: false,
      imip_request: false,
    };

    return this.api.call<CalendarEvent>('PUT', `/1/calendar/pim/event/${encodeURIComponent(String(eventId))}`, body);
  }

  async deleteEvent(eventId: number | string, calendarId?: number | string): Promise<ApiResponse<unknown>> {
    let resolved = calendarId !== undefined ? String(calendarId) : undefined;
    if (!resolved) {
      const existing = (await this.getEvent(eventId)).data;
      resolved = String(existing.calendar_id);
    }
    return this.api.call('DELETE', `/1/calendar/pim/event/${encodeURIComponent(String(eventId))}`, undefined, {
      calendar_id: resolved,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildAttendees(emails: string[] | undefined, profile: CalendarProfile): CalendarAttendee[] {
    if (!emails || emails.length === 0) return [];
    const list: CalendarAttendee[] = emails.map((address) => ({
      address,
      name: address,
      className: 'Attendee',
      organizer: false,
      state: 'NEEDS-ACTION',
    }));
    list.push({
      address: profile.email,
      name: profile.display_name ?? profile.email,
      className: 'Attendee',
      organizer: true,
      state: 'ACCEPTED',
    });
    return list;
  }
}

/** Strip an API returned date (`2025-05-28T12:00:00+02:00` or `... 12:00:00`) to the wall-clock form. */
export function normalizeApiDate(value: string): string {
  return value.replace('T', ' ').replace(/(Z|[+-]\d{2}:?\d{2})$/i, '').slice(0, 19);
}

export default CalendarClient;
