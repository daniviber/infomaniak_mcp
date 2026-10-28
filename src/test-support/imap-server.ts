/**
 * A real IMAP server for the tests, serving the mailbox in src/__fixtures__/imap.
 *
 * The client under test is not patched: it connects over TCP to this server and
 * speaks IMAP4rev1 (RFC 3501) to it, the way it speaks to mail.infomaniak.com.
 * What is implemented is what a read-only client needs — CAPABILITY, LOGIN,
 * LIST/LSUB with SPECIAL-USE flags (RFC 6154), EXAMINE/SELECT, UID SEARCH
 * (with CHARSET UTF-8 and synchronizing literals) and UID FETCH of flags, dates,
 * sizes and BODY sections — plus the commands that write, answered NO and
 * recorded. Every command received is kept, so a test can read back exactly
 * what went over the wire. A non-PEEK BODY fetch sets \Seen, as a real server
 * does, so a client that forgets PEEK is caught by the flags as well.
 */

import { createServer, Server, Socket } from "net";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { AddressInfo } from "net";
import PostalMime from "postal-mime";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "imap");

interface Manifest {
  user: string;
  password: string;
  folders: { path: string; specialUse: string | null; messages: { uid: number; file: string; internalDate: string; flags: string[] }[] }[];
}

interface StoredMessage {
  uid: number;
  raw: Buffer;
  internalDate: Date;
  flags: Set<string>;
  search: { from: string; to: string; subject: string; body: string; headers: string };
}

interface Folder {
  path: string;
  specialUse: string | null;
  messages: StoredMessage[];
}

export interface SeenCommand {
  tag: string;
  name: string; // upper case, "UID FETCH" for UID commands
  args: string; // the rest of the line, literals inlined
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WRITES = new Set(["STORE", "UID STORE", "COPY", "UID COPY", "MOVE", "UID MOVE", "EXPUNGE", "UID EXPUNGE", "APPEND", "CREATE", "DELETE", "RENAME", "SUBSCRIBE", "UNSUBSCRIBE"]);

function crlf(text: Buffer): Buffer {
  return Buffer.from(text.toString("latin1").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"), "latin1");
}

function imapDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

function parseSearchDate(s: string): Date {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  if (!m) throw new Error(`bad date ${s}`);
  return new Date(Date.UTC(Number(m[3]), MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()), Number(m[1])));
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Atoms, quoted strings and literal contents of an argument string, parentheses as their own tokens. */
function tokenize(args: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    const c = args[i];
    if (c === " ") { i++; continue; }
    if (c === "(" || c === ")") { out.push(c); i++; continue; }
    if (c === '"') {
      let s = "";
      i++;
      while (i < args.length && args[i] !== '"') {
        if (args[i] === "\\") i++;
        s += args[i++];
      }
      i++;
      out.push(s);
      continue;
    }
    let j = i;
    while (j < args.length && args[j] !== " " && args[j] !== "(" && args[j] !== ")") j++;
    out.push(args.slice(i, j));
    i = j;
  }
  return out;
}

function headerBlock(raw: Buffer): string {
  const text = raw.toString("latin1");
  const end = text.indexOf("\r\n\r\n");
  return end === -1 ? text : text.slice(0, end + 2);
}

function headerFields(raw: Buffer, names: string[], not: boolean): Buffer {
  const lines = headerBlock(raw).split("\r\n").filter((l) => l !== "");
  const fields: string[][] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && fields.length) fields[fields.length - 1].push(line);
    else fields.push([line]);
  }
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const kept = fields.filter((f) => wanted.has(f[0].split(":")[0].trim().toLowerCase()) !== not);
  return Buffer.from(kept.map((f) => f.join("\r\n") + "\r\n").join("") + "\r\n", "latin1");
}

export class ImapTestServer {
  readonly commands: SeenCommand[] = [];
  readonly connections: { loggedOut: boolean }[] = [];
  private folders: Folder[] = [];
  private manifest!: Manifest;
  private server: Server | null = null;
  private sockets = new Set<Socket>();

  get user(): string { return this.manifest.user; }
  get password(): string { return this.manifest.password; }

  async start(): Promise<{ host: string; port: number }> {
    this.manifest = JSON.parse(readFileSync(join(fixturesDir, "mailbox.json"), "utf8")) as Manifest;
    this.folders = [];
    for (const f of this.manifest.folders) {
      const messages: StoredMessage[] = [];
      for (const m of f.messages) {
        const raw = crlf(readFileSync(join(fixturesDir, m.file)));
        const parsed = await PostalMime.parse(raw);
        const addr = (a: { name?: string; address?: string } | undefined) => `${a?.name ?? ""} ${a?.address ?? ""}`;
        messages.push({
          uid: m.uid,
          raw,
          internalDate: new Date(m.internalDate),
          flags: new Set(m.flags),
          search: {
            from: addr(parsed.from as { name?: string; address?: string }).toLowerCase(),
            to: (parsed.to ?? []).map((a) => addr(a as { name?: string; address?: string })).join(" ").toLowerCase(),
            subject: (parsed.subject ?? "").toLowerCase(),
            body: `${parsed.text ?? ""} ${parsed.html ?? ""}`.toLowerCase(),
            headers: headerBlock(raw).toLowerCase(),
          },
        });
      }
      this.folders.push({ path: f.path, specialUse: f.specialUse, messages });
    }
    this.server = createServer((socket) => this.serve(socket));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    return { host: "127.0.0.1", port: (this.server.address() as AddressInfo).port };
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  /** The flags a message has now — a read-only client must leave them as they were. */
  flags(path: string, uid: number): string[] {
    const msg = this.folder(path)?.messages.find((m) => m.uid === uid);
    if (!msg) throw new Error(`no message ${path}/${uid}`);
    return [...msg.flags].sort();
  }

  writes(): SeenCommand[] {
    return this.commands.filter((c) => WRITES.has(c.name) || c.name === "SELECT");
  }

  private folder(path: string): Folder | undefined {
    return this.folders.find((f) => f.path === path || (path.toUpperCase() === "INBOX" && f.path === "INBOX"));
  }

  private serve(socket: Socket): void {
    this.sockets.add(socket);
    const conn = { loggedOut: false };
    this.connections.push(conn);
    let buffer = Buffer.alloc(0);
    let pending = ""; // a command line waiting for the rest of a literal
    let literalLeft = 0;
    let authenticated = false;
    let selected: Folder | null = null;
    const send = (s: string | Buffer) => socket.write(s);

    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => this.sockets.delete(socket));
    send("* OK [CAPABILITY IMAP4rev1 SPECIAL-USE] test server ready\r\n");

    const handle = (line: string) => {
      const sp = line.indexOf(" ");
      const tag = line.slice(0, sp);
      let rest = line.slice(sp + 1);
      let name = rest.split(" ")[0].toUpperCase();
      rest = rest.slice(name.length).trimStart();
      if (name === "UID") {
        const sub = rest.split(" ")[0].toUpperCase();
        name = `UID ${sub}`;
        rest = rest.slice(sub.length).trimStart();
      }
      this.commands.push({ tag, name, args: rest });
      const ok = (text = `${name} completed`) => send(`${tag} OK ${text}\r\n`);

      if (!authenticated && !["CAPABILITY", "LOGIN", "LOGOUT", "NOOP"].includes(name)) {
        return send(`${tag} BAD not authenticated\r\n`);
      }
      switch (name) {
        case "CAPABILITY":
          send("* CAPABILITY IMAP4rev1 SPECIAL-USE\r\n");
          return ok();
        case "NOOP":
          return ok();
        case "LOGIN": {
          const [user, password] = tokenize(rest);
          if (user !== this.manifest.user || password !== this.manifest.password) {
            return send(`${tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n`);
          }
          authenticated = true;
          return ok("[CAPABILITY IMAP4rev1 SPECIAL-USE] Logged in");
        }
        case "LOGOUT":
          conn.loggedOut = true;
          send("* BYE Logging out\r\n");
          ok();
          socket.end();
          return;
        case "LIST":
        case "LSUB": {
          const [, pattern] = tokenize(rest);
          if (pattern === "") {
            send(`* ${name} (\\Noselect) "/" ""\r\n`);
            return ok();
          }
          for (const f of this.folders) {
            const attrs = ["\\HasNoChildren", ...(f.specialUse ? [f.specialUse] : [])].join(" ");
            send(`* ${name} (${attrs}) "/" ${quote(f.path)}\r\n`);
          }
          return ok();
        }
        case "SELECT":
        case "EXAMINE": {
          const [path] = tokenize(rest);
          const f = this.folder(path);
          if (!f) return send(`${tag} NO [NONEXISTENT] Mailbox doesn't exist: ${path}\r\n`);
          selected = f;
          const uidNext = Math.max(0, ...f.messages.map((m) => m.uid)) + 1;
          send("* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n");
          send(`* ${f.messages.length} EXISTS\r\n* 0 RECENT\r\n`);
          send(`* OK [UIDVALIDITY 1700000000] UIDs valid\r\n* OK [UIDNEXT ${uidNext}] Predicted next UID\r\n`);
          return ok(name === "EXAMINE" ? "[READ-ONLY] Examine completed" : "[READ-WRITE] Select completed");
        }
        case "CLOSE":
        case "UNSELECT":
          selected = null;
          return ok();
        case "UID SEARCH":
        case "SEARCH": {
          if (!selected) return send(`${tag} BAD no mailbox selected\r\n`);
          let tokens = tokenize(rest);
          if (tokens[0]?.toUpperCase() === "CHARSET") {
            if (tokens[1]?.toUpperCase() !== "UTF-8" && tokens[1]?.toUpperCase() !== "US-ASCII") {
              return send(`${tag} NO [BADCHARSET (UTF-8 US-ASCII)] unsupported charset\r\n`);
            }
            tokens = tokens.slice(2);
          }
          let hits: StoredMessage[];
          try {
            hits = selected.messages.filter((m) => this.matches(m, tokens));
          } catch (e) {
            return send(`${tag} BAD ${(e as Error).message}\r\n`);
          }
          const ids = hits.map((m) => (name === "UID SEARCH" ? m.uid : selected!.messages.indexOf(m) + 1));
          send(`* SEARCH${ids.length ? " " + ids.join(" ") : ""}\r\n`);
          return ok();
        }
        case "UID FETCH":
        case "FETCH": {
          if (!selected) return send(`${tag} BAD no mailbox selected\r\n`);
          const sp2 = rest.indexOf(" ");
          const set = rest.slice(0, sp2);
          const items = rest.slice(sp2 + 1);
          const byUid = name === "UID FETCH";
          const max = byUid ? Math.max(0, ...selected.messages.map((m) => m.uid)) : selected.messages.length;
          const wanted = new Set<number>();
          for (const part of set.split(",")) {
            const [a, b] = part.split(":");
            const lo = a === "*" ? max : Number(a);
            const hi = b === undefined ? lo : b === "*" ? max : Number(b);
            for (let n = Math.min(lo, hi); n <= Math.max(lo, hi); n++) wanted.add(n);
          }
          selected.messages.forEach((m, i) => {
            const id = byUid ? m.uid : i + 1;
            if (wanted.has(id)) send(this.fetchResponse(i + 1, m, items, byUid));
          });
          return ok();
        }
        default:
          if (WRITES.has(name)) return send(`${tag} NO [CANNOT] this test server refuses writes\r\n`);
          return send(`${tag} BAD unknown command ${name}\r\n`);
      }
    };

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (literalLeft > 0) {
          if (buffer.length < literalLeft) return;
          // A literal's content becomes a quoted string in the recorded line.
          pending += quote(buffer.subarray(0, literalLeft).toString("utf8"));
          buffer = buffer.subarray(literalLeft);
          literalLeft = 0;
          continue;
        }
        const end = buffer.indexOf("\r\n");
        if (end === -1) return;
        let line = buffer.subarray(0, end).toString("utf8");
        buffer = buffer.subarray(end + 2);
        const lit = /\{(\d+)\}$/.exec(line);
        if (lit) {
          pending += line.slice(0, lit.index);
          literalLeft = Number(lit[1]);
          send("+ Ready for literal data\r\n");
          continue;
        }
        line = pending + line;
        pending = "";
        handle(line);
      }
    });
  }

  private matches(m: StoredMessage, tokens: string[]): boolean {
    let i = 0;
    let all = true;
    while (i < tokens.length) {
      const key = tokens[i++].toUpperCase();
      const arg = () => {
        if (i >= tokens.length) throw new Error(`${key} needs an argument`);
        return tokens[i++];
      };
      // Every key's argument is consumed whatever the verdict so far, so an AND
      // already false cannot leave an argument to be read as the next key.
      let hit: boolean;
      switch (key) {
        case "ALL": hit = true; break;
        case "FROM": { const v = arg().toLowerCase(); hit = m.search.from.includes(v); break; }
        case "TO": { const v = arg().toLowerCase(); hit = m.search.to.includes(v); break; }
        case "SUBJECT": { const v = arg().toLowerCase(); hit = m.search.subject.includes(v); break; }
        case "BODY": { const v = arg().toLowerCase(); hit = m.search.body.includes(v); break; }
        case "TEXT": { const v = arg().toLowerCase(); hit = m.search.body.includes(v) || m.search.headers.includes(v); break; }
        case "SINCE": { const d = parseSearchDate(arg()); hit = m.internalDate >= d; break; }
        case "BEFORE": { const d = parseSearchDate(arg()); hit = m.internalDate < d; break; }
        case "UID": { const set = arg(); hit = set.split(",").some((p) => { const [a, b] = p.split(":"); return b === undefined ? m.uid === Number(a) : m.uid >= Number(a) && (b === "*" || m.uid <= Number(b)); }); break; }
        default: throw new Error(`unsupported search key ${key}`);
      }
      all = all && hit;
    }
    return all;
  }

  private fetchResponse(seq: number, m: StoredMessage, items: string, byUid: boolean): Buffer {
    const parts: Buffer[] = [];
    const add = (s: string) => parts.push(Buffer.from(s, "latin1"));
    const fields: string[] = [];
    if (byUid || /\bUID\b/i.test(items)) fields.push(`UID ${m.uid}`);
    if (/\bINTERNALDATE\b/i.test(items)) fields.push(`INTERNALDATE "${imapDate(m.internalDate)}"`);
    if (/\bRFC822\.SIZE\b/i.test(items)) fields.push(`RFC822.SIZE ${m.raw.length}`);
    const bodies: { key: string; data: Buffer }[] = [];
    const re = /BODY(\.PEEK)?\[([^\]]*)\](?:<(\d+)\.(\d+)>)?/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(items))) {
      const [, peek, section, start, length] = match;
      if (!peek) m.flags.add("\\Seen");
      let data: Buffer;
      const sec = section.toUpperCase();
      if (sec === "") data = m.raw;
      else if (sec === "HEADER") data = Buffer.from(headerBlock(m.raw) + "\r\n", "latin1");
      else if (sec.startsWith("HEADER.FIELDS")) {
        const names = /\(([^)]*)\)/.exec(section)?.[1].split(/\s+/).filter(Boolean) ?? [];
        data = headerFields(m.raw, names, sec.startsWith("HEADER.FIELDS.NOT"));
      } else if (sec === "TEXT") {
        const text = m.raw.toString("latin1");
        data = Buffer.from(text.slice(text.indexOf("\r\n\r\n") + 4), "latin1");
      } else throw new Error(`unsupported section ${section}`);
      let key = `BODY[${section}]`;
      if (start !== undefined) {
        data = data.subarray(Number(start), Number(start) + Number(length));
        key += `<${start}>`;
      }
      bodies.push({ key, data });
    }
    // Flags last, so a non-PEEK fetch in the same command already shows \Seen.
    if (/\bFLAGS\b/i.test(items)) fields.push(`FLAGS (${[...m.flags].join(" ")})`);
    add(`* ${seq} FETCH (${fields.join(" ")}`);
    for (const b of bodies) {
      add(`${fields.length || parts.length > 1 ? " " : ""}${b.key} {${b.data.length}}\r\n`);
      parts.push(b.data);
    }
    add(")\r\n");
    return Buffer.concat(parts);
  }
}
