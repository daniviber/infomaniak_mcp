/**
 * Stdio Transport Module
 *
 * Provides stdio-based transport for the MCP server.
 * This is the default transport mode for CLI-based MCP clients like Claude Desktop.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InfomaniakClient } from "../infomaniak-client.js";
import { createMcpServer } from "../server.js";

/**
 * Start the MCP server with stdio transport
 *
 * @param client - The Infomaniak API client
 */
export async function startStdioServer(client: InfomaniakClient): Promise<void> {
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("Infomaniak MCP Server running on stdio");
}
