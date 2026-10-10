/**
 * The mail tools, end to end: real Zod validation, the real client speaking
 * real HTTP to a replay of what api.infomaniak.com answered on 2026-10-10
 * (src/__fixtures__/mail, anonymised, provenance in each file).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { InfomaniakClient } from "./infomaniak-client.js";
import { handleMailTool, mailTools, MAIL_TOOL_NAMES, MailboxNameSchema, CreateMailboxSchema, CreateRedirectionSchema } from "./mail-tools.js";
import { tools } from "./server.js";
import { validate } from "./schemas.js";
import { ReplayServer, recording } from "./test-support/replay-server.js";

const H = "/1/mail_hostings/100001";
const replay = new ReplayServer()
  .on("GET", "/1/products", "mail/products_email_hosting")
  .on("GET", `${H}/mailboxes`, "mail/mailboxes")
  .on("GET", `${H}/mailboxes/user1`, "mail/mailbox")
  .on("GET", `${H}/mailboxes/user1/aliases`, "mail/aliases")
  .on("GET", `${H}/mailboxes/user1/forwarding_addresses`, "mail/forwarding")
  .on("GET", `${H}/mailboxes/user1/auth/folders`, "mail/folders")
  .on("GET", `${H}/redirections`, "mail/redirections")
  .on("GET", `${H}/auto_replies`, "mail/auto_replies")
  // Writes are answered with the API's envelope; what is tested is what the
  // client sends, because nothing here may create or delete on a live account.
  .on("POST", `${H}/mailboxes`, { status: 201, body: { result: "success", data: { mailbox: { mailbox_name: "user8" } } } })
  .on("PATCH", `${H}/mailboxes/user1`, { status: 200, body: { result: "success", data: { mailbox_name: "user1", note: "hello" } } })
  .on("DELETE", `${H}/mailboxes/user1`, { status: 200, body: { result: "success", data: true } })
  .on("POST", `${H}/mailboxes/user1/aliases`, { status: 200, body: { result: "success", data: true } })
  .on("DELETE", `${H}/mailboxes/user1/aliases/sales`, { status: 200, body: { result: "success", data: true } })
  .on("POST", `${H}/mailboxes/user1/forwarding_addresses`, { status: 200, body: { result: "success", data: true } })
  .on("PUT", `${H}/mailboxes/user1/forwarding_addresses`, { status: 200, body: { result: "success", data: true } })
  .on("DELETE", `${H}/mailboxes/user1/forwarding_addresses`, { status: 200, body: { result: "success", data: true } })
  .on("POST", `${H}/redirections`, { status: 201, body: { result: "success", data: { id: "42", name: "info", targets: [] } } })
  .on("DELETE", `${H}/redirections/42`, { status: 200, body: { result: "success", data: true } })
  .on("POST", `${H}/auto_replies`, { status: 201, body: { result: "success", data: { id: 7, name: "Holidays" } } })
  .on("PATCH", `${H}/auto_replies/7`, { status: 200, body: { result: "success", data: { id: 7, name: "Back" } } })
  .on("DELETE", `${H}/auto_replies/7`, { status: 200, body: { result: "success", data: true } })
  // What the server used to call, as the API answered it on 2026-10-10.
  .on("GET", "/1/mail", "mail/legacy_v1_mail_404");

let client: InfomaniakClient;

beforeAll(async () => {
  const baseUrl = await replay.start();
  client = new InfomaniakClient({ token: "test-token", baseUrl, maxAttempts: 1 });
});
afterAll(() => replay.stop());
beforeEach(() => replay.requests.splice(0));

const last = () => replay.requests[replay.requests.length - 1];

describe("the routes the server used to call", () => {
  it("/1/mail does not exist: the API answered 404 to it", async () => {
    await expect(client.call("GET", "/1/mail")).rejects.toThrow("Infomaniak API Error (404)");
    expect(recording("mail/legacy_v1_mail_404").status).toBe(404);
    expect(recording("mail/legacy_v1_mailbox_302").status).toBe(302);
  });
});

describe("reading a mail hosting", () => {
  it("lists mail hostings through the products list filtered on the mail service", async () => {
    const result = await handleMailTool(client, "infomaniak_list_mail_hostings", {});
    expect(last().path).toBe("/1/products");
    expect(last().query).toEqual({ service_name: "email_hosting" });
    expect(last().headers.authorization).toBe("Bearer test-token");
    const data = (result as { data: { id: number; service_name: string; customer_name: string }[] }).data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id: 100001, service_name: "email_hosting", customer_name: "example.com" });
  });

  it("passes account_id through when given", async () => {
    await handleMailTool(client, "infomaniak_list_mail_hostings", { account_id: 200001 });
    expect(last().query).toEqual({ service_name: "email_hosting", account_id: "200001" });
  });

  it("lists the mailboxes of a hosting, with the API's pagination envelope", async () => {
    const result = (await handleMailTool(client, "infomaniak_list_mailboxes", { mail_hosting_id: 100001 })) as {
      data: { mailbox_name: string; mailbox: string }[];
      total: number;
    };
    expect(last().method).toBe("GET");
    expect(last().path).toBe(`${H}/mailboxes`);
    expect(result.data).toHaveLength(7);
    expect(result.total).toBe(7);
    expect(result.data[0]).toMatchObject({ mailbox_name: "user1", mailbox: "user1@example.com" });
  });

  it("forwards search and pagination as query parameters", async () => {
    await handleMailTool(client, "infomaniak_list_mailboxes", { mail_hosting_id: 100001, search: "us", page: 2, per_page: 2 });
    expect(last().query).toEqual({ search: "us", page: "2", per_page: "2" });
  });

  it("reads one mailbox by name", async () => {
    const result = (await handleMailTool(client, "infomaniak_get_mailbox", { mail_hosting_id: 100001, mailbox_name: "user1" })) as {
      data: { mailbox_name: string; is_limited: boolean };
    };
    expect(last().path).toBe(`${H}/mailboxes/user1`);
    expect(result.data.mailbox_name).toBe("user1");
    expect(typeof result.data.is_limited).toBe("boolean");
  });

  it("reads aliases, forwarding and folders on their own routes", async () => {
    const aliases = (await handleMailTool(client, "infomaniak_list_mailbox_aliases", { mail_hosting_id: 100001, mailbox_name: "user1" })) as {
      data: { aliases: string[]; enabled_alias: number };
    };
    expect(last().path).toBe(`${H}/mailboxes/user1/aliases`);
    expect(Array.isArray(aliases.data.aliases)).toBe(true);

    const fwd = (await handleMailTool(client, "infomaniak_get_mailbox_forwarding", { mail_hosting_id: 100001, mailbox_name: "user1" })) as {
      data: Record<string, unknown>;
    };
    expect(last().path).toBe(`${H}/mailboxes/user1/forwarding_addresses`);
    expect(Object.keys(fwd.data).sort()).toEqual(["has_dont_deliver", "has_forward_spam", "is_enabled", "redirect_adresses"]);

    const folders = (await handleMailTool(client, "infomaniak_list_mailbox_folders", { mail_hosting_id: 100001, mailbox_name: "user1" })) as {
      data: { folders: unknown[]; trash_folder: string };
    };
    expect(last().path).toBe(`${H}/mailboxes/user1/auth/folders`);
    expect(Array.isArray(folders.data.folders)).toBe(true);
  });

  it("lists redirections and auto-replies of the hosting", async () => {
    await handleMailTool(client, "infomaniak_list_email_redirections", { mail_hosting_id: 100001 });
    expect(last().path).toBe(`${H}/redirections`);
    await handleMailTool(client, "infomaniak_list_auto_replies", { mail_hosting_id: 100001 });
    expect(last().path).toBe(`${H}/auto_replies`);
  });
});

describe("writing — what the client sends", () => {
  it("creates a mailbox with the documented body and no password", async () => {
    await handleMailTool(client, "infomaniak_create_mailbox", { mail_hosting_id: 100001, mailbox_name: "user8", note: "new", target: "current_user" });
    expect(last().method).toBe("POST");
    expect(last().path).toBe(`${H}/mailboxes`);
    expect(last().body).toEqual({ mailbox_name: "user8", note: "new", target: "current_user" });
  });

  it("updates a mailbox with PATCH and only the fields given", async () => {
    await handleMailTool(client, "infomaniak_update_mailbox", { mail_hosting_id: 100001, mailbox_name: "user1", has_responder: true });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe(`${H}/mailboxes/user1`);
    expect(last().body).toEqual({ has_responder: true });
  });

  it("deletes a mailbox by name", async () => {
    await handleMailTool(client, "infomaniak_delete_mailbox", { mail_hosting_id: 100001, mailbox_name: "user1" });
    expect(last().method).toBe("DELETE");
    expect(last().path).toBe(`${H}/mailboxes/user1`);
  });

  it("adds and removes an alias on the aliases route", async () => {
    await handleMailTool(client, "infomaniak_add_mailbox_alias", { mail_hosting_id: 100001, mailbox_name: "user1", alias: "sales" });
    expect([last().method, last().path, last().body]).toEqual(["POST", `${H}/mailboxes/user1/aliases`, { alias: "sales" }]);
    await handleMailTool(client, "infomaniak_delete_mailbox_alias", { mail_hosting_id: 100001, mailbox_name: "user1", alias: "sales" });
    expect([last().method, last().path]).toEqual(["DELETE", `${H}/mailboxes/user1/aliases/sales`]);
  });

  it("manages forwarding with POST, PUT and DELETE on forwarding_addresses", async () => {
    await handleMailTool(client, "infomaniak_add_mailbox_forwarding", { mail_hosting_id: 100001, mailbox_name: "user1", redirect_address: "me@example.org" });
    expect([last().method, last().body]).toEqual(["POST", { redirect_address: "me@example.org" }]);
    await handleMailTool(client, "infomaniak_update_mailbox_forwarding", { mail_hosting_id: 100001, mailbox_name: "user1", is_enabled: false });
    expect([last().method, last().body]).toEqual(["PUT", { is_enabled: false }]);
    await handleMailTool(client, "infomaniak_delete_mailbox_forwarding", { mail_hosting_id: 100001, mailbox_name: "user1" });
    expect([last().method, last().path]).toEqual(["DELETE", `${H}/mailboxes/user1/forwarding_addresses`]);
  });

  it("creates and deletes a redirection with name and targets", async () => {
    await handleMailTool(client, "infomaniak_create_email_redirection", { mail_hosting_id: 100001, name: "info", targets: ["a@example.org"] });
    expect([last().method, last().path, last().body]).toEqual(["POST", `${H}/redirections`, { name: "info", targets: ["a@example.org"] }]);
    await handleMailTool(client, "infomaniak_delete_email_redirection", { mail_hosting_id: 100001, redirection_id: "42" });
    expect([last().method, last().path]).toEqual(["DELETE", `${H}/redirections/42`]);
  });

  it("creates, updates and deletes an auto-reply", async () => {
    await handleMailTool(client, "infomaniak_create_auto_reply", { mail_hosting_id: 100001, name: "Holidays", message: "Back soon" });
    expect([last().method, last().path, last().body]).toEqual(["POST", `${H}/auto_replies`, { name: "Holidays", message: "Back soon", is_recurrent: false }]);
    await handleMailTool(client, "infomaniak_update_auto_reply", { mail_hosting_id: 100001, auto_reply_id: 7, name: "Back" });
    expect([last().method, last().path, last().body]).toEqual(["PATCH", `${H}/auto_replies/7`, { name: "Back" }]);
    await handleMailTool(client, "infomaniak_delete_auto_reply", { mail_hosting_id: 100001, auto_reply_id: 7 });
    expect([last().method, last().path]).toEqual(["DELETE", `${H}/auto_replies/7`]);
  });
});

describe("names that would leave their path segment", () => {
  it("a mailbox name with a slash or an @ is refused before any request", async () => {
    for (const bad of ["a/b", "user1@example.com", "../user2", "x?y", ""]) {
      await expect(handleMailTool(client, "infomaniak_get_mailbox", { mail_hosting_id: 100001, mailbox_name: bad })).rejects.toThrow(/mailbox_name/);
    }
    expect(replay.requests).toHaveLength(0);
  });

  it("an alias is a name, not an address", () => {
    expect(() => validate(MailboxNameSchema, { mail_hosting_id: 100001, mailbox_name: "ok.name+tag" })).not.toThrow();
    expect(() => validate(CreateMailboxSchema, { mail_hosting_id: 100001, mailbox_name: "info", password: "x" })).not.toThrow();
    expect(() => validate(CreateRedirectionSchema, { mail_hosting_id: 100001, name: "info", targets: [] })).toThrow(/target/);
  });

  it("the client encodes every segment it is handed", async () => {
    // Nothing is recorded for this name: the replay answers 404, which is
    // fine — what is checked is the path the request arrived on.
    await client.getMailbox(100001, "odd name").catch(() => undefined);
    expect(last().path).toBe(`${H}/mailboxes/odd%20name`);
  });
});

describe("the tool list", () => {
  it("every mail tool is in the server's list exactly once and routes to the mail handler", () => {
    const names = tools.map((t) => t.name);
    for (const tool of mailTools) {
      expect(names.filter((n) => n === tool.name)).toHaveLength(1);
      expect(MAIL_TOOL_NAMES.has(tool.name)).toBe(true);
    }
  });

  it("no tool asks for the numeric mailbox id the API never had", () => {
    for (const tool of tools) {
      const props = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
      expect(props, tool.name).not.toContain("mailbox_id");
      expect(props, tool.name).not.toContain("mail_id");
    }
  });
});
