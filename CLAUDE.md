# CLAUDE.md - Infomaniak MCP Server

This file provides guidance to Claude Code when working with this codebase.

## Project Overview

This is an MCP (Model Context Protocol) server that provides tools for interacting with the Infomaniak API. It allows AI assistants to manage Infomaniak services including domains, DNS, email, web hosting, kDrive, Swiss Backup, VPS, dedicated servers, SSL certificates, and invoicing.

## Tech Stack

- **Language**: TypeScript (ES2022)
- **Module System**: Node16 ESM
- **Runtime**: Node.js >= 18
- **Key Dependencies**:
  - `@modelcontextprotocol/sdk` - MCP server SDK
  - `zod` - Schema validation
- **Build Output**: `./build/`

## Project Structure

```
src/
├── index.ts              # MCP server entry point, tool definitions and handlers
└── infomaniak-client.ts  # Infomaniak API client with typed methods
```

## Build and Run Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to build/
npm run dev          # Watch mode for development
npm start            # Run the built server
npm test             # Run unit tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run typecheck    # Type check without emitting
npm run inspector    # Test with MCP Inspector (requires INFOMANIAK_API_TOKEN env var)
```

## Architecture

### MCP Server (`src/index.ts`)
- Defines 50+ tools organized by service category (domains, mail, hosting, etc.)
- Uses stdio transport for communication
- Requires `INFOMANIAK_API_TOKEN` environment variable
- Each tool maps to one or more `InfomaniakClient` methods

### API Client (`src/infomaniak-client.ts`)
- Base URL: `https://api.infomaniak.com`
- Authentication: OAuth 2.0 Bearer Token
- Rate Limit: 60 requests/minute
- Typed interfaces for all API responses

### Validation (`src/schemas.ts`)
- Zod schemas for all tool inputs
- `validate()` helper function for runtime validation
- Provides clear error messages with field paths

### Tests (`src/*.test.ts`)
- Unit tests for `InfomaniakClient` with mocked fetch
- Validation schema tests for all input types
- Uses Vitest framework

## Tool Categories

1. **Profile & Account**: ping, profile, accounts, products
2. **Domains**: list domains, get domain details
3. **DNS**: full CRUD for DNS records (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA)
4. **Mail Services**: manage mailboxes and aliases
5. **Web Hosting**: sites, PHP versions, databases
6. **kDrive**: list and get kDrive details
7. **Swiss Backup**: backup products and slots
8. **VPS**: list, get, reboot, shutdown, boot
9. **Dedicated Servers**: list, get, reboot
10. **SSL Certificates**: list and get certificates
11. **Invoicing**: list and get invoices
12. **Generic API**: custom API calls for advanced operations

## Development Guidelines

### Adding a New Tool

1. Add tool definition to the `tools` array in `src/index.ts` with:
   - `name`: Prefixed with `infomaniak_`
   - `description`: Clear description of what it does
   - `inputSchema`: JSON Schema for parameters

2. Add the handler in the `switch` statement in `CallToolRequestSchema` handler

3. If needed, add corresponding method to `InfomaniakClient` class with proper TypeScript types

### API Endpoint Patterns

- API version is in the path: `/1/` (v1) or `/2/` (v2 for kDrive)
- Account-scoped endpoints: `/1/account/{account_id}/...`
- Service-specific: `/1/domain/`, `/1/mail/`, `/1/web/`, etc.

### Type Safety

- All API responses use the `ApiResponse<T>` wrapper type
- Create specific interfaces for response data types
- Use `unknown` for endpoints where response structure isn't fully typed

## Testing

Use the MCP Inspector for testing:

```bash
INFOMANIAK_API_TOKEN=your-token npm run inspector
```

## Common Issues

- **401 errors**: Invalid or expired API token
- **403 errors**: Token missing required scope
- **429 errors**: Rate limit exceeded (60 req/min)
- Build errors: Ensure `npm install` was run and TypeScript is installed
