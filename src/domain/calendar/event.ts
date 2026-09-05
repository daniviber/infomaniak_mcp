import { z } from 'zod';

export const identifier = z.union([z.number().int().positive(), z.string().min(1).max(100)]);
export const attendee = z.object({
  email: z.email(),
  name: z.string(),
  organizer: z.boolean(),
  state: z.enum(['NEEDS-ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE']),
});
export const calendar = z.object({
  id: identifier,
  name: z.string(),
  default: z.boolean().optional(),
  color: z.string().optional(),
});
export const event = z.object({
  id: identifier,
  calendarId: identifier,
  title: z.string(),
  start: z.string(),
  end: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  timezoneStart: z.string().optional(),
  timezoneEnd: z.string().optional(),
  fullday: z.boolean().optional(),
  freebusy: z.enum(['busy', 'free']).optional(),
  private: z.boolean().optional(),
  rrule: z.string().optional(),
  attendees: z.array(attendee).optional(),
});
export type Calendar = z.infer<typeof calendar>;
export type CalendarEvent = z.infer<typeof event>;
export type Identifier = z.infer<typeof identifier>;

export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`Invalid IANA timezone "${timeZone}".`);
  }
}

/** Wall clocks are passed through without resolving DST gaps or overlaps. */
export function toApiDateTime(input: string, timeZone: string, endOfDay = false): string {
  const value = input.trim();
  const wall = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (wall) return `${wall[1]} ${wall[2]}:${wall[3]}:${wall[4] ?? '00'}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value} ${endOfDay ? '23:59:59' : '00:00:00'}`;
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value))
    throw new Error(
      `Invalid date/time "${input}". Use "YYYY-MM-DD HH:mm:ss" (wall-clock in the calendar timezone) or ISO 8601 with an offset.`,
    );
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date/time "${input}".`);
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
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
