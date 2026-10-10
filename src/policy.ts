/**
 * What each tool may do, said to the client — and a mode that holds it to it.
 *
 * MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`)
 * let a client tell "list the mailboxes" from "delete the mailbox" and ask
 * for confirmation on the second. This server declared none, so every tool
 * looked the same. The classification is by the verb in the tool's name and
 * is total: a tool whose verb is not known here fails at startup rather than
 * shipping unclassified.
 *
 * `INFOMANIAK_READ_ONLY=true` turns the hints into a rule: only read-only
 * tools are listed and callable; the raw `infomaniak_api_call`, which can do
 * anything with the token, is hidden entirely.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface Hints {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const READ = new Set(["ping", "get", "list", "search"]);
const DESTROY = new Set(["delete", "remove", "empty", "reboot", "shutdown"]);
const CREATE = new Set(["create", "add", "renew", "share", "copy"]);
const CHANGE = new Set(["update", "boot", "move", "rename", "restore", "set"]);

/** The verb of `infomaniak_list_mailboxes` is `list`; of `infomaniak_kchat_create_post`, `create`. */
export function verbOf(name: string): string {
  const rest = name.replace(/^infomaniak_(kchat_)?/, "");
  return rest.split("_")[0];
}

export function classify(name: string): Hints {
  if (name === "infomaniak_api_call") {
    // Any method on any endpoint: as destructive as the token allows.
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
  }
  const verb = verbOf(name);
  if (READ.has(verb)) return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  if (DESTROY.has(verb)) {
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: verb !== "reboot", openWorldHint: true };
  }
  if (CREATE.has(verb)) return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  if (CHANGE.has(verb)) return { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  throw new Error(`policy: no classification for the verb "${verb}" of tool ${name}`);
}

/** The same tools, each carrying its hints. Throws if one cannot be classified. */
export function annotate(tools: Tool[]): Tool[] {
  return tools.map((tool) => ({ ...tool, annotations: { ...(tool.annotations ?? {}), ...classify(tool.name) } }));
}

export function isReadOnly(tool: Tool): boolean {
  return tool.annotations?.readOnlyHint === true;
}

/** What a client may see: everything, or in read-only mode the read-only tools. */
export function visibleTools(tools: Tool[], readOnly: boolean): Tool[] {
  return readOnly ? tools.filter(isReadOnly) : tools;
}

export class PolicyRefusal extends Error {}

/** Throws when `name` may not be called under the policy. */
export function assertAllowed(name: string, tools: Tool[], readOnly: boolean): void {
  if (!readOnly) return;
  const tool = tools.find((t) => t.name === name);
  if (tool && isReadOnly(tool)) return;
  throw new PolicyRefusal(
    `${name} is not available: INFOMANIAK_READ_ONLY is set and this tool ` +
      (tool ? "changes or discloses more than a read" : "is unknown") +
      ". Unset INFOMANIAK_READ_ONLY to allow it.",
  );
}

export function readOnlyFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.INFOMANIAK_READ_ONLY ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
