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
 * - MCP_STATELESS: Set to 'true' for stateless mode (default: false)
 * - INFOMANIAK_IMAP_USER, INFOMANIAK_IMAP_PASSWORD or INFOMANIAK_IMAP_PASSWORD_FILE:
 *   optional, to read the mailbox over IMAP (see src/imap-tools.ts)
 *
 * Get your API token from: https://manager.infomaniak.com/v3/ng/accounts/token/list
 */

import { InfomaniakClient } from "./infomaniak-client.js";
import { KChatClient } from "./kchat-client.js";
import { ImapReader, imapConfigFromEnv } from "./imap-tools.js";
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

// Optionally initialize the kChat client
const kchatHost = process.env.KCHAT_HOST;
const kchatToken = process.env.KCHAT_TOKEN;
const kchatClient = (kchatHost && kchatToken)
  ? new KChatClient({ host: kchatHost, token: kchatToken })
  : null;

// Optionally read the mailbox over IMAP; a user without a password stops the server here
let imapReader: ImapReader | null = null;
try {
  const imapConfig = imapConfigFromEnv();
  imapReader = imapConfig ? new ImapReader(imapConfig) : null;
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// Get transport configuration from environment
const transport = process.env.MCP_TRANSPORT || "stdio";
const port = parseInt(process.env.PORT || process.env.MCP_PORT || "3000", 10);
const stateless = process.env.MCP_STATELESS === "true";

// Start the server with the selected transport
async function main() {
  if (transport === "http") {
    await startHttpServer(client, { port, stateless }, kchatClient, imapReader);
  } else if (transport === "stdio") {
    await startStdioServer(client, kchatClient, imapReader);
  } else {
    console.error(`Error: Unknown transport '${transport}'. Use 'stdio' or 'http'.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
