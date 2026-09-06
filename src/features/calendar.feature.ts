import { createCalendarHandlers } from '../application/calendar/calendar.feature.js';
import { CalendarAdapter } from '../adapters/outbound/infomaniak/calendar.adapter.js';
import type { InfomaniakGateway } from '../adapters/outbound/infomaniak/gateway.js';

export { tools } from '../application/calendar/calendar.feature.js';
export function createHandlers(deps: {
  gateway: InfomaniakGateway;
  config: { token: string; calendarToken: string };
  createGateway(options: { token: string; base?: string }): InfomaniakGateway;
}) {
  const gateway =
    deps.config.calendarToken === deps.config.token
      ? deps.gateway
      : deps.createGateway({ token: deps.config.calendarToken });
  return createCalendarHandlers(new CalendarAdapter(gateway));
}
