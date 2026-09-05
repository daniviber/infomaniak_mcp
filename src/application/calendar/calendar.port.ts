import type { Calendar, CalendarEvent, Identifier } from '../../domain/calendar/event.js';

export interface ListEventsQuery {
  from: string;
  to: string;
  calendar_id?: Identifier;
  timezone?: string;
}
export interface CreateEventCommand {
  title: string;
  start: string;
  end: string;
  calendar_id?: Identifier;
  description?: string;
  location?: string;
  attendees?: string[];
  rrule?: string;
  fullday?: boolean;
  timezone?: string;
  freebusy?: 'busy' | 'free';
  private?: boolean;
}
export interface UpdateEventCommand extends Partial<CreateEventCommand> {
  event_id: Identifier;
  notify_attendees?: boolean;
}
export interface DeleteEventCommand {
  event_id: Identifier;
  calendar_id?: Identifier;
}
export interface CalendarPort {
  listCalendars(): Promise<{ calendars: Calendar[] }>;
  listEvents(query: ListEventsQuery): Promise<{ events: CalendarEvent[] }>;
  getEvent(id: Identifier): Promise<{ event: CalendarEvent }>;
  createEvent(command: CreateEventCommand): Promise<{ event: CalendarEvent }>;
  updateEvent(command: UpdateEventCommand): Promise<{ event: CalendarEvent }>;
  deleteEvent(command: DeleteEventCommand): Promise<{ deleted: boolean; eventId: Identifier }>;
}
