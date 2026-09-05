import type { TrashPage, TrashMutation, EmptyTrash } from '../../domain/drive/trash.js';
import type { PageRequest } from './navigation.port.js';

export interface DriveTrashPort {
  list(driveId: number, options: PageRequest): Promise<TrashPage>;
  restore(driveId: number, fileId: number, destinationDirectoryId?: number): Promise<TrashMutation>;
  permanentDelete(driveId: number, fileId: number): Promise<TrashMutation>;
  empty(driveId: number): Promise<EmptyTrash>;
}
