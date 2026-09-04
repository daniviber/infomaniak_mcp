/**
 * A tool module bundles MCP tool definitions with the handler that executes them.
 * Modules are composed by `createMcpServer` in src/server.ts.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type ToolArgs = Record<string, unknown> | undefined;

export interface ToolModule {
  /** Tool definitions (JSON Schema input) exposed by this module. */
  readonly tools: Tool[];
  /** True when this module owns the named tool. */
  canHandle(name: string): boolean;
  /** Execute the named tool. Must validate `args` before use. */
  handle(name: string, args: ToolArgs): Promise<unknown>;
}
