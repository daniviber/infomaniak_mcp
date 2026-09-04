/**
 * Unit tests for the kDrive part of InfomaniakClient and for path encoding.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { InfomaniakClient, KDRIVE_ROOT_DIRECTORY_ID, seg } from "./infomaniak-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).buffer),
  };
}

function binaryResponse(bytes: Uint8Array, headers: Record<string, string>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: () => Promise.resolve(new TextDecoder().decode(bytes)),
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
}

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [string, RequestInit];
  return { url, init };
}

describe("seg()", () => {
  it("encodes path separators and traversal", () => {
    expect(seg("../../1/account")).toBe("..%2F..%2F1%2Faccount");
    expect(seg("a b?c#d")).toBe("a%20b%3Fc%23d");
    expect(seg(42)).toBe("42");
  });
});

describe("InfomaniakClient kDrive", () => {
  let client: InfomaniakClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new InfomaniakClient({ token: "t", maxAttempts: 1 });
  });

  it("encodes the domain in DNS paths (no path injection)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: "success", data: [] }));
    await client.getDnsRecords("../../1/account");
    expect(lastCall().url).toBe("https://api.infomaniak.com/1/domain/..%2F..%2F1%2Faccount/dns/record");
  });

  it("lists the root directory by default with the v3 endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: "success", data: [], has_more: false }));
    await client.listKDriveFiles(12);
    const { url, init } = lastCall();
    expect(init.method).toBe("GET");
    expect(url.startsWith(`https://api.infomaniak.com/3/drive/12/files/${KDRIVE_ROOT_DIRECTORY_ID}/files?`)).toBe(true);
    expect(url).toContain("with=path");
    expect(url).not.toContain("type");
  });

  it("passes type, cursor, limit and ordering when listing", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: "success", data: [] }));
    await client.listKDriveFiles(12, 34, { type: "dir", cursor: "abc", limit: 50, order_by: "name", order: "asc" });
    const { url } = lastCall();
    expect(url).toContain("/3/drive/12/files/34/files?");
    expect(url).toContain("type%5B%5D=dir");
    expect(url).toContain("cursor=abc");
    expect(url).toContain("limit=50");
    expect(url).toContain("order_by=name");
    expect(url).toContain("order=asc");
  });

  it("gets file metadata", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: "success", data: { id: 34 } }));
    await client.getKDriveFile(12, 34);
    expect(lastCall().url).toMatch(/^https:\/\/api\.infomaniak\.com\/3\/drive\/12\/files\/34\?with=/);
  });

  it("searches with scope, depth and date range", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: "success", data: [] }));
    await client.searchKDriveFiles(12, "rapport 2025", { directory_id: 5, depth: "unlimited", type: "file", modified_after: "2025-01-01", limit: 10 });
    const { url } = lastCall();
    expect(url).toContain("/3/drive/12/files/search?");
    expect(url).toContain("query=rapport+2025");
    expect(url).toContain("directory_id=5");
    expect(url).toContain("depth=unlimited");
    expect(url).toContain("types%5B%5D=file");
    expect(url).toContain("modified_at=custom");
    expect(url).toContain("modified_after=2025-01-01");
    expect(url).toContain("limit=10");
  });

  it("creates a directory under a parent", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: "success", data: { id: 99 } }));
    await client.createKDriveDirectory(12, "Factures", 34);
    const { url, init } = lastCall();
    expect(url).toBe("https://api.infomaniak.com/3/drive/12/files/34/directory");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Factures", only_for_me: false });
  });

  it("moves and copies with the destination in the path", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ result: "success", data: {} }));
    await client.moveKDriveFile(12, 34, 56);
    expect(lastCall().url).toBe("https://api.infomaniak.com/3/drive/12/files/34/move/56");
    expect(lastCall().init.method).toBe("POST");
    await client.copyKDriveFile(12, 34, 56);
    expect(lastCall().url).toBe("https://api.infomaniak.com/3/drive/12/files/34/copy/56");
  });

  it("renames and trashes files", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ result: "success", data: {} }));
    await client.renameKDriveFile(12, 34, "new.txt");
    expect(lastCall().url).toBe("https://api.infomaniak.com/2/drive/12/files/34/rename");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ name: "new.txt" });
    await client.deleteKDriveFile(12, 34);
    expect(lastCall().url).toBe("https://api.infomaniak.com/2/drive/12/files/34");
    expect(lastCall().init.method).toBe("DELETE");
  });

  it("uploads raw bytes with the v3 upload endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: "success", data: { id: 7, name: "hello.txt" } }));
    const content = new TextEncoder().encode("hello");
    const res = await client.uploadKDriveFile(12, { directory_id: 34, file_name: "hello world.txt", content });
    const { url, init } = lastCall();
    expect(url).toContain("https://api.infomaniak.com/3/drive/12/upload?");
    expect(url).toContain("directory_id=34");
    expect(url).toContain("file_name=hello+world.txt");
    expect(url).toContain("total_size=5");
    expect(url).toContain("conflict=rename");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/octet-stream");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(init.body).toBe(content);
    expect(res.data.id).toBe(7);
  });

  it("downloads a file and reports its content type and name", async () => {
    const bytes = new TextEncoder().encode("bonjour");
    mockFetch.mockResolvedValueOnce(
      binaryResponse(bytes, { "content-type": "text/plain; charset=utf-8", "content-disposition": 'attachment; filename="notes.txt"' }),
    );
    const res = await client.downloadKDriveFile(12, 34);
    expect(lastCall().url).toBe("https://api.infomaniak.com/2/drive/12/files/34/download");
    expect(new TextDecoder().decode(res.bytes)).toBe("bonjour");
    expect(res.contentType).toBe("text/plain; charset=utf-8");
    expect(res.fileName).toBe("notes.txt");
  });

  it("decodes RFC 5987 file names", async () => {
    mockFetch.mockResolvedValueOnce(
      binaryResponse(new Uint8Array([1]), { "content-type": "application/pdf", "content-disposition": "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf" }),
    );
    const res = await client.downloadKDriveFile(12, 34);
    expect(res.fileName).toBe("résumé.pdf");
  });

  it("refuses downloads above the size limit (declared and actual)", async () => {
    mockFetch.mockResolvedValueOnce(binaryResponse(new Uint8Array(10), { "content-type": "application/octet-stream", "content-length": "10" }));
    await expect(client.downloadKDriveFile(12, 34, 5)).rejects.toThrow(/too large/);

    mockFetch.mockResolvedValueOnce(binaryResponse(new Uint8Array(10), { "content-type": "application/octet-stream" }));
    await expect(client.downloadKDriveFile(12, 34, 5)).rejects.toThrow(/too large/);
  });

  it("manages share links on /link", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ result: "success", data: { url: "https://kdrive.infomaniak.com/app/share/12/abc" } }));
    await client.createKDriveShareLink(12, 34, { right: "password", password: "s3cret", can_download: true });
    expect(lastCall().url).toBe("https://api.infomaniak.com/2/drive/12/files/34/link");
    expect(lastCall().init.method).toBe("POST");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ right: "password", password: "s3cret", can_download: true });
    await client.getKDriveShareLink(12, 34);
    expect(lastCall().init.method).toBe("GET");
    await client.updateKDriveShareLink(12, 34, { valid_until: 1800000000 });
    expect(lastCall().init.method).toBe("PUT");
    await client.deleteKDriveShareLink(12, 34);
    expect(lastCall().init.method).toBe("DELETE");
  });

  it("invites users by e-mail", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: "success", data: {} }));
    await client.inviteKDriveAccess(12, 34, { emails: ["a@example.com"], right: "read", message: "hi", lang: "fr" });
    const { url, init } = lastCall();
    expect(url).toBe("https://api.infomaniak.com/2/drive/12/files/34/access/invitations?lang=fr");
    expect(JSON.parse(init.body as string)).toEqual({ emails: ["a@example.com"], right: "read", message: "hi" });
  });

  it("uses the trash endpoints", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ result: "success", data: [] }));
    await client.listKDriveTrash(12, { limit: 20 });
    expect(lastCall().url).toBe("https://api.infomaniak.com/3/drive/12/trash?limit=20");
    await client.restoreKDriveFile(12, 34, 56);
    expect(lastCall().url).toBe("https://api.infomaniak.com/2/drive/12/trash/34/restore");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ destination_directory_id: 56 });
    await client.restoreKDriveFile(12, 34);
    expect(lastCall().init.body).toBeUndefined();
    await client.deleteKDriveTrashedFile(12, 34);
    expect(lastCall().url).toBe("https://api.infomaniak.com/2/drive/12/trash/34");
    expect(lastCall().init.method).toBe("DELETE");
    await client.emptyKDriveTrash(12);
    expect(lastCall().url).toBe("https://api.infomaniak.com/2/drive/12/trash");
    expect(lastCall().init.method).toBe("DELETE");
  });

  it("uses favorites, recents, shared-with-me and activity endpoints", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ result: "success", data: [] }));
    await client.listKDriveFavorites(12);
    expect(lastCall().url).toContain("/3/drive/12/files/favorites");
    await client.addKDriveFavorite(12, 34);
    expect(lastCall().url).toBe("https://api.infomaniak.com/2/drive/12/files/34/favorite");
    expect(lastCall().init.method).toBe("POST");
    await client.removeKDriveFavorite(12, 34);
    expect(lastCall().init.method).toBe("DELETE");
    await client.listKDriveRecents(12, "file");
    expect(lastCall().url).toContain("/3/drive/12/files/recents?type%5B%5D=file");
    await client.listKDriveSharedWithMe(12);
    expect(lastCall().url).toBe("https://api.infomaniak.com/3/drive/12/files/shared_with_me");
    await client.getKDriveActivity(12);
    expect(lastCall().url).toContain("/3/drive/12/files/activities?with=file%2Cuser");
    await client.getKDriveActivity(12, 34, { limit: 5 });
    expect(lastCall().url).toContain("/3/drive/12/files/34/activities?with=user");
    expect(lastCall().url).toContain("limit=5");
  });

  it("surfaces API errors with status and description", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: "error", error: { code: "not_authorized", description: "Forbidden" } }, 403));
    await expect(client.listKDriveFiles(12)).rejects.toThrow("Infomaniak API Error (403): Forbidden");
  });
});
