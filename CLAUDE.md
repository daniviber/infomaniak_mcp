# CLAUDE.md - Infomaniak MCP Server

Guidance for Claude Code when working in this repository. The contribution rules and the
verification sequence are in `CONTRIBUTING.md`; user documentation is in `README.md`.

## Project overview

TypeScript MCP server for the Infomaniak API: 111 declared tools (62 visible by default),
hexagonal architecture, MCP revision 2026-07-28 over stdio and sessionless HTTP, with revision
2025-11-25 still served by `build/main/legacy.js`.

Tech stack: Node 20.19.2 / npm 9.2.0 reference toolchain (`engines.node >= 20`), TypeScript
(ES2022, `Node16` ESM resolution), Zod 4, Express 5, `@modelcontextprotocol/{core,server,node}`
v2 (`@modelcontextprotocol/client` v2 in tests), Vitest, ESLint, Prettier.

## Project structure

- `src/domain/` – Zod domain models and `ToolContract` (name, class, idempotence, `experimental`
  and `rawApi` flags, schemas, limits). No I/O and no URL construction.
- `src/application/` – ports, use cases, bindings, execution policy and `FeatureModule`. The
  policy runs before input validation and before any provider call.
- `src/adapters/outbound/infomaniak/` – shared gateway (auth header, rate bucket, bounded fetch,
  retries on idempotent requests only), provider DTOs and domain projections, one adapter per
  family.
- `src/adapters/inbound/` – MCP SDK v2 server factory, modern and legacy stdio, HTTP handlers and
  admission (bearer, Host, Origin, body limit).
- `src/config/runtime-config.ts` – environment validated and frozen at startup.
- `src/features/*.feature.ts` – nine declarative modules exporting `tools`,
  `createHandlers(deps)` and, when visibility depends on configuration, `selectTools(deps)`.
- `src/main/` – `bootstrap.ts` (discovery, composition, dependency injection), `stdio.ts`
  (executable with side effects, no exports), `http.ts` and `legacy.ts` (testable applications
  and explicit entry points).
- `product/inventory/tools.json` – machine-readable catalogue, one entry per tool (endpoint,
  proof level, limits, JSON schemas, handler). `test/fixtures/baseline-tools.json` freezes the
  set of tool names.
- `test/` – `features/` (one file per module, provider doubles from `test/fixtures/*.json`),
  `adapters/`, `transports/` (stdio and HTTP, revision 2026), `interop/` (both revisions with the
  official client), `acceptance/` (offline scenario), `architecture/` (layer dependency rules).

## Commands

```sh
npm ci                # locked dependencies only
npm run build         # tsc -p tsconfig.build.json → build/
npm test              # vitest run, full suite
npm run lint          # eslint .
npm run format:check  # prettier --check (scope defined by .prettierignore)
npm run typecheck     # tsc --noEmit
npm run verify:mvp    # offline acceptance: build, inventory checks, scenario on both revisions
npm run inspector     # MCP Inspector against build/main/stdio.js (manual, needs a real token)
```

## Architecture rules

- Dependencies flow `domain ← application ← adapters ← main`;
  `test/architecture/dependencies.test.ts` enforces it. Never import adapters from the domain or
  the application layer.
- Provider DTOs live in the adapters and mirror the **real** API types: Unix-second integers for
  most dates (Calendar uses strings), string ids for DNS records and invoices, nullable fields
  where the API returns `null`, optional fields where they are absent. Convert in the adapter
  (Unix seconds → ISO 8601 UTC, `null` → absent domain field); the domain exposes strings and
  numbers. Do not use `.strict()` on provider DTOs and do not widen a type speculatively: every
  `.nullable()` or union must be justified by an observed payload.
- Tools are declared, never inferred: classification, idempotence, `experimental` and `rawApi`
  come from the contract. Experimental tools are filtered out by `selectTools` unless
  `INFOMANIAK_ALLOW_EXPERIMENTAL` is set; the raw API tool also needs `INFOMANIAK_ALLOW_RAW_API`;
  `INFOMANIAK_READ_ONLY` refuses write and destructive calls and limits the raw tool to `GET`.
- Fixed formats: a refusal returns the text `[POLICY_DENIED] <reason>: <toolName>` and the
  matching `structuredContent.error`; a success returns the domain object as `structuredContent`
  and the same JSON indented with two spaces as text. Only `infomaniak_api_call` returns
  `{ method, endpoint, status, data }`.
- Gateway errors are redacted: `Invalid Infomaniak response: <path>: <code>` lists Zod issue paths
  and codes, never payload values. Do not log provider payloads or tokens.
- HTTP is sessionless (`POST /mcp`): bearer, Host and Origin are checked before the body is read,
  and the body is bounded by byte count before parsing. The 2026 entry points reject 2025 requests;
  `legacy.js` routes each request to its revision behind the same guards. Do not reintroduce
  sessions, SSE resumption, transport selectors such as `MCP_TRANSPORT`, or the SDK v1.

## Invariants checked by the tests

- Tool names `infomaniak_*` are frozen. `tools.json` and `baseline-tools.json` are top-level JSON
  arrays with a `name` per entry and the same set of names as the composed registry.
- `package.json` `main`, `bin` and `scripts.start` all point to `build/main/stdio.js`
  (`test/transports/stdio-2026.test.ts`).
- Inventory entries match the code: `endpoint`, `proof`, `experimental`, `handler` and the JSON
  schemas generated with `z.toJSONSchema` from the declared Zod schemas
  (`scripts/verify-mvp.mjs`). Regenerate the schemas whenever a tool schema changes.
- Feature tests compare sets and measurements; only `scripts/verify-mvp.mjs` asserts the global
  totals (62 visible by default, 111 in total, 9 modules).
- No real network call in tests: sentinel tokens, fetch doubles and loopback listeners only; no
  literal waits (inject clocks or use fake timers).

## Adding or changing a tool

1. Domain schema in `src/domain/<family>/`.
2. Port and use case in `src/application/<family>/`, `ToolContract` declared in the family
   feature file.
3. Adapter: DTO typed from an observed payload, projection, route with encoded segments, in
   `src/adapters/outbound/infomaniak/<family>.adapter.ts`.
4. Fixture (`test/fixtures/<family>.json`, realistic types, fictitious values) and tests
   (`test/features/<family>.feature.test.ts`).
5. Inventory entry in `product/inventory/tools.json` (endpoint, `proof` with its source, limits,
   regenerated schemas); update `baseline-tools.json` only when a name is added.
6. Run the verification sequence from `CONTRIBUTING.md`.

## Known limitations

They are recorded per tool in the `knownLimits` field of the inventory and summarised in
`README.md`: closed access-right unions, `infomaniak_kchat_search_users` using `POST`, the
nameserver update accepting a single server, event details with `null` fields, experimental
routes not established. Changing one of them is a deliberate decision: update the inventory and
the README together.
