/**
 * Calendar tools (Infomaniak kSuite Calendar).
 *
 * The calendar API is user scoped: the configured token gives access to the
 * calendars of the user who created it. To work on the calendar of a given
 * mailbox, create the token while logged in as that mailbox's user with the
 * scopes `workspace:calendar` and `user_info` and set INFOMANIAK_CALENDAR_TOKEN.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { CalendarClient } from "../calendar-client.js";
import {
  validate,
  CalendarListEventsSchema,
  CalendarEventIdSchema,
  CalendarCreateEventSchema,
  CalendarUpdateEventSchema,
  CalendarDeleteEventSchema,
} from "../schemas.js";
import type { ToolArgs, ToolModule } from "./module.js";

const DATE_HINT = "Format: 'YYYY-MM-DD HH:mm:ss' (wall-clock time in the calendar timezone) or ISO 8601 with offset (e.g. 2025-05-28T12:00:00+02:00)";

const calendarId = {
  type: ["number", "string"],
  description: "Calendar ID (see infomaniak_calendar_list_calendars). Defaults to the user's default calendar.",
};
const timezone = { type: "string", description: "IANA timezone for interpreting start/end (default: the user's profile timezone, e.g. Europe/Zurich)" };
const eventId = { type: ["number", "string"], description: "The event ID" };

export const calendarTools: Tool[] = [
  {
    name: "infomaniak_calendar_list_calendars",
    description: "List the calendars of the configured calendar user (the mailbox owner). Returns ids, names and which one is the default.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "infomaniak_calendar_list_events",
    description: `List calendar events between two dates. ${DATE_HINT}. A date alone (YYYY-MM-DD) covers the whole day.`,
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: `Range start. ${DATE_HINT}` },
        to: { type: "string", description: `Range end (inclusive). ${DATE_HINT}` },
        calendar_id: calendarId,
        timezone,
      },
      required: ["from", "to"],
    },
  },
  {
    name: "infomaniak_calendar_get_event",
    description: "Get the full details of one calendar event",
    inputSchema: { type: "object", properties: { event_id: eventId }, required: ["event_id"] },
  },
  {
    name: "infomaniak_calendar_create_event",
    description: `Create a calendar event. ${DATE_HINT}.`,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        start: { type: "string", description: `Start. ${DATE_HINT}` },
        end: { type: "string", description: `End. ${DATE_HINT}` },
        calendar_id: calendarId,
        description: { type: "string", description: "Event description" },
        location: { type: "string", description: "Event location" },
        attendees: { type: "array", items: { type: "string" }, description: "Attendee e-mail addresses (the organizer is added automatically)" },
        rrule: { type: "string", description: "Recurrence rule (RFC 5545), e.g. FREQ=WEEKLY;BYDAY=MO or FREQ=MONTHLY;BYMONTHDAY=15" },
        fullday: { type: "boolean", description: "All-day event (default: false)" },
        timezone,
        freebusy: { type: "string", enum: ["busy", "free"], description: "Show as busy or free (default: busy)" },
        private: { type: "boolean", description: "Private event (default: false)" },
      },
      required: ["title", "start", "end"],
    },
  },
  {
    name: "infomaniak_calendar_update_event",
    description: `Update an existing calendar event. Only the provided fields change. ${DATE_HINT}.`,
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventId,
        title: { type: "string" },
        start: { type: "string", description: `New start. ${DATE_HINT}` },
        end: { type: "string", description: `New end. ${DATE_HINT}` },
        calendar_id: { type: ["number", "string"], description: "Move the event to this calendar" },
        description: { type: "string" },
        location: { type: "string" },
        attendees: { type: "array", items: { type: "string" }, description: "Replace the attendee list (e-mail addresses)" },
        rrule: { type: "string", description: "Recurrence rule (RFC 5545). Empty string removes the recurrence." },
        fullday: { type: "boolean" },
        timezone,
        freebusy: { type: "string", enum: ["busy", "free"] },
        private: { type: "boolean" },
        notify_attendees: { type: "boolean", description: "Send update notifications to attendees (default: false)" },
      },
      required: ["event_id"],
    },
  },
  {
    name: "infomaniak_calendar_delete_event",
    description: "Delete a calendar event",
    inputSchema: {
      type: "object",
      properties: { event_id: eventId, calendar_id: { type: ["number", "string"], description: "Calendar of the event (default: looked up from the event)" } },
      required: ["event_id"],
    },
  },
];

export function createCalendarToolModule(calendar: CalendarClient): ToolModule {
  const names = new Set(calendarTools.map((t) => t.name));

  async function handle(name: string, args: ToolArgs): Promise<unknown> {
    switch (name) {
      case "infomaniak_calendar_list_calendars":
        return calendar.listCalendars();

      case "infomaniak_calendar_list_events": {
        const v = validate(CalendarListEventsSchema, args);
        return calendar.listEvents(v);
      }
      case "infomaniak_calendar_get_event": {
        const v = validate(CalendarEventIdSchema, args);
        return calendar.getEvent(v.event_id);
      }
      case "infomaniak_calendar_create_event": {
        const v = validate(CalendarCreateEventSchema, args);
        return calendar.createEvent(v);
      }
      case "infomaniak_calendar_update_event": {
        const v = validate(CalendarUpdateEventSchema, args);
        const { event_id, ...changes } = v;
        return calendar.updateEvent(event_id, changes);
      }
      case "infomaniak_calendar_delete_event": {
        const v = validate(CalendarDeleteEventSchema, args);
        return calendar.deleteEvent(v.event_id, v.calendar_id);
      }
      default:
        throw new Error(`Unknown calendar tool: ${name}`);
    }
  }

  return { tools: calendarTools, canHandle: (name) => names.has(name), handle };
}
