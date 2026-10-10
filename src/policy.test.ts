/**
 * Tool annotations and the read-only policy — through the real protocol: the
 * SDK's in-memory transport links a real Client to the real server, and the
 * one read that goes out speaks HTTP to a replay of the API.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { InfomaniakClient } from "./infomaniak-client.js";
import { annotate, assertAllowed, classify, readOnlyFromEnv, verbOf, visibleTools, PolicyRefusal } from "./policy.js";
import { createMcpServer, tools, annotatedTools } from "./server.js";
import { ReplayServer } from "./test-support/replay-server.js";

describe("classification", () => {
  it("covers every tool the server has", () => {
    for (const tool of tools) expect(() => classify(tool.name), tool.name).not.toThrow();
    expect(annotatedTools).toHaveLength(tools.length);
    for (const tool of annotatedTools) {
      expect(tool.annotations, tool.name).toMatchObject({ openWorldHint: true });
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe("boolean");
      expect(typeof tool.annotations?.destructiveHint, tool.name).toBe("boolean");
    }
  });

  it.each([
    ["infomaniak_ping", { readOnlyHint: true, destructiveHint: false }],
    ["infomaniak_list_mailboxes", { readOnlyHint: true, destructiveHint: false }],
    ["infomaniak_get_mailbox", { readOnlyHint: true, destructiveHint: false }],
    ["infomaniak_search_kdrive_files", { readOnlyHint: true, destructiveHint: false }],
    ["infomaniak_kchat_list_teams", { readOnlyHint: true, destructiveHint: false }],
    ["infomaniak_create_mailbox", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
    ["infomaniak_update_dns_record", { readOnlyHint: false, destructiveHint: false, idempotentHint: true }],
    ["infomaniak_delete_mailbox", { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
    ["infomaniak_empty_kdrive_trash", { readOnlyHint: false, destructiveHint: true }],
    ["infomaniak_reboot_vps", { readOnlyHint: false, destructiveHint: true, idempotentHint: false }],
    ["infomaniak_shutdown_vps", { readOnlyHint: false, destructiveHint: true }],
    ["infomaniak_kchat_delete_post", { readOnlyHint: false, destructiveHint: true }],
    ["infomaniak_api_call", { readOnlyHint: false, destructiveHint: true, idempotentHint: false }],
  ])("%s", (name, expected) => {
    expect(classify(name)).toMatchObject(expected);
  });

  it("refuses to classify a verb it does not know, instead of guessing", () => {
    expect(verbOf("infomaniak_kchat_create_post")).toBe("create");
    expect(() => classify("infomaniak_frobnicate_things")).toThrow(/no classification/);
    expect(() => annotate([{ name: "infomaniak_frobnicate_things", inputSchema: { type: "object" } }])).toThrow();
  });
});

describe("the read-only mode", () => {
  it("is read from INFOMANIAK_READ_ONLY", () => {
    expect(readOnlyFromEnv({})).toBe(false);
    expect(readOnlyFromEnv({ INFOMANIAK_READ_ONLY: "false" })).toBe(false);
    for (const v of ["true", "1", "yes", " TRUE "]) expect(readOnlyFromEnv({ INFOMANIAK_READ_ONLY: v }), v).toBe(true);
  });

  it("offers only the read-only tools, and never the raw API call", () => {
    const offered = visibleTools(annotatedTools, true);
    expect(offered.length).toBeGreaterThan(30);
    expect(offered.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(offered.map((t) => t.name)).not.toContain("infomaniak_api_call");
    expect(offered.map((t) => t.name)).not.toContain("infomaniak_delete_mailbox");
    expect(visibleTools(annotatedTools, false)).toHaveLength(tools.length);
  });

  it("refuses a write and an unknown tool, allows a read", () => {
    expect(() => assertAllowed("infomaniak_list_mailboxes", annotatedTools, true)).not.toThrow();
    expect(() => assertAllowed("infomaniak_delete_mailbox", annotatedTools, true)).toThrow(PolicyRefusal);
    expect(() => assertAllowed("infomaniak_api_call", annotatedTools, true)).toThrow(/INFOMANIAK_READ_ONLY/);
    expect(() => assertAllowed("infomaniak_nope", annotatedTools, true)).toThrow(/unknown/);
    expect(() => assertAllowed("infomaniak_delete_mailbox", annotatedTools, false)).not.toThrow();
  });
});

describe("over the protocol", () => {
  const replay = new ReplayServer().on("GET", "/1/ping", { status: 200, body: { result: "success", data: { message: "pong" } } });
  let api: InfomaniakClient;

  beforeAll(async () => {
    api = new InfomaniakClient({ token: "test-token", baseUrl: await replay.start(), maxAttempts: 1 });
  });
  afterAll(() => replay.stop());

  async function connect(readOnly: boolean): Promise<Client> {
    const server = createMcpServer(api, null, { readOnly });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);
    return client;
  }

  it("lists every tool with its annotations", async () => {
    const client = await connect(false);
    const listed = (await client.listTools()).tools;
    expect(listed).toHaveLength(tools.length);
    const del = listed.find((t) => t.name === "infomaniak_delete_mailbox");
    expect(del?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const ping = listed.find((t) => t.name === "infomaniak_ping");
    expect(ping?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    await client.close();
  });

  it("in read-only mode lists reads only, answers a read, and refuses a write it did not list", async () => {
    const client = await connect(true);
    const listed = (await client.listTools()).tools;
    expect(listed.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(listed.map((t) => t.name)).not.toContain("infomaniak_api_call");

    const pong = await client.callTool({ name: "infomaniak_ping", arguments: {} });
    expect(pong.isError).toBeFalsy();
    expect(replay.requests.map((r) => r.path)).toEqual(["/1/ping"]);

    const refused = await client.callTool({ name: "infomaniak_delete_mailbox", arguments: { mail_id: 1, mailbox_id: 2 } });
    expect(refused.isError).toBe(true);
    const text = (refused.content as { type: string; text: string }[]).map((c) => c.text).join("");
    expect(text).toMatch(/^Refused: /);
    expect(text).toContain("INFOMANIAK_READ_ONLY");
    expect(replay.requests).toHaveLength(1);
    await client.close();
  });
});
