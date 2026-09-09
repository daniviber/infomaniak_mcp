import { z } from 'zod';
import {
  calendar,
  task,
  event,
  identifier,
  assertTimeZone,
  toApiDateTime,
} from '../../../domain/calendar/event.js';
import type { Identifier } from '../../../domain/calendar/event.js';
import type {
  CalendarPort,
  CreateEventCommand,
  UpdateEventCommand,
  DeleteEventCommand,
  ListEventsQuery,
  ListTasksQuery,
} from '../../../application/calendar/calendar.port.js';
import type { InfomaniakGateway } from './gateway.js';

// T1: all consumed fields are required with these types.
// due_date:null, raw:null, created_at:null and updated_at:null are unconsumed
// unknown keys. No non-null date type is established or inferred.
const taskDto = z.object({
  id: z.number().int(),
  calendar_id: z.number().int(),
  type: z.literal('todo'),
  title: z.string(),
  description: z.string(),
  location: z.string(),
  private: z.boolean(),
  done: z.boolean(),
  progress: z.number().int(),
  priority: z.number().int(),
  has_attachments: z.boolean(),
});
function mapTask(dto: z.infer<typeof taskDto>) {
  return task.parse({
    id: dto.id,
    calendarId: dto.calendar_id,
    type: dto.type,
    title: dto.title,
    description: dto.description,
    location: dto.location,
    private: dto.private,
    done: dto.done,
    progress: dto.progress,
    priority: dto.priority,
    hasAttachments: dto.has_attachments,
  });
}
const attendeeDto = z.object({
  address: z.email(),
  name: z.string(),
  className: z.literal('Attendee'),
  organizer: z.boolean(),
  state: z.enum(['NEEDS-ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE']),
});
const eventDto = z.object({
  id: identifier,
  calendar_id: identifier,
  title: z.string(),
  start: z.string(),
  end: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  timezone_start: z.string().optional(),
  timezone_end: z.string().optional(),
  fullday: z.boolean().optional(),
  freebusy: z.enum(['busy', 'free']).optional(),
  type: z.string().optional(),
  private: z.boolean().optional(),
  rrule: z.string().optional(),
  attendees: z.array(attendeeDto).optional(),
  alarms: z.array(z.unknown()).optional(),
  attachments: z.array(z.unknown()).optional(),
  meet_room_url: z.string().optional(),
  bookable_resource_id: z.number().nullable().optional(),
});
// Relevé /1/calendar/pim/event: rrule:null, meet_room_url:null.
const readEventDto = eventDto.extend({
  rrule: eventDto.shape.rrule.nullable(),
  meet_room_url: eventDto.shape.meet_room_url.nullable(),
});
// F1, operator observation 2026-09-07: GET /1/calendar/pim/event/{id}
// returns location:null and rrule:null on the detail response.
const eventDetailDto = eventDto.extend({
  location: eventDto.shape.location.nullable(),
  rrule: eventDto.shape.rrule.nullable(),
});
const profileDto = z.object({
  email: z.email(),
  display_name: z.string().optional(),
  preferences: z
    .object({ timezone: z.object({ name: z.string().optional() }).optional() })
    .optional(),
});
const envelope = <T extends z.ZodType>(data: T) => z.object({ result: z.literal('success'), data });
const calendarsDto = z.union([
  z.array(calendar),
  z.object({ calendars: z.array(calendar).optional() }),
]);
const path = ['1', 'calendar', 'pim', 'event'] as const;
function mapEvent(dto: z.infer<typeof readEventDto> | z.infer<typeof eventDetailDto>) {
  return event.parse({
    id: dto.id,
    calendarId: dto.calendar_id,
    title: dto.title,
    start: dto.start,
    end: dto.end,
    description: dto.description,
    ...(dto.location == null ? {} : { location: dto.location }),
    timezoneStart: dto.timezone_start,
    timezoneEnd: dto.timezone_end,
    fullday: dto.fullday,
    freebusy: dto.freebusy,
    private: dto.private,
    ...(dto.rrule == null ? {} : { rrule: dto.rrule }),
    attendees: dto.attendees?.map(({ address, name, organizer, state }) => ({
      email: address,
      name,
      organizer,
      state,
    })),
  });
}
function attendees(
  emails: string[] | undefined,
  profile: z.infer<typeof profileDto>,
): z.infer<typeof attendeeDto>[] {
  if (!emails?.length) return [];
  return [
    ...emails.map((address) => ({
      address,
      name: address,
      className: 'Attendee' as const,
      organizer: false,
      state: 'NEEDS-ACTION' as const,
    })),
    {
      address: profile.email,
      name: profile.display_name ?? profile.email,
      className: 'Attendee',
      organizer: true,
      state: 'ACCEPTED',
    },
  ];
}
const normalizeApiDate = (value: string) =>
  value
    .replace('T', ' ')
    .replace(/(Z|[+-]\d{2}:?\d{2})$/i, '')
    .slice(0, 19);

export class CalendarAdapter implements CalendarPort {
  constructor(private readonly gateway: InfomaniakGateway) {}
  private async profile() {
    return (
      await this.gateway.request(
        { method: 'GET', pathSegments: ['2', 'profile'] },
        envelope(profileDto),
      )
    ).data;
  }
  private async timezone(explicit?: string) {
    const timezone = explicit ?? (await this.profile()).preferences?.timezone?.name ?? 'UTC';
    assertTimeZone(timezone);
    return timezone;
  }
  private async calendarId(explicit?: Identifier) {
    if (explicit !== undefined) return String(explicit);
    const { calendars } = await this.listCalendars();
    const chosen = calendars.find((item) => item.default) ?? calendars[0];
    if (!chosen)
      throw new Error(
        'No calendar found for this token. Check the token scopes (workspace:calendar, user_info).',
      );
    return String(chosen.id);
  }
  async listCalendars() {
    const response = await this.gateway.request(
      { method: 'GET', pathSegments: ['1', 'calendar', 'pim', 'calendar'] },
      envelope(calendarsDto),
    );
    const data = calendarsDto.parse(response.data);
    return { calendars: Array.isArray(data) ? data : (data.calendars ?? []) };
  }
  async listTasks(query: ListTasksQuery) {
    const response = await this.gateway.request(
      {
        method: 'GET',
        pathSegments: ['1', 'calendar', 'pim', 'task'],
        query: { calendar_id: query.calendar_id },
      },
      envelope(z.array(taskDto)),
    );
    return { tasks: response.data.map(mapTask) };
  }
  async listEvents(query: ListEventsQuery) {
    const timezone = await this.timezone(query.timezone);
    const calendar_id = await this.calendarId(query.calendar_id);
    const response = await this.gateway.request(
      {
        method: 'GET',
        pathSegments: path,
        query: {
          calendar_id,
          from: toApiDateTime(query.from, timezone),
          to: toApiDateTime(query.to, timezone, true),
        },
      },
      envelope(z.array(readEventDto)),
    );
    return { events: response.data.map(mapEvent) };
  }
  private async readEvent(id: Identifier) {
    const response = await this.gateway.request(
      { method: 'GET', pathSegments: [...path, id] },
      envelope(eventDetailDto),
    );
    return eventDetailDto.parse(response.data);
  }
  async getEvent(id: Identifier) {
    return { event: mapEvent(await this.readEvent(id)) };
  }
  async createEvent(command: CreateEventCommand) {
    const timezone = await this.timezone(command.timezone);
    const calendar_id = await this.calendarId(command.calendar_id);
    const profile = await this.profile();
    const body = {
      title: command.title,
      start: toApiDateTime(command.start, timezone),
      end: toApiDateTime(command.end, timezone),
      description: command.description ?? '',
      freebusy: command.freebusy ?? 'busy',
      type: 'event',
      calendar_id,
      fullday: command.fullday ?? false,
      private: command.private ?? false,
      timezone_start: timezone,
      timezone_end: timezone,
      attendees: attendees(command.attendees, profile),
      ...(command.location === undefined ? {} : { location: command.location }),
      ...(command.rrule === undefined ? {} : { rrule: command.rrule }),
    };
    const response = await this.gateway.request(
      { method: 'POST', pathSegments: path, body, idempotent: false },
      envelope(eventDto),
    );
    return { event: mapEvent(response.data) };
  }
  async updateEvent(command: UpdateEventCommand) {
    const existing = await this.readEvent(command.event_id);
    const profile = await this.profile();
    const timezone = await this.timezone(command.timezone ?? existing.timezone_start);
    const body = {
      id: command.event_id,
      calendar_id: String(command.calendar_id ?? existing.calendar_id),
      title: command.title ?? existing.title,
      description: command.description ?? existing.description ?? '',
      location: command.location ?? existing.location ?? '',
      start: command.start
        ? toApiDateTime(command.start, timezone)
        : normalizeApiDate(existing.start),
      end: command.end ? toApiDateTime(command.end, timezone) : normalizeApiDate(existing.end),
      timezone_start: timezone,
      timezone_end: timezone,
      freebusy: command.freebusy ?? existing.freebusy ?? 'busy',
      type: existing.type ?? 'event',
      fullday: command.fullday ?? existing.fullday ?? false,
      private: command.private ?? existing.private ?? false,
      attendees:
        command.attendees !== undefined
          ? attendees(command.attendees, profile)
          : (existing.attendees ?? []),
      alarms: existing.alarms ?? [],
      attachments: existing.attachments ?? [],
      rrule: command.rrule ?? existing.rrule ?? '',
      meet_room_url: existing.meet_room_url ?? '',
      bookable_resource_id: existing.bookable_resource_id ?? null,
      notifyAttendees: command.notify_attendees ?? false,
      parent_updated: false,
      imip_request: false,
    };
    const response = await this.gateway.request(
      { method: 'PUT', pathSegments: [...path, command.event_id], body, idempotent: false },
      envelope(eventDto),
    );
    return { event: mapEvent(response.data) };
  }
  async deleteEvent(command: DeleteEventCommand) {
    const calendar_id = String(
      command.calendar_id ?? (await this.readEvent(command.event_id)).calendar_id,
    );
    await this.gateway.request(
      {
        method: 'DELETE',
        pathSegments: [...path, command.event_id],
        query: { calendar_id },
        idempotent: false,
      },
      envelope(z.unknown()),
    );
    return { deleted: true, eventId: command.event_id };
  }
}
