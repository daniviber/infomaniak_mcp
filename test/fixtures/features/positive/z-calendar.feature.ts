import {
  createEvent,
  createEventContract,
} from '../../../../src/application/calendar/create-event.js';
import { CalendarCreateAdapter } from '../../../../src/adapters/outbound/infomaniak/calendar-create.adapter.js';
import type { InfomaniakGateway } from '../../../../src/adapters/outbound/infomaniak/gateway.js';

export const tools = [createEventContract] as const;
export function createHandlers(deps: {
  config: { calendarToken: string };
  createGateway(options: { token: string; base?: string }): InfomaniakGateway;
}) {
  const adapter = new CalendarCreateAdapter(
    deps.createGateway({ token: deps.config.calendarToken }),
  );
  return { [createEventContract.name]: (input: unknown) => createEvent(adapter, input) };
}
