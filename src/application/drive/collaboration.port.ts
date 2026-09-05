import type {
  Access,
  ShareLink,
  Acknowledgement,
  ActivityPage,
} from '../../domain/drive/collaboration.js';
import type { ItemPage } from '../../domain/drive/item.js';
import type { PageRequest } from './navigation.port.js';

export interface ShareLinkOptions {
  right: 'public' | 'password' | 'inherit';
  password?: string;
  valid_until?: number;
  can_download?: boolean;
  can_edit?: boolean;
  can_see_stats?: boolean;
}
export interface InvitationOptions {
  emails: string[];
  right: 'read' | 'write' | 'manage';
  message?: string;
  lang?: 'fr' | 'en' | 'de' | 'it' | 'es';
}
export interface CollaborationPageRequest extends PageRequest {
  type?: 'file' | 'dir';
}
export interface DriveCollaborationPort {
  getShareLink(driveId: number, fileId: number): Promise<{ link: ShareLink }>;
  createShareLink(
    driveId: number,
    fileId: number,
    options: ShareLinkOptions,
  ): Promise<{ link: ShareLink }>;
  updateShareLink(
    driveId: number,
    fileId: number,
    options: Partial<ShareLinkOptions>,
  ): Promise<Acknowledgement>;
  deleteShareLink(driveId: number, fileId: number): Promise<Acknowledgement>;
  listAccess(driveId: number, fileId: number): Promise<{ access: Access[] }>;
  inviteAccess(
    driveId: number,
    fileId: number,
    options: InvitationOptions,
  ): Promise<{ invitations: Access[] }>;
  listFavorites(driveId: number, options: PageRequest): Promise<ItemPage>;
  addFavorite(driveId: number, fileId: number): Promise<Acknowledgement>;
  removeFavorite(driveId: number, fileId: number): Promise<Acknowledgement>;
  recents(driveId: number, options: CollaborationPageRequest): Promise<ItemPage>;
  sharedWithMe(driveId: number, options: CollaborationPageRequest): Promise<ItemPage>;
  activity(
    driveId: number,
    fileId: number | undefined,
    options: PageRequest,
  ): Promise<ActivityPage>;
}
