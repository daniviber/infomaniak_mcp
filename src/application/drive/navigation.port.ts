import type { Drive, DriveItem, ItemPage } from '../../domain/drive/item.js';

export interface PageRequest {
  cursor?: string;
  limit: number;
}

export interface ListItemsOptions extends PageRequest {
  type?: 'file' | 'dir';
  order_by?: 'name' | 'size' | 'last_modified_at' | 'added_at' | 'type';
  order?: 'asc' | 'desc';
}

export interface SearchOptions extends PageRequest {
  directory_id?: number;
  depth?: 'child' | 'unlimited';
  type?: 'file' | 'dir';
  modified_after?: string;
  modified_before?: string;
}

export interface DriveNavigationPort {
  listDrives(accountId: number): Promise<{ drives: Drive[] }>;
  getDrive(driveId: number): Promise<{ drive: Drive }>;
  listItems(driveId: number, directoryId: number, options: ListItemsOptions): Promise<ItemPage>;
  getItem(driveId: number, itemId: number): Promise<{ item: DriveItem }>;
  search(driveId: number, query: string, options: SearchOptions): Promise<ItemPage>;
}
