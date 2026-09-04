# CLAUDE.md - Infomaniak MCP Server

This file provides guidance to Claude Code when working with this codebase.

## Project Overview

MCP (Model Context Protocol) server for the Infomaniak API. It lets AI assistants manage
Infomaniak services: domains and DNS, mail hosting, web hosting, kDrive files, kSuite
Calendar events, Swiss Backup, VPS, dedicated servers, SSL certificates, invoicing and kChat.

Read `SECURITY_AUDIT.md` before changing anything security related (transport, policy, tokens).

## Tech Stack

- **Language**: TypeScript (ES2022), Node16 ESM, Node.js >= 18
- **Key dependencies**: `@modelcontextprotocol/sdk` (>= 1.30), `zod`, `express`, `cors`
- **Tests**: Vitest (+ supertest for HTTP)
- **Build output**: `./build/` (tests excluded via `tsconfig.build.json`)

## Project Structure

```
src/
├── index.ts                  # Entry point: env parsing, clients, policy, transport selection
├── server.ts                 # createMcpServer(): core tools + module composition + policy enforcement
├── infomaniak-client.ts      # Infomaniak REST client (rate limit, retries, JSON + binary requests)
├── calendar-client.ts        # kSuite Calendar client (/1/calendar/pim/*), date/timezone helpers
├── kchat-client.ts           # kChat (Mattermost-compatible) client
├── schemas.ts                # Zod schemas for every tool input + validate()
├── tools/
│   ├── module.ts             # ToolModule interface (tools + canHandle + handle)
│   ├── policy.ts             # read/write/destructive classification, annotations, read-only / raw-API policy
│   ├── kdrive.ts             # kDrive tool module (28 tools)
│   └── calendar.ts           # Calendar tool module (6 tools)
└── transports/
    ├── stdio.ts              # stdio transport (default)
    └── http.ts               # Streamable HTTP transport: bearer auth, Host/Origin checks, session store
```

## Build and Run Commands

```bash
npm install            # (if npm 10 fails with "edgesOut", use: npx -y npm@12 install)
npm run build          # Compile to build/ (tsconfig.build.json)
npm run dev            # Watch mode
npm start              # Run the built server
npm test               # Unit + integration tests (vitest)
npm run typecheck      # tsc --noEmit (includes tests)
npm audit              # Must stay at 0 vulnerabilities
npm run inspector      # MCP Inspector (requires INFOMANIAK_API_TOKEN)
```

## Architecture

### Tool catalog and policy (`src/server.ts`, `src/tools/policy.ts`)
- `buildToolCatalog()` merges the core `tools` array with the tool modules, annotates every
  tool (`readOnlyHint`, `destructiveHint`, ...) from its **name** (`classifyTool`), and
  filters by policy:
  - `INFOMANIAK_READ_ONLY=true` → only `readOnlyHint` tools are listed *and* callable.
  - `infomaniak_api_call` is hidden unless `INFOMANIAK_ALLOW_RAW_API=true`; in read-only
    mode it only accepts `GET`.
  - kChat / Calendar tools appear only when their client is configured.
- `createMcpServer(client, options)` enforces the policy in the `tools/call` handler too
  (never rely on listing alone).

### API clients
- `InfomaniakClient` (`https://api.infomaniak.com`, fixed): token bucket 60 req/min, retries on
  429/5xx, 30 s timeout. `request()` for JSON, `requestBinary()` for uploads/downloads
  (size caps). **Always** wrap string path segments with `seg()`.
- kDrive endpoints follow Infomaniak's official `mcp-server-kdrive` / Android app: v3
  `/3/drive/{id}/files/{dir}/files`, `/files/{parent}/directory`, `/files/{id}/move/{dest}`,
  `/files/{id}/copy/{dest}`, `/upload`, `/trash`; v2 `/files/{id}/rename`, `/files/{id}`
  (DELETE), `/files/{id}/link`, `/files/{id}/download`, `/trash/{id}/restore`. Root dir id = 1.
- `CalendarClient` wraps an `InfomaniakClient` (possibly with a different token). The API is
  user scoped; dates are `YYYY-MM-DD HH:mm:ss` wall-clock + IANA timezone (`toApiDateTime`).

### HTTP transport (`src/transports/http.ts`)
- `createHttpApp(createServer, options)` is the testable core; `startHttpServer` listens.
- Auth token mandatory (`MCP_HTTP_AUTH_TOKEN`), loopback bind by default, Host header
  validation (SDK middleware), Origin guard + opt-in CORS, session cap + TTL, no session
  listing, generic 500s. Keep it that way.

## Development Guidelines

### Adding a tool
1. Add a Zod schema in `src/schemas.ts`.
2. **Core services**: add the definition to `tools` in `src/server.ts` and a `case` in
   `handleToolCall`. **kDrive / Calendar**: add to the module in `src/tools/`.
3. Name it `infomaniak_<verb>_<object>` using `list_/get_/search_/download_` for read-only
   tools and `delete_/empty_/reboot_/shutdown_/remove_/renew_` for destructive ones — the
   policy and annotations are derived from the name (see `classifyTool` tests).
4. Add a client method; encode path segments with `seg()`.
5. Tests: `src/server.test.ts` has a test that calls every listed tool; add unit tests for the
   client method (mocked `fetch`) and the schema.

### API endpoint patterns
- Version in path: `/1/...`, `/2/...` (drive, profile), `/3/...` (drive v3).
- Never build URLs from unvalidated strings; never add hosts other than the fixed base URL.
- Endpoints not verified against a live account: mail admin (`/1/mail/...`, official docs use
  `/1/mail_hostings/{id}/mailboxes/{mailbox_name}`), `/1/domain/account/{id}`, `/1/vps`,
  `/1/dedicated`. Verify on a test account before relying on them.

## Testing

```bash
npm test
INFOMANIAK_API_TOKEN=your-token npm run inspector
# HTTP mode
MCP_TRANSPORT=http MCP_HTTP_AUTH_TOKEN=$(openssl rand -hex 32) INFOMANIAK_API_TOKEN=... npm start
```

## Common Issues

- **401**: invalid/expired token. **403**: token missing a scope (kDrive: `drive`; calendar:
  `workspace:calendar user_info`). **429**: rate limit (60 req/min).
- **"HTTP transport requires MCP_HTTP_AUTH_TOKEN"**: expected — set a shared secret.
- **Calendar "No calendar found"**: the calendar token must belong to the mailbox user.
- **kDrive "Only directory can be created here"**: files cannot be uploaded to the drive
  root or category folders; use a sub-directory.
