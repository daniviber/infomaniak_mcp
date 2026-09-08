# Infomaniak MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for the
[Infomaniak API](https://developer.infomaniak.com/docs/api): accounts, DNS, kDrive files,
Calendar events, web hosting, Swiss Backup, certificates and invoices, behind an explicit
execution policy (read-only mode, experimental tools hidden by default, raw API disabled unless
enabled).

The server targets MCP revision **2026-07-28** (TypeScript SDK v2) over stdio or sessionless
HTTP, and still serves revision **2025-11-25** through dedicated entry points for clients that
have not migrated yet.

## Features

- **Accounts and profile** – ping, profile, accounts, products.
- **Domains and DNS** – list, create, update and delete DNS records; renew a domain; update
  nameservers.
- **kDrive** – browse, search, download and upload files (size-bounded); create, move, copy and
  rename; trash, restore and permanent deletion; share links, access invitations, favorites and
  activity.
- **Calendar** – list calendars, list events in a date range, create, read, update and delete
  events, with explicit time zones and daylight-saving handling.
- **Mail** – 21 tools for mailboxes, folders, messages, attachments, drafts and sending;
  recoverable trash and distinct irreversible deletion.
- **Hosting and services** – web hostings, sites and databases; Swiss Backup products and slots;
  SSL certificates; invoices.
- **kChat** – teams, channels, posts and users, when a kChat host and token are configured.
- **Experimental** (hidden by default) – mail hostings and mailboxes, VPS and dedicated servers,
  cron jobs, FTP accounts, invoice details, and a raw API call tool.

Every tool declares its input and output schemas, its classification (`read`, `write`,
`destructive`), its idempotence and its limits. The full catalogue, with the provenance of each
route, lives in [`product/inventory/tools.json`](product/inventory/tools.json).

## Prerequisites

- Node.js **20 or newer** (reference toolchain: Node 20.19.2, npm 9.2.0).
- An Infomaniak account and an API token.

## Getting your API tokens

1. Log in to the [Infomaniak Manager](https://manager.infomaniak.com).
2. Open **Account → API tokens**
   ([direct link](https://manager.infomaniak.com/v3/ng/accounts/token/list)).
3. Create a token with the scopes you need: `account`, `domain`, `mail`, `web`, `drive`,
   `swiss_backup`, `vps`, `dedicated`, `certificate`, `invoicing`.
4. Export it as `INFOMANIAK_API_TOKEN`.

The Calendar API is user-scoped: create the token **as the mailbox owner** whose calendar you
want to use, with the `workspace:calendar` and `user_info` scopes, and export it as
`INFOMANIAK_CALENDAR_TOKEN`. When it is not set, the main token is reused.

kChat needs both `KCHAT_HOST` (bare hostname, for example `your-team.kchat.infomaniak.com`) and
`KCHAT_TOKEN`; the kChat tools are visible and callable only when both are set.

## Installation

```sh
git clone <this repository>
cd infomaniak_mcp
npm ci
npm run build
```

`npm ci` installs the locked dependencies only; no system package is required. The build is
written to `build/`. `.env.example` documents every variable; the server does **not** load a
`.env` file by itself. Configure the variables in your MCP client or in your shell.

## Running

| MCP revision              | Transport | Command                            |
| ------------------------- | --------- | ---------------------------------- |
| 2026-07-28                | stdio     | `node build/main/stdio.js`         |
| 2026-07-28                | HTTP      | `node build/main/http.js`          |
| 2025-11-25                | stdio     | `node build/main/legacy.js`        |
| 2025-11-25 and 2026-07-28 | HTTP      | `node build/main/legacy.js --http` |

`npm start` and the `infomaniak-mcp-server` binary run `build/main/stdio.js`. The 2026-only
entry points reject clients that negotiate `2025-11-25`; for those clients use `legacy.js`. Its
HTTP mode routes each request to the matching protocol era behind the same security checks, with
one registry and one configuration.

### Claude Desktop and Claude Code (stdio)

```json
{
  "mcpServers": {
    "infomaniak": {
      "command": "node",
      "args": ["/path/to/infomaniak_mcp/build/main/legacy.js"],
      "env": {
        "INFOMANIAK_API_TOKEN": "your-api-token",
        "INFOMANIAK_CALENDAR_TOKEN": "calendar-owner-token"
      }
    }
  }
}
```

### HTTP

HTTP is sessionless: `POST /mcp` only, no session identifiers, no `GET`/SSE stream, no
resumption. Every request must carry `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>` and an allowed
`Host` header (and `Origin`, when present); the body is size-limited before it is parsed. A new
server instance handles each request.

```sh
MCP_HOST=0.0.0.0 MCP_PORT=8787 MCP_ALLOWED_HOSTS=mcp.example.com \
MCP_HTTP_AUTH_TOKEN=<random-secret> INFOMANIAK_API_TOKEN=<token> \
node build/main/legacy.js --http
```

Terminate TLS in a reverse proxy in front of the server and keep the bearer secret. Claude Code
can then use the endpoint directly:

```sh
claude mcp add --transport http infomaniak https://mcp.example.com/mcp \
  --header "Authorization: Bearer <random-secret>"
```

## Configuration

| Variable                                                    | Default / effect                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `INFOMANIAK_API_TOKEN`                                      | Required; main token                                                |
| `INFOMANIAK_CALENDAR_TOKEN`                                 | Optional; token of the mailbox owner, falls back to the main token  |
| `KCHAT_HOST`, `KCHAT_TOKEN`                                 | Optional pair; bare hostname, no scheme or path                     |
| `INFOMANIAK_READ_ONLY`                                      | `false`                                                             |
| `INFOMANIAK_ALLOW_EXPERIMENTAL`, `INFOMANIAK_ALLOW_RAW_API` | `false`                                                             |
| `INFOMANIAK_TIMEOUT_MS`                                     | `30000`, positive integer                                           |
| `MCP_TOOLS_TTL_MS`                                          | `60000`, integer ≥ 0; private `tools/list` cache                    |
| `KDRIVE_MAX_DOWNLOAD_BYTES`                                 | `10485760` (10 MiB)                                                 |
| `KDRIVE_MAX_UPLOAD_BYTES`                                   | `52428800` (50 MiB)                                                 |
| `MCP_HTTP_BODY_LIMIT`                                       | `20971520` (20 MiB), minimum 65536; `b`/`kb`/`mb`/`gb` accepted     |
| `MCP_HOST`                                                  | `127.0.0.1`                                                         |
| `MCP_PORT`                                                  | `3000`; `PORT` is used when `MCP_PORT` is absent                    |
| `MCP_HTTP_AUTH_TOKEN`                                       | ≥ 16 characters; required unless the loopback exception below       |
| `MCP_HTTP_ALLOW_UNAUTHENTICATED`                            | `false`; `true` is accepted only when bound to loopback             |
| `MCP_ALLOWED_HOSTS`                                         | `localhost,127.0.0.1,[::1]`                                         |
| `MCP_CORS_ORIGINS`                                          | Empty; comma-separated explicit origins                             |

Booleans accept `true/false`, `1/0`, `yes/no`, `on/off`. Leave optional variables **unset**
rather than empty. There is no `MCP_TRANSPORT`, `MCP_STATELESS` or session option: the entry
point selects the transport.

## Execution policy

- `INFOMANIAK_ALLOW_EXPERIMENTAL=true` makes experimental tools visible **and** callable.
- `INFOMANIAK_ALLOW_RAW_API=true` is additionally required for `infomaniak_api_call`.
- `INFOMANIAK_READ_ONLY=true` keeps the catalogue unchanged but refuses `write` and
  `destructive` calls; for the raw API tool it only allows `GET`. kChat searches are `POST`
  requests classified as reads.

A refused call returns `isError: true`, the text `[POLICY_DENIED] <reason>: <toolName>` and
`structuredContent: { error: { code: "POLICY_DENIED", reason, tool } }`, before any provider
request. Classifications come from the tool declarations, never from the tool name.

A successful call returns the domain object as `structuredContent` and the same JSON, indented
with two spaces, as text. Provider responses are validated against typed DTOs and projected onto
domain models; unknown provider fields are not passed through. The only exception is
`infomaniak_api_call`, which returns `{ method, endpoint, status, data }` with `data` validated as
JSON only.

## Available tools

**83 tools** are visible by default. With both flags set and kChat configured, all **132** are.

### Accounts, domains and DNS

| Tool                                 | Class       |
| ------------------------------------ | ----------- |
| `infomaniak_ping`                    | read        |
| `infomaniak_get_profile`             | read        |
| `infomaniak_list_accounts`           | read        |
| `infomaniak_get_account`             | read        |
| `infomaniak_list_products`           | read        |
| `infomaniak_list_dns_records`        | read        |
| `infomaniak_create_dns_record`       | write       |
| `infomaniak_update_dns_record`       | write       |
| `infomaniak_delete_dns_record`       | destructive |
| `infomaniak_renew_domain`            | write       |
| `infomaniak_update_domain_nameservers` | write     |

### kDrive

| Tool                                              | Class       |
| ------------------------------------------------- | ----------- |
| `infomaniak_list_kdrives`                         | read        |
| `infomaniak_get_kdrive`                           | read        |
| `infomaniak_list_kdrive_files`                    | read        |
| `infomaniak_get_kdrive_file`                      | read        |
| `infomaniak_search_kdrive_files`                  | read        |
| `infomaniak_download_kdrive_file`                 | read        |
| `infomaniak_upload_kdrive_file`                   | write       |
| `infomaniak_create_kdrive_directory`              | write       |
| `infomaniak_move_kdrive_file`                     | write       |
| `infomaniak_copy_kdrive_file`                     | write       |
| `infomaniak_rename_kdrive_file`                   | write       |
| `infomaniak_delete_kdrive_file`                   | destructive |
| `infomaniak_list_kdrive_trash`                    | read        |
| `infomaniak_restore_kdrive_file`                  | write       |
| `infomaniak_delete_kdrive_trashed_file_permanently` | destructive |
| `infomaniak_empty_kdrive_trash`                   | destructive |
| `infomaniak_share_kdrive_file`                    | write       |
| `infomaniak_get_kdrive_share_link`                | read        |
| `infomaniak_update_kdrive_share_link`             | write       |
| `infomaniak_delete_kdrive_share_link`             | destructive |
| `infomaniak_invite_kdrive_access`                 | write       |
| `infomaniak_list_kdrive_file_access`              | read        |
| `infomaniak_list_kdrive_shared_with_me`           | read        |
| `infomaniak_list_kdrive_recents`                  | read        |
| `infomaniak_list_kdrive_favorites`                | read        |
| `infomaniak_add_kdrive_favorite`                  | write       |
| `infomaniak_remove_kdrive_favorite`               | write       |
| `infomaniak_get_kdrive_activity`                  | read        |

Directory listing, search and trash are paginated: `limit` 1..200 (default 50) and a `cursor` to
pass back while `hasMore` is true. The root directory id is `1`.

### Mail

All 21 tools below are visible by default, with fixed base
`https://mail.infomaniak.com/api`. Export optional `INFOMANIAK_MAIL_TOKEN`; when unset,
`INFOMANIAK_API_TOKEN` is reused. An empty dedicated token is invalid.

| Tool (prefix `infomaniak_mail_`) | Class | Idempotent |
| --- | --- | --- |
| `list_mailboxes` | read | true |
| `list_folders` | read | true |
| `list_messages` | read | true |
| `get_message` | read | true |
| `search_messages` | read | true |
| `download_attachment` | read | true |
| `create_draft` | write | false |
| `update_draft` | write | true |
| `send_draft` | write | false |
| `send_message` | write | false |
| `list_drafts` | read | true |
| `delete_draft` | destructive | false |
| `mark_seen` | write | true |
| `flag` | write | true |
| `move` | write | false |
| `archive` | write | false |
| `delete` | write | false |
| `delete_permanently` | destructive | false |
| `create_folder` | write | false |
| `rename_folder` | write | true |
| `delete_folder` | destructive | false |

`delete` moves messages to the recursively resolved TRASH folder and is recoverable;
`delete_permanently` performs irreversible deletion. ARCHIVE, TRASH and DRAFT resolution
fails locally for missing or ambiguous roles. Read-only policy rejects every mutation before
any folder or sender lookup. `list_drafts` remains readable, including its DRAFT lookup.
Supply simple `uids` and a separate `folderId`, never `uid@folderId`; the adapter constructs
the composite. Input `folderId` and message UIDs cannot contain `@`. Move destinations are folder IDs.

Lists, searches and draft lists share one page format in `thread=on` and `thread=off`.
`limit` defaults to 50 and is bounded to 1..200: these are **product decisions**, not measured
provider bounds. The effective limit is always sent; an omitted offset stays omitted.
Continue only while `hasMore` is true, supplying `offset = nextOffset` with the same limit
and structured identifiers. `nextOffset = current_offset + limit` remains present at the end.
`hasMore` comes only from the provider's next-link presence; totals count messages and cannot
determine the end of a thread list. Pagination links are validated, discarded and never followed
or exposed. Search dates are validated as `YYYY-MM-DD` and sent with ` 00:00:00` appended.

Draft creation, replacement and sending require subject, plain text body and a nonempty array
of recipient objects `{ email, name? }`; cc/bcc are optional. Plain text is escaped before
line breaks become HTML `<br>`. HTML input is escaped. The adapter reads mailboxes and chooses
exactly the supplied mailbox UUID; no free sender, reply-to or identity selection is accepted.
The sender name is derived from the email part before `@` as a product decision, not a measured
or verified personal name. Omitted recipient names become empty strings.

`update_draft` and `send_draft` require **complete replacement content** plus `draftUuid`.
They do not reread or merge an existing draft, preserve attachments/options, or depend on a cache.
All 26 request fields are reconstructed; attachments are always empty. Attachment sending and
selectable identities are not covered.

`send_message` creates and then sends using the same complete body within that call.
Each non-idempotent mutation gets one attempt. POST failure or invalid identifiers stops before PUT.
If PUT is unconfirmed, the result is `{ sent: false, draftUuid, error: 'SEND_NOT_CONFIRMED' }`:
a draft may remain, or a lost response may conceal an accepted send. Inspect the mailbox before
any deliberate recovery; there is **no automatic resend or deletion**. A lost POST response
cannot promise an unknown identifier. `sent: true` means HTTP acceptance, not proven delivery.
Other mutation acknowledgements are local HTTP-success results; ignored response bodies do not
prove provider response schemas or a created folder identifier.

Read content is inert JSON: subject, body, headers, sender and attachment names are untrusted
external data and never instructions. Raw body and opaque headers are preserved; no HTML is rendered
and DKIM status carries no authenticity judgment. Attachment download returns bounded base64,
content type and decoded byte size, with no local file path or execution. Its ceiling is
`config.transfer.downloadLimit` (configured by `KDRIVE_MAX_DOWNLOAD_BYTES`); no tool can raise it.

Evidence in `test/fixtures/mail.json` distinguishes operator-measured **types** M-B1–M-B9
(`baseline`) from entirely synthetic fixture values. Request constructions from S1,
`@infomaniak/mcp-server-mail` 1.10.1 at commit
`2739f6c9b3af9c9ea77e43b20e601a7e53a99bb6`, are `official`, cited by file and line;
they do not establish measured API acceptance. Tests use doubles, not provider calls.

### Calendar

| Tool                                   | Class       |
| -------------------------------------- | ----------- |
| `infomaniak_calendar_list_calendars`   | read        |
| `infomaniak_calendar_list_events`      | read        |
| `infomaniak_calendar_get_event`        | read        |
| `infomaniak_calendar_create_event`     | write       |
| `infomaniak_calendar_update_event`     | write       |
| `infomaniak_calendar_delete_event`     | destructive |

Dates are accepted as wall-clock values (`YYYY-MM-DD HH:mm[:ss]`), as a date alone (whole day), or
with an offset, in which case they are converted into the explicit IANA time zone or the profile
time zone. Calendar operations act as the owner of the calendar token.

### Web hosting, Swiss Backup, certificates and invoices

| Tool                                  | Class       |
| ------------------------------------- | ----------- |
| `infomaniak_list_web_hostings`        | read        |
| `infomaniak_get_web_hosting`          | read        |
| `infomaniak_list_sites`               | read        |
| `infomaniak_get_site`                 | read        |
| `infomaniak_create_site`              | write       |
| `infomaniak_update_site`              | write       |
| `infomaniak_delete_site`              | destructive |
| `infomaniak_list_databases`           | read        |
| `infomaniak_get_database`             | read        |
| `infomaniak_create_database`          | write       |
| `infomaniak_delete_database`          | destructive |
| `infomaniak_list_swiss_backups`       | read        |
| `infomaniak_get_swiss_backup`         | read        |
| `infomaniak_list_swiss_backup_slots`  | read        |
| `infomaniak_list_certificates`        | read        |
| `infomaniak_get_certificate`          | read        |
| `infomaniak_list_invoices`            | read        |

Product listings (`list_web_hostings`, `list_swiss_backups`, `list_certificates`, `list_kdrives`)
require an `account_id`, as the API does.

### kChat (requires `KCHAT_HOST` and `KCHAT_TOKEN`)

`infomaniak_kchat_get_me`, `infomaniak_kchat_list_teams`, `infomaniak_kchat_list_my_teams`,
`infomaniak_kchat_list_channels`, `infomaniak_kchat_list_my_channels`,
`infomaniak_kchat_get_channel`, `infomaniak_kchat_get_channel_posts`,
`infomaniak_kchat_search_posts`, `infomaniak_kchat_list_users`, `infomaniak_kchat_search_users`,
`infomaniak_kchat_create_direct`, `infomaniak_kchat_create_post`, `infomaniak_kchat_delete_post`.

### Experimental (requires `INFOMANIAK_ALLOW_EXPERIMENTAL=true`)

Routes in this group are not established by an official Infomaniak source, or have not been
confirmed against the live API. They are hidden and refused by default.

- **Mail** – `infomaniak_list_mail_services`, `infomaniak_get_mail_service`,
  `infomaniak_list_mailboxes`, `infomaniak_get_mailbox`, `infomaniak_create_mailbox`,
  `infomaniak_update_mailbox`, `infomaniak_delete_mailbox`, `infomaniak_add_mailbox_alias`,
  `infomaniak_delete_mailbox_alias`, `infomaniak_list_mailbox_folders`,
  `infomaniak_get_mailbox_autoresponder`, `infomaniak_update_mailbox_autoresponder`,
  `infomaniak_list_email_redirections`, `infomaniak_create_email_redirection`,
  `infomaniak_delete_email_redirection`.
- **Domains** – `infomaniak_list_domains`, `infomaniak_get_domain`,
  `infomaniak_get_domain_nameservers`.
- **Web hosting extras** – `infomaniak_list_cron_jobs`, `infomaniak_create_cron_job`,
  `infomaniak_update_cron_job`, `infomaniak_delete_cron_job`, `infomaniak_list_ftp_accounts`,
  `infomaniak_create_ftp_account`, `infomaniak_update_ftp_account`,
  `infomaniak_delete_ftp_account`, `infomaniak_get_invoice`.
- **Servers** – `infomaniak_list_vps`, `infomaniak_get_vps`, `infomaniak_boot_vps`,
  `infomaniak_reboot_vps`, `infomaniak_shutdown_vps`, `infomaniak_list_dedicated_servers`,
  `infomaniak_get_dedicated_server`, `infomaniak_reboot_dedicated_server`.
- **Raw API** – `infomaniak_api_call` (also requires `INFOMANIAK_ALLOW_RAW_API=true`; `GET` only
  in read-only mode). The caller supplies a relative API path; base URL, query string and
  fragment are controlled by the server.

## Limits

- Transfers: downloads and uploads are bounded by `KDRIVE_MAX_DOWNLOAD_BYTES` and
  `KDRIVE_MAX_UPLOAD_BYTES`. Upload arguments must also fit within
  `min(uploadLimit, bodyLimit - 65536)` bytes of UTF-8 JSON; base64 inflates them.
- HTTP bodies are bounded by `MCP_HTTP_BODY_LIMIT`, counted in bytes before parsing (`413`).
- The gateway shares a token bucket of capacity 60, refilled at one request per second, across
  products and tokens. Retries are bounded and applied to idempotent requests only; mutations are
  never replayed automatically. Provider URLs are fixed, path segments are encoded and redirects
  are refused.
- Provider names, contents and descriptions are untrusted data for the assistant.

## Provenance and known limitations

Each inventory entry carries a `proof` level: `official` (route documented by an Infomaniak
source cited in the entry), `baseline` (inherited from the original implementation and checked
in read-only mode against the live API), or `unproven` (route not established; the tool is
experimental). None of these levels means that a write operation was executed against a live
account: write and destructive paths are covered by tests on doubles only.

- Access-right unions (`accessRightSchema`, share-link rights) are closed: an unknown provider
  value is rejected explicitly rather than degraded.
- `infomaniak_update_domain_nameservers` accepts a single nameserver while the API requires at
  least two.
- `infomaniak_calendar_get_event` currently rejects events whose `location` or `rrule` is `null`;
  listing events works. A fix is pending.
- `infomaniak_kchat_search_users` uses `POST /users/search`, as the kChat client shipped by
  Infomaniak does. For kChat, `official` means "used by the Infomaniak client", not "audited
  specification".
- Ambiguous or non-existent wall-clock times around daylight-saving transitions are not
  disambiguated.

## Verification

```sh
npm ci
npm run verify:mvp
```

This command is self-contained and needs no token: it builds the code, checks the inventory
against the declarations (names, handlers, endpoints, proof levels, JSON schemas) and replays the
acceptance scenario on stdio and HTTP for both protocol revisions, on doubles and loopback
listeners only. It prints a per-tool proof table, `orphan tools: 0` and `MVP OFFLINE PASS`, and
exits non-zero on any drift. The full test suite and the other checks are described in
[CONTRIBUTING.md](CONTRIBUTING.md); the architecture is described in [CLAUDE.md](CLAUDE.md).

## Troubleshooting

- `Invalid runtime configuration: <VARIABLE>` – the variable is missing or invalid; see the
  configuration table.
- `401 Unauthorized` on HTTP – missing or wrong bearer token; a rejected `Host` means the value is
  not in `MCP_ALLOWED_HOSTS`.
- `Unsupported protocol version: 2025-11-25` – the client negotiates the 2025 revision; use
  `build/main/legacy.js`.
- `Infomaniak HTTP 401 / 403 / 429` – invalid token, missing scope, or rate limit
  (60 requests per minute) on the provider side.
- `Invalid Infomaniak response: <path>: <code>` – the provider payload does not match the
  expected shape. The message lists field paths and validation codes only, never values; please
  report it with the tool name.

## License

MIT – see [LICENSE](LICENSE).

## Resources

- [Infomaniak API documentation](https://developer.infomaniak.com/docs/api)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
