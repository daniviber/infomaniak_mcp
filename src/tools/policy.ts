/**
 * Tool exposure policy and MCP tool annotations.
 *
 * Every tool is classified as `read`, `write` or `destructive` from its name and
 * receives the standard MCP annotations (readOnlyHint, destructiveHint, ...).
 * The policy decides which tools are exposed:
 *
 * - `readOnly` (INFOMANIAK_READ_ONLY=true): only read tools are listed/callable and
 *   the generic `infomaniak_api_call` is restricted to GET.
 * - `allowRawApi` (INFOMANIAK_ALLOW_RAW_API=true): exposes `infomaniak_api_call`,
 *   which gives the model the *whole* API surface of the token. Disabled by default.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type ToolKind = "read" | "write" | "destructive";

export interface ToolPolicy {
  readOnly: boolean;
  allowRawApi: boolean;
}

export const DEFAULT_POLICY: ToolPolicy = { readOnly: false, allowRawApi: false };

export const RAW_API_TOOL = "infomaniak_api_call";

const READ_RE = /^infomaniak_(?:kchat_|calendar_)?(?:ping$|get_|list_|search_|download_)/;
const DESTRUCTIVE_RE =
  /_(?:delete|empty|reboot|shutdown|remove|renew)_|_(?:delete|empty_trash|reboot|shutdown|remove)$|_permanently$/;

export function classifyTool(name: string): ToolKind {
  if (name === RAW_API_TOOL) return "destructive";
  if (READ_RE.test(name)) return "read";
  if (DESTRUCTIVE_RE.test(name)) return "destructive";
  return "write";
}

/** Add MCP annotations derived from the tool kind (explicit annotations win). */
export function annotateTool(tool: Tool): Tool {
  const kind = classifyTool(tool.name);
  return {
    ...tool,
    annotations: {
      readOnlyHint: kind === "read",
      destructiveHint: kind === "destructive",
      idempotentHint: kind === "read",
      openWorldHint: true,
      ...tool.annotations,
    },
  };
}

export function isToolAllowed(tool: Tool, policy: ToolPolicy): boolean {
  if (tool.name === RAW_API_TOOL && !policy.allowRawApi) return false;
  if (policy.readOnly) {
    // The raw API tool stays visible but is restricted to GET at call time.
    if (tool.name === RAW_API_TOOL) return true;
    return tool.annotations?.readOnlyHint === true;
  }
  return true;
}

export function resolvePolicy(partial?: Partial<ToolPolicy>): ToolPolicy {
  return { ...DEFAULT_POLICY, ...partial };
}

export function isTruthy(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): ToolPolicy {
  return {
    readOnly: isTruthy(env.INFOMANIAK_READ_ONLY),
    allowRawApi: isTruthy(env.INFOMANIAK_ALLOW_RAW_API),
  };
}
