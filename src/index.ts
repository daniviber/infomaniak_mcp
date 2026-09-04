#!/usr/bin/env node

/**
 * Infomaniak MCP Server
 *
 * A Model Context Protocol server that provides tools for interacting
 * with the Infomaniak API - managing domains, email, hosting, kDrive, Calendar and more.
 *
 * Environment Variables:
 * - INFOMANIAK_API_TOKEN:        Your Infomaniak API token (required)
 * - INFOMANIAK_CALENDAR_TOKEN:   Token with scopes `workspace:calendar user_info` created as the
 *                                mailbox user whose calendar you want (default: INFOMANIAK_API_TOKEN)
 * - INFOMANIAK_DISABLE_CALENDAR: 'true' to hide calendar tools
 * - INFOMANIAK_READ_ONLY:        'true' to expose only read tools (no create/update/delete)
 * - INFOMANIAK_ALLOW_RAW_API:    'true' to expose the generic infomaniak_api_call tool (default: hidden)
 * - KDRIVE_MAX_DOWNLOAD_BYTES:   Max file size for kDrive downloads (default 10 MiB)
 * - KDRIVE_MAX_UPLOAD_BYTES:     Max file size for kDrive uploads (default 50 MiB)
 * - KCHAT_HOST / KCHAT_TOKEN:    Optional kChat configuration
 * - MCP_TRANSPORT:               'stdio' (default) or 'http'
 * - MCP_HOST:                    HTTP bind address (default 127.0.0.1)
 * - MCP_PORT / PORT:             HTTP port (default 3000)
 * - MCP_HTTP_AUTH_TOKEN:         Shared secret required on every HTTP request (Authorization: Bearer)
 * - MCP_HTTP_ALLOW_UNAUTHENTICATED: 'true' to run HTTP without auth (loopback only, NOT recommended)
 * - MCP_ALLOWED_HOSTS:           Comma separated Host header allow-list (DNS rebinding protection)
 * - MCP_CORS_ORIGINS:            Comma separated browser origins allowed to call the server
 * - MCP_MAX_SESSIONS:            Max concurrent HTTP sessions (default 100)
 * - MCP_SESSION_TTL_MS:          Idle session lifetime in ms (default 1800000)
 * - MCP_STATELESS:               'true' for stateless HTTP mode
 *
 * Get your API token from: https://manager.infomaniak.com/v3/ng/accounts/token/list
 */

import { InfomaniakClient } from "./infomaniak-client.js";
import { KChatClient } from "./kchat-client.js";
import { CalendarClient } from "./calendar-client.js";
import { createMcpServer } from "./server.js";
import { isTruthy, policyFromEnv } from "./tools/policy.js";
import { startStdioServer } from "./transports/stdio.js";
import { startHttpServer } from "./transports/http.js";

const env = process.env;

function intFromEnv(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`Error: ${name} must be a positive integer (got "${raw}")`);
    process.exit(1);
  }
  return value;
}

function listFromEnv(name: string): string[] | undefined {
  const raw = env[name];
  if (!raw) return undefined;
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

// Get API token from environment
const API_TOKEN = env.INFOMANIAK_API_TOKEN;

if (!API_TOKEN) {
  console.error("Error: INFOMANIAK_API_TOKEN environment variable is required");
  console.error("Get your API token from: https://manager.infomaniak.com/v3/ng/accounts/token/list");
  process.exit(1);
}

// Initialize the Infomaniak client
const client = new InfomaniakClient({ token: API_TOKEN });

// Calendar client: dedicated token (mailbox user) or the main token
let calendarClient: CalendarClient | null = null;
if (!isTruthy(env.INFOMANIAK_DISABLE_CALENDAR)) {
  const calendarToken = env.INFOMANIAK_CALENDAR_TOKEN || API_TOKEN;
  calendarClient = new CalendarClient(calendarToken === API_TOKEN ? client : new InfomaniakClient({ token: calendarToken }));
}

// Optionally initialize the kChat client
const kchatHost = env.KCHAT_HOST;
const kchatToken = env.KCHAT_TOKEN;
const kchatClient = kchatHost && kchatToken ? new KChatClient({ host: kchatHost, token: kchatToken }) : null;

// Tool policy and limits
const policy = policyFromEnv(env);
const kdrive = {
  maxDownloadBytes: intFromEnv("KDRIVE_MAX_DOWNLOAD_BYTES", 10 * 1024 * 1024),
  maxUploadBytes: intFromEnv("KDRIVE_MAX_UPLOAD_BYTES", 50 * 1024 * 1024),
};

const createServer = () => createMcpServer(client, { kchatClient, calendarClient, policy, kdrive });

// Transport configuration
const transport = env.MCP_TRANSPORT || "stdio";

async function main() {
  console.error(
    `Policy: read-only=${policy.readOnly}, raw-api=${policy.allowRawApi}, calendar=${calendarClient ? "on" : "off"}, kchat=${kchatClient ? "on" : "off"}`,
  );

  if (transport === "http") {
    await startHttpServer(createServer, {
      port: intFromEnv("PORT", intFromEnv("MCP_PORT", 3000)),
      host: env.MCP_HOST || "127.0.0.1",
      stateless: isTruthy(env.MCP_STATELESS),
      authToken: env.MCP_HTTP_AUTH_TOKEN || undefined,
      allowUnauthenticated: isTruthy(env.MCP_HTTP_ALLOW_UNAUTHENTICATED),
      allowedHosts: listFromEnv("MCP_ALLOWED_HOSTS"),
      corsOrigins: listFromEnv("MCP_CORS_ORIGINS"),
      maxSessions: intFromEnv("MCP_MAX_SESSIONS", 100),
      sessionTtlMs: intFromEnv("MCP_SESSION_TTL_MS", 30 * 60_000),
      bodyLimit: env.MCP_HTTP_BODY_LIMIT || undefined,
    });
  } else if (transport === "stdio") {
    await startStdioServer(createServer);
  } else {
    console.error(`Error: Unknown transport '${transport}'. Use 'stdio' or 'http'.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
