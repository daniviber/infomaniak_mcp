import { z } from 'zod';
import type {
  CalendarPort,
  CreateEventCommand,
} from '../../../application/calendar/create-event.js';
import type { InfomaniakGateway } from './gateway.js';

const profileDto = z.looseObject({
  result: z.string(),
  data: z.looseObject({
    email: z.string(),
    display_name: z.string().optional(),
    preferences: z
      .object({ timezone: z.object({ name: z.string().optional() }).optional() })
      .optional(),
  }),
});
const calendarDto = z.looseObject({
  id: z.union([z.number(), z.string()]),
  default: z.boolean().optional(),
});
const calendarsDto = z.looseObject({
  result: z.string(),
  data: z.union([z.array(calendarDto), z.object({ calendars: z.array(calendarDto).optional() })]),
});
const eventDto = z.looseObject({
  result: z.string(),
  data: z.looseObject({
    id: z.number(),
    calendar_id: z.union([z.number(), z.string()]),
    title: z.string(),
    start: z.string(),
    end: z.string(),
  }),
});

function toApiDateTime(input: string, timezone: string): string {
  const value = input.trim();
  const wall = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (wall) return `${wall[1]} ${wall[2]}:${wall[3]}:${wall[4] ?? '00'}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value} 00:00:00`;
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) throw new Error('Invalid date/time');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date/time');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

export class CalendarCreateAdapter implements CalendarPort {
  constructor(private readonly gateway: InfomaniakGateway) {}

  async createEvent(command: CreateEventCommand) {
    const profile = (
      await this.gateway.request({ method: 'GET', pathSegments: ['2', 'profile'] }, profileDto)
    ).data;
    const timezone = command.timezone ?? profile.preferences?.timezone?.name ?? 'UTC';
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    let calendarId = command.calendar_id;
    if (calendarId === undefined) {
      const data = (
        await this.gateway.request(
          { method: 'GET', pathSegments: ['1', 'calendar', 'pim', 'calendar'] },
          calendarsDto,
        )
      ).data;
      const calendars = Array.isArray(data) ? data : (data.calendars ?? []);
      calendarId = (calendars.find((calendar) => calendar.default) ?? calendars[0])?.id;
      if (calendarId === undefined)
        throw new Error(
          'No calendar found for this token. Check the token scopes (workspace:calendar, user_info).',
        );
    }
    const attendees: Record<string, unknown>[] = (command.attendees ?? []).map((address) => ({
      address,
      name: address,
      className: 'Attendee',
      organizer: false,
      state: 'NEEDS-ACTION',
    }));
    if (attendees.length)
      attendees.push({
        address: profile.email,
        name: profile.display_name ?? profile.email,
        className: 'Attendee',
        organizer: true,
        state: 'ACCEPTED',
      });
    const body = {
      title: command.title,
      start: toApiDateTime(command.start, timezone),
      end: toApiDateTime(command.end, timezone),
      description: command.description ?? '',
      freebusy: command.freebusy ?? 'busy',
      type: 'event',
      calendar_id: String(calendarId),
      fullday: command.fullday ?? false,
      private: command.private ?? false,
      timezone_start: timezone,
      timezone_end: timezone,
      attendees,
      ...(command.location === undefined ? {} : { location: command.location }),
      ...(command.rrule === undefined ? {} : { rrule: command.rrule }),
    };
    const response = await this.gateway.request(
      { method: 'POST', pathSegments: ['1', 'calendar', 'pim', 'event'], body, idempotent: false },
      eventDto,
    );
    return {
      event: {
        id: response.data.id,
        calendarId: response.data.calendar_id,
        title: response.data.title,
        start: response.data.start,
        end: response.data.end,
      },
      displayText: JSON.stringify(response, null, 2),
    };
  }
}
