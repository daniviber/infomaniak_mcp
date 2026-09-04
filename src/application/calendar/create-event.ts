import { z } from 'zod';
import type { ToolContract } from '../../domain/tool-contract.js';

const dateTime = z.string().min(10).max(40);
export const createEventInput = z.object({
  title: z.string().min(1).max(500),
  start: dateTime,
  end: dateTime,
  calendar_id: z.union([z.number().int().positive(), z.string().min(1).max(100)]).optional(),
  description: z.string().max(10000).optional(),
  location: z.string().max(1000).optional(),
  attendees: z.array(z.email()).max(100).optional(),
  rrule: z
    .string()
    .max(500)
    .regex(/^$|^FREQ=(SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[^;]+)*$/i)
    .optional(),
  fullday: z.boolean().optional(),
  timezone: z.string().min(1).max(64).optional(),
  freebusy: z.enum(['busy', 'free']).optional(),
  private: z.boolean().optional(),
});

export const createEventOutput = z.object({
  event: z.object({
    id: z.number(),
    calendarId: z.union([z.number(), z.string()]),
    title: z.string(),
    start: z.string(),
    end: z.string(),
  }),
  displayText: z.string(),
});

export type CreateEventCommand = z.infer<typeof createEventInput>;
export interface CalendarPort {
  createEvent(command: CreateEventCommand): Promise<z.infer<typeof createEventOutput>>;
}

export const createEventContract: ToolContract = {
  name: 'infomaniak_calendar_create_event',
  description: 'Create a calendar event',
  inputSchema: createEventInput,
  outputSchema: createEventOutput,
  classification: 'write',
  rawApi: false,
  idempotent: false,
  limits: {
    titleCharacters: 500,
    descriptionCharacters: 10000,
    locationCharacters: 1000,
    attendees: 100,
    recurrenceCharacters: 500,
  },
  experimental: false,
  text: (output) => String(output.displayText),
};

export function createEvent(port: CalendarPort, input: unknown) {
  return port.createEvent(createEventInput.parse(input));
}
