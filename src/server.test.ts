/**
 * Integration tests for the MCP server: tool catalog, policy enforcement and routing.
 * Uses the SDK in-memory transport with a real MCP client.
 */

import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { buildToolCatalog, createMcpServer, McpServerOptions } from "./server.js";
import type { InfomaniakClient } from "./infomaniak-client.js";
import type { CalendarClient } from "./calendar-client.js";
import type { KChatClient } from "./kchat-client.js";

/** A client whose every method resolves with a marker of the method that was called. */
function proxyClient<T>(calls: string[] = []): { client: T; calls: string[] } {
  const client = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        return vi.fn(async (...args: unknown[]) => {
          calls.push(String(prop));
          return { result: "success", data: { called: String(prop), args } };
        });
      },
    },
  ) as T;
  return { client, calls };
}

async function connect(server: Server): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function setup(options: McpServerOptions = {}) {
  const api = proxyClient<InfomaniakClient>();
  const server = createMcpServer(api.client, options);
  return { api, server };
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((c) => c.text ?? "").join("\n");
}

describe("buildToolCatalog", () => {
  it("has unique tool names and annotations on every tool", () => {
    const { client } = proxyClient<InfomaniakClient>();
    const { client: calendar } = proxyClient<CalendarClient>();
    const { client: kchat } = proxyClient<KChatClient>();
    const catalog = buildToolCatalog(client, { calendarClient: calendar, kchatClient: kchat, policy: { allowRawApi: true } });

    const names = catalog.all.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of catalog.all) {
      expect(tool.name).toMatch(/^infomaniak_/);
      expect(tool.annotations).toBeDefined();
      expect(typeof tool.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations?.destructiveHint).toBe("boolean");
    }
  });

  it("hides the raw API tool by default and shows it when allowed", () => {
    const { client } = proxyClient<InfomaniakClient>();
    expect(buildToolCatalog(client).visible.map((t) => t.name)).not.toContain("infomaniak_api_call");
    expect(buildToolCatalog(client, { policy: { allowRawApi: true } }).visible.map((t) => t.name)).toContain("infomaniak_api_call");
  });

  it("exposes only read-only tools in read-only mode", () => {
    const { client } = proxyClient<InfomaniakClient>();
    const { client: calendar } = proxyClient<CalendarClient>();
    const catalog = buildToolCatalog(client, { calendarClient: calendar, policy: { readOnly: true } });
    expect(catalog.visible.length).toBeGreaterThan(10);
    for (const tool of catalog.visible) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
    const names = catalog.visible.map((t) => t.name);
    expect(names).toContain("infomaniak_list_kdrive_files");
    expect(names).toContain("infomaniak_download_kdrive_file");
    expect(names).toContain("infomaniak_calendar_list_events");
    expect(names).not.toContain("infomaniak_delete_kdrive_file");
    expect(names).not.toContain("infomaniak_upload_kdrive_file");
    expect(names).not.toContain("infomaniak_calendar_create_event");
    expect(names).not.toContain("infomaniak_reboot_vps");
  });

  it("only lists kChat and Calendar tools when their clients are configured", () => {
    const { client } = proxyClient<InfomaniakClient>();
    const without = buildToolCatalog(client).all.map((t) => t.name);
    expect(without.some((n) => n.startsWith("infomaniak_kchat_"))).toBe(false);
    expect(without.some((n) => n.startsWith("infomaniak_calendar_"))).toBe(false);

    const { client: calendar } = proxyClient<CalendarClient>();
    const { client: kchat } = proxyClient<KChatClient>();
    const withBoth = buildToolCatalog(client, { calendarClient: calendar, kchatClient: kchat }).all.map((t) => t.name);
    expect(withBoth).toContain("infomaniak_kchat_get_me");
    expect(withBoth).toContain("infomaniak_calendar_list_calendars");
  });

  it("marks destructive operations", () => {
    const { client } = proxyClient<InfomaniakClient>();
    const byName = new Map(buildToolCatalog(client, { policy: { allowRawApi: true } }).all.map((t) => [t.name, t]));
    for (const name of [
      "infomaniak_delete_dns_record",
      "infomaniak_delete_mailbox",
      "infomaniak_empty_kdrive_trash",
      "infomaniak_delete_kdrive_trashed_file_permanently",
      "infomaniak_reboot_vps",
      "infomaniak_shutdown_vps",
      "infomaniak_renew_domain",
      "infomaniak_api_call",
    ]) {
      expect(byName.get(name)?.annotations?.destructiveHint, name).toBe(true);
    }
    expect(byName.get("infomaniak_create_kdrive_directory")?.annotations?.destructiveHint).toBe(false);
    expect(byName.get("infomaniak_list_kdrive_files")?.annotations?.readOnlyHint).toBe(true);
  });
});

describe("createMcpServer over MCP", () => {
  it("lists the visible tools", async () => {
    const { server } = setup();
    const client = await connect(server);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("infomaniak_list_kdrive_files");
    expect(names).toContain("infomaniak_upload_kdrive_file");
    expect(names).not.toContain("infomaniak_api_call");
    await client.close();
  });

  it("routes kDrive tools to the client with validated arguments", async () => {
    const { server, api } = setup();
    const client = await connect(server);
    const result = await client.callTool({ name: "infomaniak_list_kdrive_files", arguments: { drive_id: 12, directory_id: 34, type: "file" } });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result));
    expect(parsed.data.called).toBe("listKDriveFiles");
    expect(parsed.data.args).toEqual([12, 34, { type: "file", cursor: undefined, limit: undefined, order_by: undefined, order: undefined }]);
    expect(api.calls).toEqual(["listKDriveFiles"]);
    await client.close();
  });

  it("defaults kDrive directory to the root (id 1)", async () => {
    const { server } = setup();
    const client = await connect(server);
    const result = await client.callTool({ name: "infomaniak_list_kdrive_files", arguments: { drive_id: 12 } });
    expect(JSON.parse(textOf(result)).data.args[1]).toBe(1);
    await client.close();
  });

  it("routes calendar tools to the calendar client", async () => {
    const calendar = proxyClient<CalendarClient>();
    const { server } = setup({ calendarClient: calendar.client });
    const client = await connect(server);
    const result = await client.callTool({
      name: "infomaniak_calendar_create_event",
      arguments: { title: "Réunion", start: "2025-05-28 10:00:00", end: "2025-05-28 11:00:00", attendees: ["a@example.com"] },
    });
    expect(result.isError).toBeFalsy();
    expect(calendar.calls).toEqual(["createEvent"]);
    await client.close();
  });

  it("returns validation errors instead of calling the API", async () => {
    const { server, api } = setup();
    const client = await connect(server);
    const result = await client.callTool({ name: "infomaniak_delete_kdrive_file", arguments: { drive_id: 12 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Validation error");
    expect(textOf(result)).toContain("file_id");
    expect(api.calls).toEqual([]);
    await client.close();
  });

  it("refuses the raw API tool unless explicitly allowed", async () => {
    const { server, api } = setup();
    const client = await connect(server);
    const result = await client.callTool({ name: "infomaniak_api_call", arguments: { method: "DELETE", endpoint: "/1/mail/1/mailbox/2" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("INFOMANIAK_ALLOW_RAW_API");
    expect(api.calls).toEqual([]);
    await client.close();
  });

  it("refuses write tools in read-only mode, even when called directly", async () => {
    const { server, api } = setup({ policy: { readOnly: true, allowRawApi: true } });
    const client = await connect(server);

    const write = await client.callTool({ name: "infomaniak_delete_kdrive_file", arguments: { drive_id: 1, file_id: 2 } });
    expect(write.isError).toBe(true);
    expect(textOf(write)).toContain("read-only");

    const rawPost = await client.callTool({ name: "infomaniak_api_call", arguments: { method: "POST", endpoint: "/1/x" } });
    expect(rawPost.isError).toBe(true);
    expect(textOf(rawPost)).toContain("GET");

    const rawGet = await client.callTool({ name: "infomaniak_api_call", arguments: { method: "GET", endpoint: "/1/profile" } });
    expect(rawGet.isError).toBeFalsy();

    const read = await client.callTool({ name: "infomaniak_get_kdrive_file", arguments: { drive_id: 1, file_id: 2 } });
    expect(read.isError).toBeFalsy();

    expect(api.calls).toEqual(["call", "getKDriveFile"]);
    await client.close();
  });

  it("reports unknown tools", async () => {
    const { server } = setup();
    const client = await connect(server);
    const result = await client.callTool({ name: "infomaniak_does_not_exist", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Unknown tool");
    await client.close();
  });

  it("has a handler for every listed tool", async () => {
    const calendar = proxyClient<CalendarClient>();
    const kchat = proxyClient<KChatClient>();
    const { server } = setup({ calendarClient: calendar.client, kchatClient: kchat.client, policy: { allowRawApi: true } });
    const client = await connect(server);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(90);
    for (const tool of tools) {
      const result = await client.callTool({ name: tool.name, arguments: {} });
      const text = textOf(result);
      expect(text, tool.name).not.toContain("Unknown");
      if (result.isError) expect(text, tool.name).toContain("Validation error");
    }
    await client.close();
  });
});
