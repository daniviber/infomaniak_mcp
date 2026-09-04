# Infomaniak MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for the
[Infomaniak API](https://developer.infomaniak.com/). It lets AI assistants such as Claude
manage Infomaniak services: domains and DNS, mail hosting, web hosting, **kDrive files**,
**kSuite Calendar events**, Swiss Backup, VPS, dedicated servers, certificates, invoices and kChat.

> **Security first.** Read [SECURITY_AUDIT.md](SECURITY_AUDIT.md). In short: the HTTP
> transport requires a shared secret, the generic API tool is disabled by default, a
> read-only mode exists, and every tool carries MCP annotations (`readOnlyHint`,
> `destructiveHint`). Use API tokens with the **minimum scopes** you need.

## ✨ Features

- 🌐 **Domains & DNS** – list domains, nameservers, full DNS record CRUD
- 📧 **Mail hosting** – mailboxes, aliases, redirections, autoresponder
- 🖥️ **Web hosting** – sites, databases, cron jobs, FTP accounts
- 💾 **kDrive** – browse, search, download, upload, move/copy/rename, trash & restore, share links, invitations, favourites, activity
- 📅 **Calendar** – list calendars, list/get/create/update/delete events (attendees, recurrence, timezones)
- 🔒 **Swiss Backup**, 🖧 **VPS & dedicated servers**, 📜 **SSL certificates**, 💰 **Invoicing**
- 💬 **kChat** (optional) – teams, channels, posts, users
- 🛡️ **Policy** – read-only mode, opt-in raw API tool, per-tool annotations
- 🔧 **Generic API call** (opt-in) for endpoints not covered by a dedicated tool

## 📋 Prerequisites

- Node.js 18 or higher
- An Infomaniak account and one or more API tokens

## 🔑 API tokens and scopes

Create tokens at **Manager → Account → API tokens**
(<https://manager.infomaniak.com/v3/ng/accounts/token/list>). Create **one token per
purpose** with the smallest scope set:

| Need | Scopes | Env variable |
|------|--------|--------------|
| Domains, mail hosting, web hosting, backups, servers, invoices | `domain`, `mail`, `web`, `swiss_backup`, `vps`, `dedicated`, `certificate`, `invoicing` (pick what you use) | `INFOMANIAK_API_TOKEN` |
| kDrive files | `drive` | `INFOMANIAK_API_TOKEN` |
| **Calendar of a mailbox** | `workspace:calendar`, `user_info` | `INFOMANIAK_CALENDAR_TOKEN` |

### Calendar of a specific mailbox

The Infomaniak Calendar API is **user scoped**: a token sees the calendars of the user who
created it. To work with the calendar of a given mailbox:

1. Log in to the Manager **as the user of that mailbox** (its e-mail address);
2. create a token with scopes `workspace:calendar` and `user_info`;
3. set it as `INFOMANIAK_CALENDAR_TOKEN`. The main token keeps serving everything else.

If you only need calendar access, the same token can be used for both variables.

## 📦 Installation

```bash
git clone <this repository>
cd infomaniak_mcp
npm install          # if npm 10 fails with "edgesOut": npx -y npm@12 install
npm run build
```

## ⚙️ Configuration

### Claude Desktop (stdio)

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "infomaniak": {
      "command": "node",
      "args": ["/path/to/infomaniak_mcp/build/index.js"],
      "env": {
        "INFOMANIAK_API_TOKEN": "token-with-drive-scope",
        "INFOMANIAK_CALENDAR_TOKEN": "token-of-the-mailbox-user",
        "INFOMANIAK_READ_ONLY": "false"
      }
    }
  }
}
```

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INFOMANIAK_API_TOKEN` | Yes | – | Main Infomaniak API token |
| `INFOMANIAK_CALENDAR_TOKEN` | No | main token | Token created as the mailbox user (`workspace:calendar user_info`) |
| `INFOMANIAK_DISABLE_CALENDAR` | No | `false` | Hide calendar tools |
| `INFOMANIAK_READ_ONLY` | No | `false` | Expose only read tools (list/get/search/download); `infomaniak_api_call` limited to GET |
| `INFOMANIAK_ALLOW_RAW_API` | No | `false` | Expose `infomaniak_api_call` (whole API surface of the token) |
| `KDRIVE_MAX_DOWNLOAD_BYTES` | No | `10485760` | Max size returned by `infomaniak_download_kdrive_file` |
| `KDRIVE_MAX_UPLOAD_BYTES` | No | `52428800` | Max size accepted by `infomaniak_upload_kdrive_file` |
| `KCHAT_HOST`, `KCHAT_TOKEN` | No | – | Enable kChat tools (`team.kchat.infomaniak.com`, personal access token) |
| `MCP_TRANSPORT` | No | `stdio` | `stdio` or `http` |
| `MCP_HOST` | No | `127.0.0.1` | HTTP bind address (use `0.0.0.0` only behind a TLS reverse proxy) |
| `MCP_PORT` / `PORT` | No | `3000` | HTTP port |
| `MCP_HTTP_AUTH_TOKEN` | HTTP: yes | – | Shared secret (≥ 16 chars) sent as `Authorization: Bearer …` |
| `MCP_HTTP_ALLOW_UNAUTHENTICATED` | No | `false` | Run HTTP without auth (loopback only, **not recommended**) |
| `MCP_ALLOWED_HOSTS` | No | loopback names | Comma-separated Host header allow-list (DNS rebinding protection) |
| `MCP_CORS_ORIGINS` | No | none | Comma-separated browser origins allowed to call the server (`*` refused) |
| `MCP_MAX_SESSIONS` | No | `100` | Max concurrent HTTP sessions |
| `MCP_SESSION_TTL_MS` | No | `1800000` | Idle session lifetime |
| `MCP_HTTP_BODY_LIMIT` | No | `20mb` | JSON body limit (uploads travel base64 in JSON-RPC) |
| `MCP_STATELESS` | No | `false` | Stateless HTTP mode (no sessions) |

See [`.env.example`](.env.example).

## 🌐 HTTP transport

```bash
export MCP_HTTP_AUTH_TOKEN=$(openssl rand -hex 32)
MCP_TRANSPORT=http MCP_PORT=3000 INFOMANIAK_API_TOKEN=... node build/index.js
```

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | no | Liveness check (`{"status":"ok"}`) |
| `/mcp` | POST | Bearer | JSON-RPC messages (`initialize`, `tools/list`, `tools/call`, …) |
| `/mcp` | GET | Bearer | SSE stream for server-to-client notifications (stateful mode) |
| `/mcp` | DELETE | Bearer | Terminate the session given in `Mcp-Session-Id` |

Requests without a valid `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>` get `401`. Requests
whose `Host` is not loopback (or not in `MCP_ALLOWED_HOSTS`) get `403`; browser requests from
origins not in `MCP_CORS_ORIGINS` get `403`.

```javascript
const headers = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  Authorization: `Bearer ${process.env.MCP_HTTP_AUTH_TOKEN}`,
};
const init = await fetch("http://127.0.0.1:3000/mcp", {
  method: "POST",
  headers,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "my-client", version: "1.0.0" } },
  }),
});
const sessionId = init.headers.get("Mcp-Session-Id");
await fetch("http://127.0.0.1:3000/mcp", {
  method: "POST",
  headers: { ...headers, "Mcp-Session-Id": sessionId },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
});
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY build ./build
ENV MCP_TRANSPORT=http MCP_HOST=0.0.0.0 MCP_PORT=3000
EXPOSE 3000
CMD ["node", "build/index.js"]
```

```bash
docker run -p 127.0.0.1:3000:3000 \
  -e INFOMANIAK_API_TOKEN=... \
  -e MCP_HTTP_AUTH_TOKEN="$(openssl rand -hex 32)" \
  -e MCP_ALLOWED_HOSTS=mcp.example.com \
  infomaniak-mcp
```

Terminate TLS in a reverse proxy in front of the container.

## 🛠️ Available tools

Every tool is annotated. Read tools (`list_`, `get_`, `search_`, `download_`) have
`readOnlyHint: true`; irreversible or high-impact tools (`delete_`, `empty_`, `reboot_`,
`shutdown_`, `remove_`, `renew_`) have `destructiveHint: true`.

### kDrive

Root directory id is `1`. List endpoints are paginated: pass back `cursor` while `has_more` is true.

| Tool | Description |
|------|-------------|
| `infomaniak_list_kdrives` / `infomaniak_get_kdrive` | Drives of an account / drive details |
| `infomaniak_list_kdrive_files` | List a directory (type filter, sort, cursor) |
| `infomaniak_get_kdrive_file` | File/directory metadata (path, size, mime, sharing) |
| `infomaniak_search_kdrive_files` | Search by name, scoped to a directory, depth, date range |
| `infomaniak_download_kdrive_file` | Download content (UTF-8 text auto-detected, else base64) |
| `infomaniak_upload_kdrive_file` | Upload text or base64 content into a directory |
| `infomaniak_create_kdrive_directory` | Create a directory |
| `infomaniak_move_kdrive_file` / `infomaniak_copy_kdrive_file` / `infomaniak_rename_kdrive_file` | Organise |
| `infomaniak_delete_kdrive_file` | Move to trash |
| `infomaniak_list_kdrive_trash` / `infomaniak_restore_kdrive_file` | Trash listing and restore |
| `infomaniak_delete_kdrive_trashed_file_permanently` / `infomaniak_empty_kdrive_trash` | Irreversible deletions |
| `infomaniak_share_kdrive_file` / `infomaniak_get_kdrive_share_link` / `infomaniak_update_kdrive_share_link` / `infomaniak_delete_kdrive_share_link` | Public share links (public / password / inherit, expiry, download/edit rights) |
| `infomaniak_invite_kdrive_access` / `infomaniak_list_kdrive_file_access` | Share with people by e-mail; list who has access |
| `infomaniak_list_kdrive_favorites` / `infomaniak_add_kdrive_favorite` / `infomaniak_remove_kdrive_favorite` | Favourites |
| `infomaniak_list_kdrive_recents` / `infomaniak_list_kdrive_shared_with_me` | Recent items, items shared with me |
| `infomaniak_get_kdrive_activity` | Activity log of a drive or a file |

### Calendar

Dates: `YYYY-MM-DD HH:mm:ss` (wall-clock in the calendar timezone) or ISO 8601 with offset.
`YYYY-MM-DD` alone covers a whole day in `list_events`.

| Tool | Description |
|------|-------------|
| `infomaniak_calendar_list_calendars` | Calendars of the calendar token owner |
| `infomaniak_calendar_list_events` | Events between `from` and `to` (optional `calendar_id`, `timezone`) |
| `infomaniak_calendar_get_event` | Full event details |
| `infomaniak_calendar_create_event` | Create (title, start, end, description, location, attendees, rrule, fullday, private) |
| `infomaniak_calendar_update_event` | Update provided fields only; `rrule: ""` removes recurrence |
| `infomaniak_calendar_delete_event` | Delete an event |

### Account, domains, DNS

`infomaniak_ping`, `infomaniak_get_profile`, `infomaniak_list_accounts`, `infomaniak_get_account`,
`infomaniak_list_products`, `infomaniak_list_domains`, `infomaniak_get_domain`,
`infomaniak_get_domain_nameservers`, `infomaniak_update_domain_nameservers`, `infomaniak_renew_domain`,
`infomaniak_list_dns_records`, `infomaniak_create_dns_record`, `infomaniak_update_dns_record`,
`infomaniak_delete_dns_record`

### Mail hosting

`infomaniak_list_mail_services`, `infomaniak_get_mail_service`, `infomaniak_list_mailboxes`,
`infomaniak_get_mailbox`, `infomaniak_create_mailbox`, `infomaniak_update_mailbox`,
`infomaniak_delete_mailbox`, `infomaniak_add_mailbox_alias`, `infomaniak_delete_mailbox_alias`,
`infomaniak_list_email_redirections`, `infomaniak_create_email_redirection`,
`infomaniak_delete_email_redirection`, `infomaniak_get_mailbox_autoresponder`,
`infomaniak_update_mailbox_autoresponder`, `infomaniak_list_mailbox_folders`

> These administrative mail endpoints were inherited from the original project and have not
> been verified against a live account (the official documentation uses
> `/1/mail_hostings/{id}/mailboxes/{mailbox_name}`). Test on a non-production hosting first.

### Web hosting

`infomaniak_list_web_hostings`, `infomaniak_get_web_hosting`, `infomaniak_list_sites`,
`infomaniak_get_site`, `infomaniak_create_site`, `infomaniak_update_site`, `infomaniak_delete_site`,
`infomaniak_list_databases`, `infomaniak_get_database`, `infomaniak_create_database`,
`infomaniak_delete_database`, `infomaniak_list_cron_jobs`, `infomaniak_create_cron_job`,
`infomaniak_update_cron_job`, `infomaniak_delete_cron_job`, `infomaniak_list_ftp_accounts`,
`infomaniak_create_ftp_account`, `infomaniak_update_ftp_account`, `infomaniak_delete_ftp_account`

### Backups, servers, certificates, invoices

`infomaniak_list_swiss_backups`, `infomaniak_get_swiss_backup`, `infomaniak_list_swiss_backup_slots`,
`infomaniak_list_vps`, `infomaniak_get_vps`, `infomaniak_reboot_vps`, `infomaniak_shutdown_vps`,
`infomaniak_boot_vps`, `infomaniak_list_dedicated_servers`, `infomaniak_get_dedicated_server`,
`infomaniak_reboot_dedicated_server`, `infomaniak_list_certificates`, `infomaniak_get_certificate`,
`infomaniak_list_invoices`, `infomaniak_get_invoice`

### kChat (when `KCHAT_HOST`/`KCHAT_TOKEN` are set)

`infomaniak_kchat_get_me`, `infomaniak_kchat_list_teams`, `infomaniak_kchat_list_my_teams`,
`infomaniak_kchat_list_channels`, `infomaniak_kchat_list_my_channels`, `infomaniak_kchat_get_channel`,
`infomaniak_kchat_get_channel_posts`, `infomaniak_kchat_create_post`, `infomaniak_kchat_delete_post`,
`infomaniak_kchat_search_posts`, `infomaniak_kchat_create_direct`, `infomaniak_kchat_search_users`,
`infomaniak_kchat_list_users`

### Advanced (opt-in)

`infomaniak_api_call` – arbitrary `GET/POST/PUT/PATCH/DELETE` on any endpoint. Hidden unless
`INFOMANIAK_ALLOW_RAW_API=true`; restricted to `GET` in read-only mode.

## 💬 Usage examples

```
"List the files in the 'Common documents' folder of my kDrive 12345"
"Search my kDrive for 'contrat 2025' and download the PDF"
"Upload this text as notes.md into folder 678 of kDrive 12345"
"Create a share link protected by a password for file 9876, valid until next Friday"
"What do I have in my calendar next week?"
"Create a meeting 'Point projet' on 2025-05-28 from 10:00 to 11:00 with a@example.com and b@example.com"
"Move the 'Budget' event to Thursday 14:00"
```

## 🔒 Security notes

- **Tokens with minimal scopes**, one per purpose. The server only talks to
  `https://api.infomaniak.com` (and `https://<KCHAT_HOST>` for kChat).
- **Start in read-only mode** (`INFOMANIAK_READ_ONLY=true`) while exploring.
- **Prompt injection**: file names, downloaded content, chat messages and event
  descriptions are third-party content that the model reads. Keep destructive tools
  disabled (read-only mode) when processing untrusted data.
- **Passwords** given to `create_mailbox`, `create_ftp_account` or password-protected
  share links pass through the conversation history.
- HTTP mode: always behind TLS, always with `MCP_HTTP_AUTH_TOKEN`, bind to loopback
  unless a reverse proxy sits in front.

## ⚠️ API rate limits

The Infomaniak API allows **60 requests per minute**. The client enforces a token bucket and
retries `429`/`5xx` responses with backoff.

## 🐛 Troubleshooting

| Message | Meaning |
|---------|---------|
| `INFOMANIAK_API_TOKEN environment variable is required` | Set the token in the MCP client configuration |
| `HTTP transport requires MCP_HTTP_AUTH_TOKEN` | Set a shared secret (or explicitly allow unauthenticated loopback use) |
| `Infomaniak API Error (401)` | Invalid or expired token |
| `Infomaniak API Error (403)` | Token lacks a scope (`drive`, `workspace:calendar`, …) |
| `Infomaniak API Error (429)` | Rate limit exceeded |
| `No calendar found for this token` | The calendar token must belong to the mailbox user and have `workspace:calendar user_info` |
| `Tool '…' is not available: read-only mode` | Unset `INFOMANIAK_READ_ONLY` to allow writes |
| `Only directory can be created here` (kDrive) | Files cannot be uploaded to the drive root; use a sub-directory |

## 🔧 Development

```bash
npm install
npm run typecheck
npm test
npm run build
INFOMANIAK_API_TOKEN=your-token npm run inspector
```

See [CLAUDE.md](CLAUDE.md) for the architecture and how to add a tool, and
[CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## 📄 License

MIT – see [LICENSE](LICENSE).

## 🔗 Resources

- [Infomaniak API documentation](https://developer.infomaniak.com/docs/api)
- Official Infomaniak MCP servers used as references: [kDrive](https://github.com/Infomaniak/mcp-server-kdrive), [Calendar](https://github.com/Infomaniak/mcp-server-calendar), [Mail](https://github.com/Infomaniak/mcp-server-mail)
- [Model Context Protocol](https://modelcontextprotocol.io/) · [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
