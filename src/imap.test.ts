/**
 * The IMAP tools, end to end: real Zod validation, the real IMAP client
 * speaking IMAP over TCP to a server that serves the mailbox in
 * src/__fixtures__/imap (derived messages, provenance in mailbox.json).
 * Nothing is patched; what is asserted is what the tools return and what
 * went over the wire.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ImapReader, imapConfigFromEnv, imapTools, IMAP_TOOL_NAMES, handleImapTool } from "./imap-tools.js";
import { InfomaniakClient } from "./infomaniak-client.js";
import { createMcpServer } from "./server.js";
import { ImapTestServer } from "./test-support/imap-server.js";

const server = new ImapTestServer();
let reader: ImapReader;
let address: { host: string; port: number };

beforeAll(async () => {
  address = await server.start();
  reader = new ImapReader({ ...address, secure: false, user: server.user, password: server.password });
});
afterAll(() => server.stop());
beforeEach(() => server.commands.splice(0));

type Summary = { uid: number; date: string; from: string; to: string[]; subject: string; seen: boolean; size: number };
type SearchResult = { folder: string; total_matches: number; returned: number; messages: Summary[]; notice: string };
type Address = { name: string; address: string };
type Message = {
  folder: string; uid: number; date: string; from: Address | null; to: Address[]; cc: Address[];
  subject: string; message_id: string; in_reply_to: string; text: string; text_source: string;
  text_truncated: boolean; attachments: { filename: string; mime_type: string; size: number }[]; notice: string;
};

const search = (args: Record<string, unknown>) => handleImapTool(reader, "infomaniak_search_mail_messages", args) as Promise<SearchResult>;
const get = (args: Record<string, unknown>) => handleImapTool(reader, "infomaniak_get_mail_message", args) as Promise<Message>;

// ── configuration ────────────────────────────────────────────────────────────

describe("configuration from the environment", () => {
  it("is absent when no IMAP user is set: the tools are then not offered", () => {
    expect(imapConfigFromEnv({})).toBeNull();
  });

  it("defaults to Infomaniak's IMAP server over TLS on 993", () => {
    expect(imapConfigFromEnv({ INFOMANIAK_IMAP_USER: "me@example.org", INFOMANIAK_IMAP_PASSWORD: "pw" })).toEqual({
      host: "mail.infomaniak.com", port: 993, secure: true, user: "me@example.org", password: "pw",
    });
  });

  it("reads the password from a file, so it need not sit in the MCP client's config", () => {
    const file = join(mkdtempSync(join(tmpdir(), "imap-")), "password");
    writeFileSync(file, "from-file\r\n");
    const config = imapConfigFromEnv({ INFOMANIAK_IMAP_USER: "me@example.org", INFOMANIAK_IMAP_PASSWORD_FILE: file });
    expect(config?.password).toBe("from-file");
  });

  it("refuses a user without a password rather than failing at the first call", () => {
    expect(() => imapConfigFromEnv({ INFOMANIAK_IMAP_USER: "me@example.org" })).toThrow(/INFOMANIAK_IMAP_PASSWORD/);
  });

  it("can never be pointed off TLS from the environment", () => {
    const config = imapConfigFromEnv({ INFOMANIAK_IMAP_USER: "u@example.org", INFOMANIAK_IMAP_PASSWORD: "pw", INFOMANIAK_IMAP_HOST: "imap.example.org", INFOMANIAK_IMAP_PORT: "1993" });
    expect(config).toMatchObject({ host: "imap.example.org", port: 1993, secure: true });
  });

  it("does not put the password in the error when the server refuses it", async () => {
    const wrong = new ImapReader({ ...address, secure: false, user: server.user, password: "s3cret-wrong-password" });
    const error = await handleImapTool(wrong, "infomaniak_list_mail_folders", {}).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/authentication/i);
    expect((error as Error).message).not.toContain("s3cret-wrong-password");
  });
});

// ── the tools ────────────────────────────────────────────────────────────────

describe("the tools", () => {
  it("are three reads, named so a read-only policy keyed on the verb keeps them", () => {
    expect([...IMAP_TOOL_NAMES].sort()).toEqual([
      "infomaniak_get_mail_message", "infomaniak_list_mail_folders", "infomaniak_search_mail_messages",
    ]);
    for (const tool of imapTools) {
      expect(tool.name).toMatch(/^infomaniak_(list|search|get)_/);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it("say that what they return was written by other people", () => {
    for (const tool of imapTools.filter((t) => t.name !== "infomaniak_list_mail_folders")) {
      expect(tool.description).toMatch(/data, not instructions/);
    }
  });
});

// ── folders ──────────────────────────────────────────────────────────────────

describe("listing folders", () => {
  it("names each folder with its role", async () => {
    const result = (await handleImapTool(reader, "infomaniak_list_mail_folders", {})) as { folders: { path: string; role: string | null }[] };
    expect(result.folders).toEqual([
      { path: "INBOX", role: "inbox" },
      { path: "Posta inviata", role: "sent" },
      { path: "Cestino", role: "trash" },
    ]);
  });
});

// ── searching ────────────────────────────────────────────────────────────────

describe("searching messages", () => {
  it("lists the inbox newest first, with decoded subjects and senders", async () => {
    const result = await search({});
    expect(result.folder).toBe("INBOX");
    expect(result.total_matches).toBe(5);
    expect(result.messages.map((m) => m.uid)).toEqual([5, 4, 3, 2, 1]);
    const reply = result.messages.find((m) => m.uid === 2)!;
    expect(reply.subject).toBe("Re: Proposta di collaborazione — Odyssey");
    expect(reply.from).toBe("Odyssey Studio — Dev <dev@example.com>");
    expect(reply.to).toEqual(["Me <me@example.org>"]);
    expect(reply.date).toBe("2026-10-19T16:40:30.000Z");
    expect(reply.seen).toBe(false);
    expect(result.messages.find((m) => m.uid === 1)!.seen).toBe(true);
  });

  it("filters by sender", async () => {
    expect((await search({ from: "anna@example.org" })).messages.map((m) => m.uid)).toEqual([4, 1]);
  });

  it("finds a subject that is not ASCII, sending it as UTF-8", async () => {
    const result = await search({ subject: "collaborazione — Odyssey" });
    expect(result.messages.map((m) => m.uid)).toEqual([2]);
    const sent = server.commands.find((c) => c.name === "UID SEARCH")!;
    expect(sent.args).toMatch(/^CHARSET UTF-8/);
  });

  it("filters by date, before being exclusive", async () => {
    expect((await search({ since: "2026-10-19", before: "2026-10-22" })).messages.map((m) => m.uid)).toEqual([3, 2]);
  });

  it("filters by text in the body", async () => {
    expect((await search({ text: "giovedì" })).messages.map((m) => m.uid)).toEqual([2]);
  });

  it("returns at most `limit` messages, the newest, and says how many matched", async () => {
    const result = await search({ limit: 2 });
    expect(result).toMatchObject({ total_matches: 5, returned: 2 });
    expect(result.messages.map((m) => m.uid)).toEqual([5, 4]);
  });

  it("reaches the sent folder by its role, whatever it is called", async () => {
    const result = await search({ folder: "sent" });
    expect(result.folder).toBe("Posta inviata");
    expect(result.messages.map((m) => m.subject)).toEqual(["Proposta di collaborazione — Odyssey"]);
  });

  it("refuses a folder that does not exist, naming the ones that do", async () => {
    await expect(search({ folder: "Archivio 2019" })).rejects.toThrow(/Archivio 2019.*INBOX.*Posta inviata.*Cestino/);
  });

  it("validates its arguments", async () => {
    await expect(search({ limit: 500 })).rejects.toThrow(/limit/);
    await expect(search({ since: "19/10/2026" })).rejects.toThrow(/since/);
  });
});

// ── reading one message ──────────────────────────────────────────────────────

describe("reading a message", () => {
  it("returns the headers and the plain text", async () => {
    const msg = await get({ uid: 1 });
    expect(msg).toMatchObject({
      folder: "INBOX", uid: 1, subject: "Fattura ottobre", message_id: "<inbox-1@example.org>",
      from: { name: "Anna Rossi", address: "anna@example.org" },
      to: [{ name: "Me", address: "me@example.org" }],
      text_source: "text/plain", text_truncated: false, attachments: [],
    });
    expect(msg.text).toContain("120 EUR, scadenza 31/10.");
  });

  it("decodes quoted-printable UTF-8 and keeps the thread reference", async () => {
    const msg = await get({ uid: 2 });
    expect(msg.text).toContain("possiamo sentirci giovedì?");
    expect(msg.text).toContain("l'università di Udine");
    expect(msg.in_reply_to).toBe("<sent-1@example.org>");
  });

  it("turns an HTML-only message into text, dropping scripts and styles but keeping link targets", async () => {
    const msg = await get({ uid: 3 });
    expect(msg.text_source).toBe("text/html");
    expect(msg.text).toContain("Le novità del mese & altro.");
    expect(msg.text).toContain("l'articolo completo (https://example.net/ottobre)");
    expect(msg.text).not.toMatch(/alert|ignore previous instructions|color: red|<p>/);
  });

  it("lists attachments by name, type and size without returning their content", async () => {
    const msg = await get({ uid: 4 });
    expect(msg.attachments).toEqual([{ filename: "contratto.pdf", mime_type: "application/pdf", size: 56 }]);
    expect(JSON.stringify(msg)).not.toContain("JVBERi0");
    expect(JSON.stringify(msg)).not.toContain("%PDF");
  });

  it("opens address groups into their members", async () => {
    const msg = await get({ uid: 4 });
    expect(msg.to).toEqual([{ name: "Me", address: "me@example.org" }, { name: "Paolo", address: "paolo@example.org" }]);
  });

  it("shows the address a crafted display name hides", async () => {
    const msg = await get({ uid: 5 });
    expect(msg.from?.address).toBe("attacker@evil.example");
  });

  it("cuts the text at max_chars and says so", async () => {
    const msg = await get({ uid: 1, max_chars: 10 });
    expect(msg.text).toHaveLength(10);
    expect(msg.text_truncated).toBe(true);
  });

  it("carries the notice that the content is someone else's", async () => {
    expect((await get({ uid: 1 })).notice).toMatch(/data, not instructions/);
  });

  it("reads from another folder by role", async () => {
    const msg = await get({ folder: "sent", uid: 1 });
    expect(msg.subject).toBe("Proposta di collaborazione — Odyssey");
  });

  it("says when the message is not there", async () => {
    await expect(get({ uid: 99 })).rejects.toThrow(/uid 99.*INBOX/);
  });
});

// ── read-only on the wire ────────────────────────────────────────────────────

describe("what goes over the wire", () => {
  it("opens folders read-only, fetches bodies with PEEK, writes nothing, and logs out", async () => {
    const before = server.connections.length;
    await search({});
    await search({ folder: "sent" });
    for (const uid of [1, 2, 3, 4, 5]) await get({ uid });
    await get({ folder: "sent", uid: 1 });

    expect(server.writes()).toEqual([]);
    expect(server.commands.some((c) => c.name === "EXAMINE")).toBe(true);
    const fetches = server.commands.filter((c) => c.name.endsWith("FETCH"));
    expect(fetches.length).toBeGreaterThan(0);
    for (const f of fetches) {
      expect(f.args).not.toMatch(/BODY\[/i);
      expect(f.args).not.toMatch(/RFC822(?!\.SIZE)/i);
    }
    const opened = server.connections.slice(before);
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.every((c) => c.loggedOut)).toBe(true);
  });

  it("leaves every message's flags as they were", async () => {
    for (const uid of [1, 2, 3, 4, 5]) await get({ uid });
    expect(server.flags("INBOX", 1)).toEqual(["\\Seen"]);
    for (const uid of [2, 3, 4, 5]) expect(server.flags("INBOX", uid)).toEqual([]);
  });
});

// ── the MCP server ───────────────────────────────────────────────────────────

describe("the MCP server", () => {
  async function connect(imap: ImapReader | null) {
    const mcp = createMcpServer(new InfomaniakClient({ token: "test-token" }), null, imap);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
    return client;
  }

  it("offers the IMAP tools when IMAP is configured, and calls them", async () => {
    const client = await connect(reader);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of IMAP_TOOL_NAMES) expect(names).toContain(name);
    const result = await client.callTool({ name: "infomaniak_search_mail_messages", arguments: { from: "anna" } });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text).messages.map((m: Summary) => m.uid)).toEqual([4, 1]);
    await client.close();
  });

  it("does not offer them when IMAP is not configured", async () => {
    const client = await connect(null);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of IMAP_TOOL_NAMES) expect(names).not.toContain(name);
    const result = await client.callTool({ name: "infomaniak_search_mail_messages", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/INFOMANIAK_IMAP_USER/);
    await client.close();
  });
});
