import { describe, it, expect } from "vitest";
import { annotateTool, classifyTool, isToolAllowed, policyFromEnv, resolvePolicy } from "./policy.js";

describe("classifyTool", () => {
  it("classifies read tools", () => {
    for (const name of [
      "infomaniak_ping",
      "infomaniak_get_profile",
      "infomaniak_list_domains",
      "infomaniak_search_kdrive_files",
      "infomaniak_download_kdrive_file",
      "infomaniak_kchat_get_me",
      "infomaniak_kchat_list_teams",
      "infomaniak_calendar_list_events",
      "infomaniak_calendar_get_event",
    ]) {
      expect(classifyTool(name), name).toBe("read");
    }
  });

  it("classifies destructive tools", () => {
    for (const name of [
      "infomaniak_delete_dns_record",
      "infomaniak_empty_kdrive_trash",
      "infomaniak_delete_kdrive_trashed_file_permanently",
      "infomaniak_reboot_vps",
      "infomaniak_shutdown_vps",
      "infomaniak_reboot_dedicated_server",
      "infomaniak_remove_kdrive_favorite",
      "infomaniak_renew_domain",
      "infomaniak_kchat_delete_post",
      "infomaniak_calendar_delete_event",
      "infomaniak_api_call",
    ]) {
      expect(classifyTool(name), name).toBe("destructive");
    }
  });

  it("classifies everything else as write", () => {
    for (const name of [
      "infomaniak_create_mailbox",
      "infomaniak_update_mailbox",
      "infomaniak_upload_kdrive_file",
      "infomaniak_move_kdrive_file",
      "infomaniak_share_kdrive_file",
      "infomaniak_restore_kdrive_file",
      "infomaniak_boot_vps",
      "infomaniak_kchat_create_post",
      "infomaniak_calendar_create_event",
      "infomaniak_calendar_update_event",
    ]) {
      expect(classifyTool(name), name).toBe("write");
    }
  });
});

describe("annotateTool / isToolAllowed", () => {
  const base = { inputSchema: { type: "object" as const, properties: {} } };

  it("derives annotations and keeps explicit ones", () => {
    const read = annotateTool({ name: "infomaniak_list_x", description: "", ...base });
    expect(read.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });

    const explicit = annotateTool({ name: "infomaniak_list_x", description: "", ...base, annotations: { readOnlyHint: false } });
    expect(explicit.annotations?.readOnlyHint).toBe(false);
  });

  it("applies the policy", () => {
    const read = annotateTool({ name: "infomaniak_list_x", description: "", ...base });
    const write = annotateTool({ name: "infomaniak_create_x", description: "", ...base });
    const raw = annotateTool({ name: "infomaniak_api_call", description: "", ...base });

    const open = resolvePolicy({ allowRawApi: true });
    expect([read, write, raw].map((t) => isToolAllowed(t, open))).toEqual([true, true, true]);

    const def = resolvePolicy();
    expect([read, write, raw].map((t) => isToolAllowed(t, def))).toEqual([true, true, false]);

    const ro = resolvePolicy({ readOnly: true });
    expect([read, write, raw].map((t) => isToolAllowed(t, ro))).toEqual([true, false, false]);

    const roRaw = resolvePolicy({ readOnly: true, allowRawApi: true });
    expect(isToolAllowed(raw, roRaw)).toBe(true);
  });
});

describe("policyFromEnv", () => {
  it("parses truthy values", () => {
    expect(policyFromEnv({})).toEqual({ readOnly: false, allowRawApi: false });
    expect(policyFromEnv({ INFOMANIAK_READ_ONLY: "true", INFOMANIAK_ALLOW_RAW_API: "1" })).toEqual({ readOnly: true, allowRawApi: true });
    expect(policyFromEnv({ INFOMANIAK_READ_ONLY: "no", INFOMANIAK_ALLOW_RAW_API: "false" })).toEqual({ readOnly: false, allowRawApi: false });
  });
});
