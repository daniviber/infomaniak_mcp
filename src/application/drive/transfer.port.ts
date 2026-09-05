import type {
  Download,
  Mutation,
  TransferredItem,
  UploadInput,
} from '../../domain/drive/transfer.js';

export interface DriveTransferPort {
  download(
    driveId: number,
    fileId: number,
    encoding: 'auto' | 'utf-8' | 'base64',
    maxBytes: number,
  ): Promise<Download>;
  upload(input: UploadInput, maxBytes: number): Promise<TransferredItem>;
  mkdir(
    driveId: number,
    name: string,
    parentId: number,
    onlyForMe: boolean,
  ): Promise<TransferredItem>;
  move(driveId: number, fileId: number, destinationDirectoryId: number): Promise<Mutation>;
  copy(driveId: number, fileId: number, destinationDirectoryId: number): Promise<TransferredItem>;
  rename(driveId: number, fileId: number, name: string): Promise<Mutation>;
  trash(driveId: number, fileId: number): Promise<Mutation>;
}
