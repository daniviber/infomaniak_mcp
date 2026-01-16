#!/usr/bin/env node

/**
 * Infomaniak MCP Server
 *
 * A Model Context Protocol server that provides tools for interacting
 * with the Infomaniak API - managing domains, email, hosting, kDrive, and more.
 *
 * Environment Variables:
 * - INFOMANIAK_API_TOKEN: Your Infomaniak API token (required)
 * - MCP_TRANSPORT: Transport mode - 'stdio' (default) or 'http'
 * - MCP_PORT: HTTP port when using http transport (default: 3000)
 * - MCP_SESSION_MODE: Session mode for HTTP - 'stateful' (default) or 'stateless'
 *
 * Get your API token from: https://manager.infomaniak.com/v3/ng/accounts/token/list
 */

import { InfomaniakClient } from "./infomaniak-client.js";
import { startStdioServer } from "./transports/stdio.js";
import { startHttpServer } from "./transports/http.js";

// Get API token from environment
const API_TOKEN = process.env.INFOMANIAK_API_TOKEN;

if (!API_TOKEN) {
  console.error("Error: INFOMANIAK_API_TOKEN environment variable is required");
  console.error("Get your API token from: https://manager.infomaniak.com/v3/ng/accounts/token/list");
  process.exit(1);
}

// Initialize the Infomaniak client
const client = new InfomaniakClient({ token: API_TOKEN });

// Get transport configuration from environment
const transport = process.env.MCP_TRANSPORT || "stdio";
const port = parseInt(process.env.MCP_PORT || "3000", 10);
const sessionMode = (process.env.MCP_SESSION_MODE || "stateful") as "stateful" | "stateless";

// Start the server with the selected transport
async function main() {
  if (transport === "http") {
    await startHttpServer(client, { port, sessionMode });
  } else if (transport === "stdio") {
    await startStdioServer(client);
  } else {
    console.error(`Error: Unknown transport '${transport}'. Use 'stdio' or 'http'.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
