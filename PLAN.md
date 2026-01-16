# Plan: Make Infomaniak MCP Server Streamable

## Overview

Add Streamable HTTP transport support to the Infomaniak MCP server, enabling HTTP-based communication with SSE streaming capabilities. This allows the server to run as a standalone HTTP service instead of only via stdio.

## Current State

- Server uses `StdioServerTransport` (stdio-based, synchronous)
- Works only with MCP clients that support stdio (Claude Desktop, CLI tools)
- Cannot be deployed as a web service

## Target State

- Support both **stdio** and **Streamable HTTP** transports
- Run as a standalone HTTP server on a configurable port
- Enable web-based MCP clients and remote connections
- Maintain backward compatibility with existing stdio mode

## Technical Approach

### Transport Options

The MCP SDK v1.25.2 provides:
- `StdioServerTransport` - Current (stdio-based)
- `StreamableHTTPServerTransport` - HTTP with SSE streaming (Node.js)
- `SSEServerTransport` - Deprecated, replaced by StreamableHTTP

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    src/index.ts                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              MCP Server (shared)                 │   │
│  │  - Tool definitions                              │   │
│  │  - Request handlers                              │   │
│  │  - InfomaniakClient                              │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                               │
│         ┌───────────────┴───────────────┐              │
│         ▼                               ▼              │
│  ┌─────────────────┐          ┌─────────────────────┐  │
│  │ StdioTransport  │          │ StreamableHTTP      │  │
│  │ (default/CLI)   │          │ Transport (HTTP)    │  │
│  └─────────────────┘          └─────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Add HTTP Server Dependencies

Add Express.js (or native http) for HTTP server:

```bash
npm install express
npm install -D @types/express
```

### Step 2: Refactor Server Creation

Extract server setup into a reusable function:

**`src/server.ts`** (new file)
```typescript
// Shared MCP server configuration
// - Tool definitions
// - Request handlers
// - Infomaniak client initialization
export function createMcpServer(client: InfomaniakClient): Server { ... }
```

### Step 3: Create Transport Modules

**`src/transports/stdio.ts`**
```typescript
// Stdio transport entry point (existing behavior)
export async function startStdioServer(): Promise<void>
```

**`src/transports/http.ts`**
```typescript
// Streamable HTTP transport entry point
export async function startHttpServer(port: number): Promise<void>
```

### Step 4: Update Entry Point

**`src/index.ts`**
```typescript
// Parse CLI args or environment variables
const mode = process.env.MCP_TRANSPORT || 'stdio';
const port = parseInt(process.env.MCP_PORT || '3000');

if (mode === 'http') {
  await startHttpServer(port);
} else {
  await startStdioServer();
}
```

### Step 5: Implement HTTP Transport

```typescript
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../server.js';

export async function startHttpServer(port: number): Promise<void> {
  const app = express();
  app.use(express.json());

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  const server = createMcpServer(client);
  await server.connect(transport);

  // Handle all MCP requests
  app.all('/mcp', async (req, res) => {
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(port, () => {
    console.error(`Infomaniak MCP Server running on http://localhost:${port}/mcp`);
  });
}
```

### Step 6: Add Configuration Options

Environment variables:
- `MCP_TRANSPORT`: `stdio` (default) or `http`
- `MCP_PORT`: HTTP port (default: 3000)
- `MCP_SESSION_MODE`: `stateful` (default) or `stateless`
- `INFOMANIAK_API_TOKEN`: Required (existing)

### Step 7: Update Documentation

Update README.md with:
- HTTP transport usage instructions
- Configuration options
- Client connection examples
- Docker deployment example

### Step 8: Add Tests

- Unit tests for HTTP transport setup
- Integration tests for HTTP endpoints
- Test session management (stateful/stateless)

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | Add express dependency |
| `src/server.ts` | Create | Shared MCP server factory |
| `src/transports/stdio.ts` | Create | Stdio transport module |
| `src/transports/http.ts` | Create | HTTP transport module |
| `src/index.ts` | Modify | Transport selection logic |
| `src/transports/http.test.ts` | Create | HTTP transport tests |
| `README.md` | Modify | Add HTTP usage docs |
| `CLAUDE.md` | Modify | Update architecture docs |

## Configuration Examples

### Claude Desktop (stdio - unchanged)
```json
{
  "mcpServers": {
    "infomaniak": {
      "command": "npx",
      "args": ["-y", "infomaniak-mcp-server"],
      "env": {
        "INFOMANIAK_API_TOKEN": "your-token"
      }
    }
  }
}
```

### HTTP Server Mode
```bash
# Start as HTTP server
MCP_TRANSPORT=http MCP_PORT=3000 INFOMANIAK_API_TOKEN=your-token npx infomaniak-mcp-server
```

### Docker Deployment
```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN npm install -g infomaniak-mcp-server
ENV MCP_TRANSPORT=http
ENV MCP_PORT=3000
EXPOSE 3000
CMD ["infomaniak-mcp-server"]
```

## Security Considerations

1. **Authentication**: HTTP transport should validate API token per request
2. **CORS**: Configure allowed origins for web clients
3. **Rate Limiting**: Implement request rate limiting
4. **TLS**: Document HTTPS proxy setup for production

## Testing Plan

1. Verify stdio mode still works (backward compatibility)
2. Test HTTP endpoint responds to MCP protocol
3. Test SSE streaming for long-running operations
4. Test session management (create, validate, cleanup)
5. Test concurrent connections
6. Test error handling and recovery

## Rollout

1. Implement core HTTP transport
2. Add configuration and CLI options
3. Update documentation
4. Test with MCP Inspector
5. Publish update to npm
