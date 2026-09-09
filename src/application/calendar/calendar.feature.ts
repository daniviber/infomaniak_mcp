import { z } from 'zod';
import {
  calendar,
  task,
  event,
  identifier,
  toApiDateTime,
  assertTimeZone,
} from '../../domain/calendar/event.js';
import type { ToolContract } from '../../domain/tool-contract.js';
import type { CalendarPort } from './calendar.port.js';
import { createFeatureModule } from '../feature-module.js';

const dateTime = z
  .string()
  .min(10)
  .max(40)
  .superRefine((value) => {
    // Preserve the baseline error verbatim instead of wrapping it in a Zod issue.
    toApiDateTime(value, 'UTC');
  });
const timezone = z
  .string()
  .min(1)
  .max(64)
  .superRefine((value, context) => {
    try {
      assertTimeZone(value);
    } catch (error) {
      context.addIssue({ code: 'custom', message: (error as Error).message });
    }
  })
  .optional();
const createInput = z.object({
  title: z.string().min(1).max(500),
  start: dateTime,
  end: dateTime,
  calendar_id: identifier.optional(),
  description: z.string().max(10000).optional(),
  location: z.string().max(1000).optional(),
  attendees: z.array(z.email()).max(100).optional(),
  rrule: z
    .string()
    .max(500)
    .regex(/^$|^FREQ=(SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[^;]+)*$/i)
    .optional(),
  fullday: z.boolean().optional(),
  timezone,
  freebusy: z.enum(['busy', 'free']).optional(),
  private: z.boolean().optional(),
});
const listInput = z.object({
  from: dateTime,
  to: dateTime,
  calendar_id: identifier.optional(),
  timezone,
});
const listTasksInput = z.object({ calendar_id: z.number().int() });
const getInput = z.object({ event_id: identifier });
const updateInput = createInput
  .partial()
  .extend({ event_id: identifier, notify_attendees: z.boolean().optional() });
const deleteInput = getInput.extend({ calendar_id: identifier.optional() });
const eventOutput = z.object({ event });
const writeLimits = {
  titleCharacters: 500,
  descriptionCharacters: 10000,
  locationCharacters: 1000,
  attendees: 100,
  recurrenceCharacters: 500,
};
function contract(
  name: string,
  description: string,
  inputSchema: z.ZodObject,
  outputSchema: z.ZodObject,
  classification: ToolContract['classification'],
): ToolContract {
  return {
    name: `infomaniak_calendar_${name}`,
    description,
    inputSchema,
    outputSchema,
    classification,
    rawApi: false,
    experimental: false,
    idempotent: classification === 'read',
    limits: classification === 'write' ? writeLimits : {},
    text: (output) => JSON.stringify(output, null, 2),
  };
}
export const tools = [
  contract(
    'list_calendars',
    'List calendars of the configured mailbox owner',
    z.object({}),
    z.object({ calendars: z.array(calendar) }),
    'read',
  ),
  contract(
    'list_events',
    'List events in a date range; a date alone covers the whole day',
    listInput,
    z.object({ events: z.array(event) }),
    'read',
  ),
  contract('get_event', 'Get a calendar event', getInput, eventOutput, 'read'),
  contract('create_event', 'Create a calendar event', createInput, eventOutput, 'write'),
  contract(
    'update_event',
    'Update provided calendar event fields',
    updateInput,
    eventOutput,
    'write',
  ),
  contract(
    'delete_event',
    'Delete a calendar event',
    deleteInput,
    z.object({ deleted: z.boolean(), eventId: identifier }),
    'destructive',
  ),
  contract(
    'list_tasks',
    'List tasks of the specified calendar without due dates',
    listTasksInput,
    z.object({ tasks: z.array(task) }),
    'read',
  ),
] as const;

export function createCalendarHandlers(port: CalendarPort) {
  return {
    infomaniak_calendar_list_tasks: (input: unknown) => port.listTasks(listTasksInput.parse(input)),
    infomaniak_calendar_list_calendars: async (input: unknown) => {
      tools[0].inputSchema.parse(input);
      return port.listCalendars();
    },
    infomaniak_calendar_list_events: (input: unknown) => port.listEvents(listInput.parse(input)),
    infomaniak_calendar_get_event: (input: unknown) =>
      port.getEvent(getInput.parse(input).event_id),
    infomaniak_calendar_create_event: (input: unknown) =>
      port.createEvent(createInput.parse(input)),
    infomaniak_calendar_update_event: (input: unknown) =>
      port.updateEvent(updateInput.parse(input)),
    infomaniak_calendar_delete_event: (input: unknown) =>
      port.deleteEvent(deleteInput.parse(input)),
  };
}
export function createCalendarFeature(port: CalendarPort) {
  const handlers = createCalendarHandlers(port);
  return createFeatureModule(
    tools.map((contract) => ({
      contract,
      handle: handlers[contract.name as keyof typeof handlers],
    })),
  );
}
