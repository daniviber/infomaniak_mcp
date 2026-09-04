/**
 * kDrive tools: browse, search, upload/download, organise, share and recover files.
 *
 * Endpoints are implemented in InfomaniakClient (src/infomaniak-client.ts) and follow
 * Infomaniak's official `mcp-server-kdrive` and the open-source kDrive Android app.
 * The root directory of a drive always has id 1.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { InfomaniakClient, KDRIVE_ROOT_DIRECTORY_ID } from "../infomaniak-client.js";
import {
  validate,
  AccountIdSchema,
  DriveIdSchema,
  KDriveFileIdSchema,
  KDriveListFilesSchema,
  KDriveSearchSchema,
  KDriveCreateDirectorySchema,
  MoveOrCopyKDriveFileSchema,
  RenameKDriveFileSchema,
  KDriveUploadSchema,
  KDriveDownloadSchema,
  KDriveCreateShareLinkSchema,
  KDriveUpdateShareLinkSchema,
  KDriveInviteAccessSchema,
  KDriveCursorSchema,
  KDriveRestoreSchema,
  KDriveTypeFilterSchema,
  KDriveActivitySchema,
} from "../schemas.js";
import type { ToolArgs, ToolModule } from "./module.js";

export interface KDriveToolOptions {
  /** Maximum size accepted by infomaniak_download_kdrive_file (bytes). Default 10 MiB. */
  maxDownloadBytes?: number;
  /** Maximum size accepted by infomaniak_upload_kdrive_file (bytes). Default 50 MiB. */
  maxUploadBytes?: number;
}

export const DEFAULT_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const driveId = { type: "number", description: "The kDrive ID (from infomaniak_list_kdrives, or the number in the kDrive web URL)" };
const fileId = { type: "number", description: "The file or directory ID" };
const cursor = { type: "string", description: "Pagination cursor returned by a previous call when has_more was true" };
const limit = { type: "number", description: "Page size (1-200)" };
const typeFilter = { type: "string", enum: ["file", "dir"], description: "Only return files, or only directories" };

export const kdriveTools: Tool[] = [
  {
    name: "infomaniak_list_kdrives",
    description: "List all kDrives of an account",
    inputSchema: { type: "object", properties: { account_id: { type: "number", description: "The account ID" } }, required: ["account_id"] },
  },
  {
    name: "infomaniak_get_kdrive",
    description: "Get details (name, quota, usage) of a kDrive",
    inputSchema: { type: "object", properties: { drive_id: driveId }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_list_kdrive_files",
    description:
      "List the files and directories inside a kDrive directory (root directory id = 1). Paginated: pass back `cursor` while `has_more` is true.",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: driveId,
        directory_id: { type: "number", description: "Directory to list (default: 1 = root)" },
        type: typeFilter,
        cursor,
        limit,
        order_by: { type: "string", enum: ["name", "size", "last_modified_at", "added_at", "type"], description: "Sort field" },
        order: { type: "string", enum: ["asc", "desc"], description: "Sort direction" },
      },
      required: ["drive_id"],
    },
  },
  {
    name: "infomaniak_get_kdrive_file",
    description: "Get metadata of a file or directory (name, path, size, mime type, sharing state, capabilities)",
    inputSchema: { type: "object", properties: { drive_id: driveId, file_id: fileId }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_search_kdrive_files",
    description:
      "Search files and directories by name in a kDrive. Optionally scope to a directory subtree (directory_id + depth) or a modification date range.",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: driveId,
        query: { type: "string", description: "Text to search in file names" },
        directory_id: { type: "number", description: "Restrict the search to this directory" },
        depth: { type: "string", enum: ["child", "unlimited"], description: "With directory_id: 'child' = direct children only, 'unlimited' = whole subtree" },
        type: typeFilter,
        modified_after: { type: "string", description: "Only items modified after this date (YYYY-MM-DD or unix timestamp)" },
        modified_before: { type: "string", description: "Only items modified before this date (YYYY-MM-DD or unix timestamp)" },
        cursor,
        limit,
      },
      required: ["drive_id", "query"],
    },
  },
  {
    name: "infomaniak_download_kdrive_file",
    description:
      "Download a file and return its content. Text files are returned as UTF-8 text, other files as base64 (encoding field tells which). Size limited by the server configuration.",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: driveId,
        file_id: fileId,
        encoding: { type: "string", enum: ["auto", "utf-8", "base64"], description: "Force the returned encoding (default: auto-detect)" },
      },
      required: ["drive_id", "file_id"],
    },
  },
  {
    name: "infomaniak_upload_kdrive_file",
    description:
      "Upload a new file into a kDrive directory. Provide exactly one of text_content (UTF-8 text) or base64_content (binary). Files cannot be created directly in the root: use a directory such as 'Common documents' or 'Private'.",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: driveId,
        file_name: { type: "string", description: "Name of the file to create (no path separators)" },
        directory_id: { type: "number", description: "Destination directory ID (default: 1 = root)" },
        text_content: { type: "string", description: "UTF-8 text content. Mutually exclusive with base64_content." },
        base64_content: { type: "string", description: "Base64-encoded binary content. Mutually exclusive with text_content." },
        conflict: { type: "string", enum: ["error", "rename", "version"], description: "Behaviour when a file with the same name exists (default: rename)" },
        directory_path: { type: "string", description: "Optional sub-folder path (relative to directory_id) created automatically" },
        last_modified_at: { type: "number", description: "Unix timestamp (seconds) to set as modification date" },
      },
      required: ["drive_id", "file_name"],
    },
  },
  {
    name: "infomaniak_create_kdrive_directory",
    description: "Create a directory in a kDrive",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: driveId,
        name: { type: "string", description: "Directory name" },
        parent_id: { type: "number", description: "Parent directory ID (default: 1 = root)" },
        only_for_me: { type: "boolean", description: "Create a private directory (default: false)" },
      },
      required: ["drive_id", "name"],
    },
  },
  {
    name: "infomaniak_move_kdrive_file",
    description: "Move a file or directory into another directory",
    inputSchema: {
      type: "object",
      properties: { drive_id: driveId, file_id: fileId, destination_directory_id: { type: "number", description: "Target directory ID" } },
      required: ["drive_id", "file_id", "destination_directory_id"],
    },
  },
  {
    name: "infomaniak_copy_kdrive_file",
    description: "Copy (duplicate) a file or directory into another directory",
    inputSchema: {
      type: "object",
      properties: { drive_id: driveId, file_id: fileId, destination_directory_id: { type: "number", description: "Target directory ID" } },
      required: ["drive_id", "file_id", "destination_directory_id"],
    },
  },
  {
    name: "infomaniak_rename_kdrive_file",
    description: "Rename a file or directory",
    inputSchema: {
      type: "object",
      properties: { drive_id: driveId, file_id: fileId, name: { type: "string", description: "New name" } },
      required: ["drive_id", "file_id", "name"],
    },
  },
  {
    name: "infomaniak_delete_kdrive_file",
    description: "Move a file or directory to the kDrive trash (recoverable with infomaniak_restore_kdrive_file)",
    inputSchema: { type: "object", properties: { drive_id: driveId, file_id: fileId }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_get_kdrive_share_link",
    description: "Get the public share link of a file or directory, if any",
    inputSchema: { type: "object", properties: { drive_id: driveId, file_id: fileId }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_share_kdrive_file",
    description: "Create a public share link for a file or directory",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: driveId,
        file_id: fileId,
        right: { type: "string", enum: ["public", "password", "inherit"], description: "Link access level" },
        password: { type: "string", description: "Required when right is 'password'" },
        valid_until: { type: "number", description: "Expiration as unix timestamp (seconds)" },
        can_download: { type: "boolean", description: "Allow download through the link" },
        can_edit: { type: "boolean", description: "Allow editing through the link" },
        can_see_stats: { type: "boolean", description: "Show statistics to link visitors" },
      },
      required: ["drive_id", "file_id", "right"],
    },
  },
  {
    name: "infomaniak_update_kdrive_share_link",
    description: "Update the settings of an existing share link",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: driveId,
        file_id: fileId,
        right: { type: "string", enum: ["public", "password", "inherit"] },
        password: { type: "string" },
        valid_until: { type: "number", description: "Expiration as unix timestamp (seconds)" },
        can_download: { type: "boolean" },
        can_edit: { type: "boolean" },
        can_see_stats: { type: "boolean" },
      },
      required: ["drive_id", "file_id"],
    },
  },
  {
    name: "infomaniak_delete_kdrive_share_link",
    description: "Remove the public share link of a file or directory",
    inputSchema: { type: "object", properties: { drive_id: driveId, file_id: fileId }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_list_kdrive_file_access",
    description: "List users, teams and invitations that have access to a file or directory",
    inputSchema: { type: "object", properties: { drive_id: driveId, file_id: fileId }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_invite_kdrive_access",
    description: "Share a file or directory with people by e-mail invitation",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: driveId,
        file_id: fileId,
        emails: { type: "array", items: { type: "string" }, description: "Recipient e-mail addresses" },
        right: { type: "string", enum: ["read", "write", "manage"], description: "Access level granted" },
        message: { type: "string", description: "Optional message included in the invitation" },
        lang: { type: "string", enum: ["fr", "en", "de", "it", "es"], description: "Language of the invitation e-mail (default: en)" },
      },
      required: ["drive_id", "file_id", "emails", "right"],
    },
  },
  {
    name: "infomaniak_list_kdrive_trash",
    description: "List the items in the kDrive trash",
    inputSchema: { type: "object", properties: { drive_id: driveId, cursor, limit }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_restore_kdrive_file",
    description: "Restore a trashed file or directory, optionally into a different directory",
    inputSchema: {
      type: "object",
      properties: { drive_id: driveId, file_id: fileId, destination_directory_id: { type: "number", description: "Directory to restore into (default: original location)" } },
      required: ["drive_id", "file_id"],
    },
  },
  {
    name: "infomaniak_delete_kdrive_trashed_file_permanently",
    description: "PERMANENTLY delete one item from the trash. This cannot be undone.",
    inputSchema: { type: "object", properties: { drive_id: driveId, file_id: fileId }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_empty_kdrive_trash",
    description: "PERMANENTLY delete everything in the kDrive trash. This cannot be undone.",
    inputSchema: { type: "object", properties: { drive_id: driveId }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_list_kdrive_favorites",
    description: "List favourite files and directories",
    inputSchema: { type: "object", properties: { drive_id: driveId, cursor, limit }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_add_kdrive_favorite",
    description: "Add a file or directory to favourites",
    inputSchema: { type: "object", properties: { drive_id: driveId, file_id: fileId }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_remove_kdrive_favorite",
    description: "Remove a file or directory from favourites",
    inputSchema: { type: "object", properties: { drive_id: driveId, file_id: fileId }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_list_kdrive_recents",
    description: "List recently used files and directories",
    inputSchema: { type: "object", properties: { drive_id: driveId, type: typeFilter }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_list_kdrive_shared_with_me",
    description: "List files and directories shared with the token owner",
    inputSchema: { type: "object", properties: { drive_id: driveId, type: typeFilter }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_get_kdrive_activity",
    description: "Get the activity log of a kDrive, or of one file/directory",
    inputSchema: {
      type: "object",
      properties: { drive_id: driveId, file_id: { type: "number", description: "Optional: restrict to this file or directory" }, cursor, limit },
      required: ["drive_id"],
    },
  },
];

const TEXT_MIME_RE = /^text\/|[/+](?:json|xml|yaml|javascript|csv)$|^application\/(?:x-)?(?:sh|sql|toml|ini|yaml|ecmascript)$/i;

function looksLikeText(mime: string, bytes: Uint8Array): boolean {
  if (TEXT_MIME_RE.test(mime)) return true;
  if (mime !== "application/octet-stream") return false;
  const sample = bytes.byteLength <= 1024 * 1024 ? bytes : bytes.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

export function createKDriveToolModule(client: InfomaniakClient, options: KDriveToolOptions = {}): ToolModule {
  const maxDownloadBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const names = new Set(kdriveTools.map((t) => t.name));

  async function handle(name: string, args: ToolArgs): Promise<unknown> {
    switch (name) {
      case "infomaniak_list_kdrives": {
        const v = validate(AccountIdSchema, args);
        return client.getKDrives(v.account_id);
      }
      case "infomaniak_get_kdrive": {
        const v = validate(DriveIdSchema, args);
        return client.getKDrive(v.drive_id);
      }
      case "infomaniak_list_kdrive_files": {
        const v = validate(KDriveListFilesSchema, args);
        return client.listKDriveFiles(v.drive_id, v.directory_id ?? KDRIVE_ROOT_DIRECTORY_ID, {
          type: v.type,
          cursor: v.cursor,
          limit: v.limit,
          order_by: v.order_by,
          order: v.order,
        });
      }
      case "infomaniak_get_kdrive_file": {
        const v = validate(KDriveFileIdSchema, args);
        return client.getKDriveFile(v.drive_id, v.file_id);
      }
      case "infomaniak_search_kdrive_files": {
        const v = validate(KDriveSearchSchema, args);
        return client.searchKDriveFiles(v.drive_id, v.query, {
          directory_id: v.directory_id,
          depth: v.depth,
          type: v.type,
          modified_after: v.modified_after,
          modified_before: v.modified_before,
          cursor: v.cursor,
          limit: v.limit,
        });
      }
      case "infomaniak_download_kdrive_file": {
        const v = validate(KDriveDownloadSchema, args);
        const res = await client.downloadKDriveFile(v.drive_id, v.file_id, maxDownloadBytes);
        const mime = (res.contentType ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
        const asText = v.encoding === "utf-8" || (v.encoding !== "base64" && looksLikeText(mime, res.bytes));
        return {
          file_id: v.file_id,
          file_name: res.fileName ?? null,
          mime_type: mime,
          size: res.bytes.byteLength,
          encoding: asText ? "utf-8" : "base64",
          content: asText ? new TextDecoder("utf-8").decode(res.bytes) : Buffer.from(res.bytes).toString("base64"),
        };
      }
      case "infomaniak_upload_kdrive_file": {
        const v = validate(KDriveUploadSchema, args);
        const buffer =
          v.text_content !== undefined ? Buffer.from(v.text_content, "utf-8") : Buffer.from(v.base64_content ?? "", "base64");
        if (buffer.byteLength > maxUploadBytes) {
          throw new Error(`File too large (${buffer.byteLength} bytes, max ${maxUploadBytes} bytes)`);
        }
        return client.uploadKDriveFile(v.drive_id, {
          directory_id: v.directory_id ?? KDRIVE_ROOT_DIRECTORY_ID,
          file_name: v.file_name,
          content: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
          conflict: v.conflict,
          directory_path: v.directory_path,
          last_modified_at: v.last_modified_at,
        });
      }
      case "infomaniak_create_kdrive_directory": {
        const v = validate(KDriveCreateDirectorySchema, args);
        return client.createKDriveDirectory(v.drive_id, v.name, v.parent_id ?? KDRIVE_ROOT_DIRECTORY_ID, v.only_for_me ?? false);
      }
      case "infomaniak_move_kdrive_file": {
        const v = validate(MoveOrCopyKDriveFileSchema, args);
        return client.moveKDriveFile(v.drive_id, v.file_id, v.destination_directory_id);
      }
      case "infomaniak_copy_kdrive_file": {
        const v = validate(MoveOrCopyKDriveFileSchema, args);
        return client.copyKDriveFile(v.drive_id, v.file_id, v.destination_directory_id);
      }
      case "infomaniak_rename_kdrive_file": {
        const v = validate(RenameKDriveFileSchema, args);
        return client.renameKDriveFile(v.drive_id, v.file_id, v.name);
      }
      case "infomaniak_delete_kdrive_file": {
        const v = validate(KDriveFileIdSchema, args);
        return client.deleteKDriveFile(v.drive_id, v.file_id);
      }
      case "infomaniak_get_kdrive_share_link": {
        const v = validate(KDriveFileIdSchema, args);
        return client.getKDriveShareLink(v.drive_id, v.file_id);
      }
      case "infomaniak_share_kdrive_file": {
        const v = validate(KDriveCreateShareLinkSchema, args);
        const { drive_id, file_id, ...link } = v;
        return client.createKDriveShareLink(drive_id, file_id, link);
      }
      case "infomaniak_update_kdrive_share_link": {
        const v = validate(KDriveUpdateShareLinkSchema, args);
        const { drive_id, file_id, ...link } = v;
        return client.updateKDriveShareLink(drive_id, file_id, link);
      }
      case "infomaniak_delete_kdrive_share_link": {
        const v = validate(KDriveFileIdSchema, args);
        return client.deleteKDriveShareLink(v.drive_id, v.file_id);
      }
      case "infomaniak_list_kdrive_file_access": {
        const v = validate(KDriveFileIdSchema, args);
        return client.listKDriveFileAccess(v.drive_id, v.file_id);
      }
      case "infomaniak_invite_kdrive_access": {
        const v = validate(KDriveInviteAccessSchema, args);
        return client.inviteKDriveAccess(v.drive_id, v.file_id, { emails: v.emails, right: v.right, message: v.message, lang: v.lang });
      }
      case "infomaniak_list_kdrive_trash": {
        const v = validate(KDriveCursorSchema, args);
        return client.listKDriveTrash(v.drive_id, { cursor: v.cursor, limit: v.limit });
      }
      case "infomaniak_restore_kdrive_file": {
        const v = validate(KDriveRestoreSchema, args);
        return client.restoreKDriveFile(v.drive_id, v.file_id, v.destination_directory_id);
      }
      case "infomaniak_delete_kdrive_trashed_file_permanently": {
        const v = validate(KDriveFileIdSchema, args);
        return client.deleteKDriveTrashedFile(v.drive_id, v.file_id);
      }
      case "infomaniak_empty_kdrive_trash": {
        const v = validate(DriveIdSchema, args);
        return client.emptyKDriveTrash(v.drive_id);
      }
      case "infomaniak_list_kdrive_favorites": {
        const v = validate(KDriveCursorSchema, args);
        return client.listKDriveFavorites(v.drive_id, { cursor: v.cursor, limit: v.limit });
      }
      case "infomaniak_add_kdrive_favorite": {
        const v = validate(KDriveFileIdSchema, args);
        return client.addKDriveFavorite(v.drive_id, v.file_id);
      }
      case "infomaniak_remove_kdrive_favorite": {
        const v = validate(KDriveFileIdSchema, args);
        return client.removeKDriveFavorite(v.drive_id, v.file_id);
      }
      case "infomaniak_list_kdrive_recents": {
        const v = validate(KDriveTypeFilterSchema, args);
        return client.listKDriveRecents(v.drive_id, v.type);
      }
      case "infomaniak_list_kdrive_shared_with_me": {
        const v = validate(KDriveTypeFilterSchema, args);
        return client.listKDriveSharedWithMe(v.drive_id, v.type);
      }
      case "infomaniak_get_kdrive_activity": {
        const v = validate(KDriveActivitySchema, args);
        return client.getKDriveActivity(v.drive_id, v.file_id, { cursor: v.cursor, limit: v.limit });
      }
      default:
        throw new Error(`Unknown kDrive tool: ${name}`);
    }
  }

  return { tools: kdriveTools, canHandle: (name) => names.has(name), handle };
}
