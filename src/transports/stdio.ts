/**
 * Stdio Transport Module
 *
 * Provides stdio-based transport for the MCP server.
 * This is the default transport mode for CLI-based MCP clients like Claude Desktop.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

/**
 * Start the MCP server with stdio transport
 *
 * @param createServer - Factory building a configured MCP server (see createMcpServer)
 */
export async function startStdioServer(createServer: () => Server): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("Infomaniak MCP Server running on stdio");
}
