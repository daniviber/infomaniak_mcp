import * as drive from '../positive/a-drive.feature.js';
import * as calendar from '../positive/z-calendar.feature.js';
export const tools = [...drive.tools, ...calendar.tools];
export function createHandlers(
  deps: Parameters<typeof drive.createHandlers>[0] & Parameters<typeof calendar.createHandlers>[0],
) {
  return { ...drive.createHandlers(deps), ...calendar.createHandlers(deps) };
}
