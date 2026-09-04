import {
  listDrives,
  listDrivesContract,
  type DrivePort,
} from '../application/drive/list-drives.js';
import {
  createEvent,
  createEventContract,
  type CalendarPort,
} from '../application/calendar/create-event.js';

export interface WalkingSkeletonPorts {
  drive: DrivePort;
  calendar: CalendarPort;
}

export const tools = [listDrivesContract, createEventContract] as const;
export const handlers = {
  [listDrivesContract.name]: (ports: WalkingSkeletonPorts, input: unknown) =>
    listDrives(ports.drive, input),
  [createEventContract.name]: (ports: WalkingSkeletonPorts, input: unknown) =>
    createEvent(ports.calendar, input),
};
