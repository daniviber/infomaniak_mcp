# Infomaniak MCP Server

[![npm version](https://badge.fury.io/js/infomaniak-mcp-server.svg)](https://www.npmjs.com/package/infomaniak-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/YOUR_USERNAME/infomaniak-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/infomaniak-mcp-server/actions/workflows/ci.yml)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for interacting with the [Infomaniak API](https://developer.infomaniak.com/). This server enables AI assistants like Claude to manage Infomaniak services including domains, email, web hosting, kDrive, and more.

<p align="center">
  <img src="https://www.infomaniak.com/img/common/logo_infomaniak.jpg" alt="Infomaniak" height="60">
</p>

## ✨ Features

- 🌐 **Domain Management** - List domains, full DNS record CRUD operations
- 📧 **Email Services** - Manage mailboxes, aliases, and mail configurations  
- 🖥️ **Web Hosting** - Manage sites, PHP versions, and MySQL databases
- 💾 **kDrive** - Access and manage kDrive cloud storage
- 🔒 **Swiss Backup** - View and manage backup products
- 🖧 **VPS & Servers** - Control VPS instances and dedicated servers
- 📜 **SSL Certificates** - View certificate information
- 💰 **Invoicing** - Access billing and invoice data
- 🔧 **Generic API** - Make custom API calls for advanced operations

## 📋 Prerequisites

- Node.js 18 or higher
- An Infomaniak account with API access
- An API token from Infomaniak

## 🔑 Getting Your API Token

1. Log in to your [Infomaniak Manager](https://manager.infomaniak.com)
2. Navigate to **Account** → **API Tokens** or visit [token management](https://manager.infomaniak.com/v3/ng/accounts/token/list)
3. Click **"Create a token"**
4. Select the appropriate scopes for your needs:
   - `account` - Account management
   - `domain` - Domain management
   - `mail` - Email services
   - `web` - Web hosting
   - `drive` - kDrive access
   - `swiss_backup` - Backup services
   - `vps` - VPS management
   - `dedicated` - Dedicated servers
   - `certificate` - SSL certificates
   - `invoicing` - Billing access
5. Copy and securely store your token

## 📦 Installation

### Using npm (recommended)

```bash
npm install -g infomaniak-mcp-server
```

### From source

```bash
git clone https://github.com/YOUR_USERNAME/infomaniak-mcp-server.git
cd infomaniak-mcp-server
npm install
npm run build
```

## ⚙️ Configuration

### Claude Desktop

Add to your Claude Desktop configuration file:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "infomaniak": {
      "command": "npx",
      "args": ["-y", "infomaniak-mcp-server"],
      "env": {
        "INFOMANIAK_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

Or if installed globally or from source:

```json
{
  "mcpServers": {
    "infomaniak": {
      "command": "node",
      "args": ["/path/to/infomaniak-mcp-server/build/index.js"],
      "env": {
        "INFOMANIAK_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `INFOMANIAK_API_TOKEN` | Yes | Your Infomaniak API token |

## 🛠️ Available Tools

### Account & Profile

| Tool | Description |
|------|-------------|
| `infomaniak_ping` | Test API connectivity |
| `infomaniak_get_profile` | Get current user profile |
| `infomaniak_list_accounts` | List all accessible accounts |
| `infomaniak_get_account` | Get account details |
| `infomaniak_list_products` | List account products |

### Domain Management

| Tool | Description |
|------|-------------|
| `infomaniak_list_domains` | List all domains |
| `infomaniak_get_domain` | Get domain details |
| `infomaniak_list_dns_records` | List DNS records |
| `infomaniak_create_dns_record` | Create DNS record (A, AAAA, CNAME, MX, TXT, etc.) |
| `infomaniak_update_dns_record` | Update DNS record |
| `infomaniak_delete_dns_record` | Delete DNS record |

### Email Services

| Tool | Description |
|------|-------------|
| `infomaniak_list_mail_services` | List mail services |
| `infomaniak_get_mail_service` | Get mail service details |
| `infomaniak_list_mailboxes` | List mailboxes |
| `infomaniak_get_mailbox` | Get mailbox details |
| `infomaniak_create_mailbox` | Create new mailbox |
| `infomaniak_update_mailbox` | Update mailbox |
| `infomaniak_delete_mailbox` | Delete mailbox |
| `infomaniak_add_mailbox_alias` | Add email alias |
| `infomaniak_delete_mailbox_alias` | Remove email alias |

### Web Hosting

| Tool | Description |
|------|-------------|
| `infomaniak_list_web_hostings` | List web hostings |
| `infomaniak_get_web_hosting` | Get hosting details |
| `infomaniak_list_sites` | List sites |
| `infomaniak_get_site` | Get site details |
| `infomaniak_create_site` | Create new site |
| `infomaniak_update_site` | Update site |
| `infomaniak_delete_site` | Delete site |
| `infomaniak_list_databases` | List databases |
| `infomaniak_get_database` | Get database details |
| `infomaniak_create_database` | Create database |
| `infomaniak_delete_database` | Delete database |

### Cloud Storage

| Tool | Description |
|------|-------------|
| `infomaniak_list_kdrives` | List kDrives |
| `infomaniak_get_kdrive` | Get kDrive details |
| `infomaniak_list_swiss_backups` | List Swiss Backups |
| `infomaniak_get_swiss_backup` | Get backup details |
| `infomaniak_list_swiss_backup_slots` | List backup slots |

### Infrastructure

| Tool | Description |
|------|-------------|
| `infomaniak_list_vps` | List VPS instances |
| `infomaniak_get_vps` | Get VPS details |
| `infomaniak_reboot_vps` | Reboot VPS |
| `infomaniak_shutdown_vps` | Shutdown VPS |
| `infomaniak_boot_vps` | Boot VPS |
| `infomaniak_list_dedicated_servers` | List dedicated servers |
| `infomaniak_get_dedicated_server` | Get server details |
| `infomaniak_reboot_dedicated_server` | Reboot server |

### Certificates & Billing

| Tool | Description |
|------|-------------|
| `infomaniak_list_certificates` | List SSL certificates |
| `infomaniak_get_certificate` | Get certificate details |
| `infomaniak_list_invoices` | List invoices |
| `infomaniak_get_invoice` | Get invoice details |

### Advanced

| Tool | Description |
|------|-------------|
| `infomaniak_api_call` | Make custom API calls to any endpoint |

## 💬 Usage Examples

### List all accounts
```
"List all my Infomaniak accounts"
```

### Manage DNS Records
```
"Add an A record for www.example.com pointing to 192.168.1.100"
"Show all DNS records for mydomain.ch"
"Delete the TXT record with ID 12345 from example.com"
```

### Create a Mailbox
```
"Create a new email address info@mydomain.com with password SecurePass123"
```

### Check Infrastructure
```
"Show me the status of all my VPS instances"
"Reboot my VPS with ID 456"
```

### Custom API Call
```
"Make a GET request to /1/account to see all account details"
```

## 🔧 Development

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/infomaniak-mcp-server.git
cd infomaniak-mcp-server
npm install
```

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Test with MCP Inspector

```bash
INFOMANIAK_API_TOKEN=your-token npm run inspector
```

## ⚠️ API Rate Limits

The Infomaniak API has a rate limit of **60 requests per minute**. Be mindful of request frequency when using automation.

## 🐛 Troubleshooting

### "INFOMANIAK_API_TOKEN environment variable is required"
Ensure you've set the `INFOMANIAK_API_TOKEN` in your MCP client configuration.

### "Infomaniak API Error (401)"
Your API token may be invalid or expired. Generate a new token from Infomaniak Manager.

### "Infomaniak API Error (403)"  
Your token doesn't have the required scope. Create a new token with appropriate permissions.

### "Infomaniak API Error (429)"
Rate limit exceeded. Wait before making more requests.

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Resources

- [Infomaniak API Documentation](https://developer.infomaniak.com/docs/api)
- [Infomaniak Getting Started](https://developer.infomaniak.com/getting-started)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## 🙏 Acknowledgments

- [Infomaniak](https://www.infomaniak.com/) for their comprehensive API
- [Anthropic](https://www.anthropic.com/) for the Model Context Protocol
- The open-source community

---

<p align="center">
  Made with ❤️ for the Infomaniak and MCP community
</p>
