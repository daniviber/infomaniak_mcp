# Contributing to Infomaniak MCP Server

Thanks for contributing. This guide covers the development setup, the verification sequence every
change must pass, and the conventions the code base relies on. Architecture notes are in
`CLAUDE.md`; user documentation is in `README.md`.

## Reporting bugs and suggesting features

Open an issue with the tool name, the MCP client and protocol revision, the entry point used and
the redacted error text. The gateway never logs provider payloads: an error such as
`Invalid Infomaniak response: data.0.created_at: invalid_type` gives the field path and the
validation code, which is enough to fix a DTO. Never paste tokens, account identifiers or
personal data.

## Development setup

Reference toolchain: Node **20.19.2**, npm **9.2.0**, Git and a POSIX shell. `engines.node` is
`>=20`.

```sh
git clone <your fork>
cd infomaniak_mcp
npm ci            # locked dependencies only (lockfile v3)
npm run build
npm test
```

Keep `package-lock.json` authoritative. Do not vendor binaries or add system dependencies.
`npm run inspector` runs the MCP Inspector against the stdio build; it needs a real token and is
not part of the verification below.

## Verification sequence

Run these commands in order before opening a pull request; every one of them must exit 0.

```sh
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run verify:mvp
npm audit --audit-level=high
```

`npm test` must be fully green with no skipped test. `npm run verify:mvp` is self-contained: it
builds, checks the inventory against the code (names, handlers, endpoints, proof levels, JSON
schemas) and replays the offline scenario on stdio and HTTP for both protocol revisions; it must
print `MVP OFFLINE PASS` and `orphan tools: 0`. `format:check` covers the paths listed in
`.prettierignore`; format new scripts explicitly if they fall outside it.

Tests never reach the Infomaniak API: use sentinel tokens, fetch doubles and loopback listeners
only. Do not add literal waits; inject clocks or use fake timers.

## Coding guidelines

- TypeScript strict, ESM, Zod 4. Respect the layers `domain → application → adapters → main`;
  `test/architecture/dependencies.test.ts` fails otherwise.
- Provider DTOs are typed from **observed** payloads: Unix-second dates, string ids where the API
  uses strings, nullable fields where it returns `null`. Convert in the adapter, keep the domain
  in strings and numbers, do not use `.strict()` and do not widen types speculatively.
- Declare everything on the tool contract: classification, idempotence, `experimental` and
  `rawApi` flags, input and output schemas, limits. Never derive behaviour from a tool name.
- Keep the fixed refusal and success formats described in `CLAUDE.md`, and keep error messages
  free of payload values.
- Feature tests compare sets and measurements between themselves; the global totals belong to
  `scripts/verify-mvp.mjs` only.
- Keep `product/inventory/tools.json` and `test/fixtures/baseline-tools.json` as top-level JSON
  arrays with a `name` per entry; enrich entries, never wrap the array.

## Adding a tool

1. Domain schema.
2. Port, use case and `ToolContract` in the family feature file.
3. Adapter DTO, projection and route.
4. Fixture with realistic types and fictitious values, plus a feature test.
5. Inventory entry with `endpoint`, `proof` (`official` with a citation, `baseline`, or `unproven`
   together with `experimental: true`), limits and regenerated JSON schemas.
6. The verification sequence above.

A tool whose route is not established by an official Infomaniak source stays experimental.

## Commit messages and pull requests

Use conventional commits (`feat(kdrive): …`, `fix(services): …`, `test: …`, `docs: …`). Keep one
concern per pull request and summarise the verification output in the description (test count,
`verify:mvp` result). Never include tokens, account identifiers, personal data or local paths in
code, fixtures, documentation or commit messages.
