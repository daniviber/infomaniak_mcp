#!/usr/bin/env node

/**
 * Infomaniak MCP Server
 * 
 * A Model Context Protocol server that provides tools for interacting
 * with the Infomaniak API - managing domains, email, hosting, kDrive, and more.
 * 
 * Environment Variables:
 * - INFOMANIAK_API_TOKEN: Your Infomaniak API token (required)
 * 
 * Get your API token from: https://manager.infomaniak.com/v3/ng/accounts/token/list
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { InfomaniakClient } from "./infomaniak-client.js";
import {
  validate,
  AccountIdSchema,
  DomainNameSchema,
  GetDomainSchema,
  ListDnsRecordsSchema,
  CreateDnsRecordSchema,
  UpdateDnsRecordSchema,
  DeleteDnsRecordSchema,
  MailIdSchema,
  MailboxIdSchema,
  CreateMailboxSchema,
  UpdateMailboxSchema,
  DeleteMailboxSchema,
  MailboxAliasSchema,
  HostingIdSchema,
  SiteIdSchema,
  CreateSiteSchema,
  UpdateSiteSchema,
  DeleteSiteSchema,
  DatabaseIdSchema,
  CreateDatabaseSchema,
  DeleteDatabaseSchema,
  DriveIdSchema,
  BackupIdSchema,
  VpsIdSchema,
  ServerIdSchema,
  CertificateIdSchema,
  InvoiceIdSchema,
  ApiCallSchema,
} from "./schemas.js";

// Get API token from environment
const API_TOKEN = process.env.INFOMANIAK_API_TOKEN;

if (!API_TOKEN) {
  console.error("Error: INFOMANIAK_API_TOKEN environment variable is required");
  console.error("Get your API token from: https://manager.infomaniak.com/v3/ng/accounts/token/list");
  process.exit(1);
}

// Initialize the Infomaniak client
const client = new InfomaniakClient({ token: API_TOKEN });

// Define all available tools
const tools: Tool[] = [
  // Profile & Account Tools
  {
    name: "infomaniak_ping",
    description: "Test connectivity with the Infomaniak API",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "infomaniak_get_profile",
    description: "Get the current user profile information",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "infomaniak_list_accounts",
    description: "List all accounts accessible by the current user",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "infomaniak_get_account",
    description: "Get detailed information about a specific account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_list_products",
    description: "List all products for a specific account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },

  // Domain Tools
  {
    name: "infomaniak_list_domains",
    description: "List all domains for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_domain",
    description: "Get detailed information about a specific domain",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
        domain: {
          type: "string",
          description: "The domain name (e.g., example.com)",
        },
      },
      required: ["account_id", "domain"],
    },
  },
  {
    name: "infomaniak_list_dns_records",
    description: "List all DNS records for a domain",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "The domain name (e.g., example.com)",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "infomaniak_create_dns_record",
    description: "Create a new DNS record for a domain",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "The domain name (e.g., example.com)",
        },
        source: {
          type: "string",
          description: "The subdomain or @ for root (e.g., www, mail, @)",
        },
        type: {
          type: "string",
          description: "DNS record type (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA)",
          enum: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"],
        },
        target: {
          type: "string",
          description: "The target value (IP address, hostname, or text)",
        },
        ttl: {
          type: "number",
          description: "Time to live in seconds (default: 3600)",
        },
        priority: {
          type: "number",
          description: "Priority for MX/SRV records",
        },
      },
      required: ["domain", "source", "type", "target"],
    },
  },
  {
    name: "infomaniak_update_dns_record",
    description: "Update an existing DNS record",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "The domain name",
        },
        record_id: {
          type: "number",
          description: "The DNS record ID",
        },
        source: {
          type: "string",
          description: "The subdomain or @ for root",
        },
        type: {
          type: "string",
          description: "DNS record type",
        },
        target: {
          type: "string",
          description: "The target value",
        },
        ttl: {
          type: "number",
          description: "Time to live in seconds",
        },
        priority: {
          type: "number",
          description: "Priority for MX/SRV records",
        },
      },
      required: ["domain", "record_id"],
    },
  },
  {
    name: "infomaniak_delete_dns_record",
    description: "Delete a DNS record",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "The domain name",
        },
        record_id: {
          type: "number",
          description: "The DNS record ID to delete",
        },
      },
      required: ["domain", "record_id"],
    },
  },

  // Mail Service Tools
  {
    name: "infomaniak_list_mail_services",
    description: "List all mail services for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_mail_service",
    description: "Get detailed information about a mail service",
    inputSchema: {
      type: "object",
      properties: {
        mail_id: {
          type: "number",
          description: "The mail service ID",
        },
      },
      required: ["mail_id"],
    },
  },
  {
    name: "infomaniak_list_mailboxes",
    description: "List all mailboxes for a mail service",
    inputSchema: {
      type: "object",
      properties: {
        mail_id: {
          type: "number",
          description: "The mail service ID",
        },
      },
      required: ["mail_id"],
    },
  },
  {
    name: "infomaniak_get_mailbox",
    description: "Get detailed information about a specific mailbox",
    inputSchema: {
      type: "object",
      properties: {
        mail_id: {
          type: "number",
          description: "The mail service ID",
        },
        mailbox_id: {
          type: "number",
          description: "The mailbox ID",
        },
      },
      required: ["mail_id", "mailbox_id"],
    },
  },
  {
    name: "infomaniak_create_mailbox",
    description: "Create a new mailbox",
    inputSchema: {
      type: "object",
      properties: {
        mail_id: {
          type: "number",
          description: "The mail service ID",
        },
        mailbox_name: {
          type: "string",
          description: "The mailbox name (local part of email address)",
        },
        password: {
          type: "string",
          description: "The mailbox password",
        },
        max_size: {
          type: "number",
          description: "Maximum mailbox size in MB",
        },
      },
      required: ["mail_id", "mailbox_name", "password"],
    },
  },
  {
    name: "infomaniak_update_mailbox",
    description: "Update a mailbox (password or size)",
    inputSchema: {
      type: "object",
      properties: {
        mail_id: {
          type: "number",
          description: "The mail service ID",
        },
        mailbox_id: {
          type: "number",
          description: "The mailbox ID",
        },
        password: {
          type: "string",
          description: "New password (optional)",
        },
        max_size: {
          type: "number",
          description: "New maximum size in MB (optional)",
        },
      },
      required: ["mail_id", "mailbox_id"],
    },
  },
  {
    name: "infomaniak_delete_mailbox",
    description: "Delete a mailbox",
    inputSchema: {
      type: "object",
      properties: {
        mail_id: {
          type: "number",
          description: "The mail service ID",
        },
        mailbox_id: {
          type: "number",
          description: "The mailbox ID to delete",
        },
      },
      required: ["mail_id", "mailbox_id"],
    },
  },
  {
    name: "infomaniak_add_mailbox_alias",
    description: "Add an email alias to a mailbox",
    inputSchema: {
      type: "object",
      properties: {
        mail_id: {
          type: "number",
          description: "The mail service ID",
        },
        mailbox_id: {
          type: "number",
          description: "The mailbox ID",
        },
        alias: {
          type: "string",
          description: "The alias email address",
        },
      },
      required: ["mail_id", "mailbox_id", "alias"],
    },
  },
  {
    name: "infomaniak_delete_mailbox_alias",
    description: "Delete an email alias from a mailbox",
    inputSchema: {
      type: "object",
      properties: {
        mail_id: {
          type: "number",
          description: "The mail service ID",
        },
        mailbox_id: {
          type: "number",
          description: "The mailbox ID",
        },
        alias: {
          type: "string",
          description: "The alias email address to delete",
        },
      },
      required: ["mail_id", "mailbox_id", "alias"],
    },
  },

  // Web Hosting Tools
  {
    name: "infomaniak_list_web_hostings",
    description: "List all web hostings for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_web_hosting",
    description: "Get detailed information about a web hosting",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
      },
      required: ["hosting_id"],
    },
  },
  {
    name: "infomaniak_list_sites",
    description: "List all sites for a web hosting",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
      },
      required: ["hosting_id"],
    },
  },
  {
    name: "infomaniak_get_site",
    description: "Get detailed information about a site",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        site_id: {
          type: "number",
          description: "The site ID",
        },
      },
      required: ["hosting_id", "site_id"],
    },
  },
  {
    name: "infomaniak_create_site",
    description: "Create a new site on a web hosting",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        fqdn: {
          type: "string",
          description: "The fully qualified domain name for the site",
        },
        path: {
          type: "string",
          description: "The document root path (optional)",
        },
        php_version: {
          type: "string",
          description: "PHP version to use (optional)",
        },
      },
      required: ["hosting_id", "fqdn"],
    },
  },
  {
    name: "infomaniak_update_site",
    description: "Update a site configuration",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        site_id: {
          type: "number",
          description: "The site ID",
        },
        path: {
          type: "string",
          description: "New document root path",
        },
        php_version: {
          type: "string",
          description: "New PHP version",
        },
      },
      required: ["hosting_id", "site_id"],
    },
  },
  {
    name: "infomaniak_delete_site",
    description: "Delete a site from web hosting",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        site_id: {
          type: "number",
          description: "The site ID to delete",
        },
      },
      required: ["hosting_id", "site_id"],
    },
  },

  // Database Tools
  {
    name: "infomaniak_list_databases",
    description: "List all databases for a web hosting",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
      },
      required: ["hosting_id"],
    },
  },
  {
    name: "infomaniak_get_database",
    description: "Get detailed information about a database",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        database_id: {
          type: "number",
          description: "The database ID",
        },
      },
      required: ["hosting_id", "database_id"],
    },
  },
  {
    name: "infomaniak_create_database",
    description: "Create a new database",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        name: {
          type: "string",
          description: "Database name",
        },
        charset: {
          type: "string",
          description: "Character set (default: utf8mb4)",
        },
      },
      required: ["hosting_id", "name"],
    },
  },
  {
    name: "infomaniak_delete_database",
    description: "Delete a database",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        database_id: {
          type: "number",
          description: "The database ID to delete",
        },
      },
      required: ["hosting_id", "database_id"],
    },
  },

  // kDrive Tools
  {
    name: "infomaniak_list_kdrives",
    description: "List all kDrives for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_kdrive",
    description: "Get detailed information about a kDrive",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: {
          type: "number",
          description: "The kDrive ID",
        },
      },
      required: ["drive_id"],
    },
  },

  // Swiss Backup Tools
  {
    name: "infomaniak_list_swiss_backups",
    description: "List all Swiss Backup products for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_swiss_backup",
    description: "Get detailed information about a Swiss Backup product",
    inputSchema: {
      type: "object",
      properties: {
        backup_id: {
          type: "number",
          description: "The Swiss Backup product ID",
        },
      },
      required: ["backup_id"],
    },
  },
  {
    name: "infomaniak_list_swiss_backup_slots",
    description: "List all slots for a Swiss Backup product",
    inputSchema: {
      type: "object",
      properties: {
        backup_id: {
          type: "number",
          description: "The Swiss Backup product ID",
        },
      },
      required: ["backup_id"],
    },
  },

  // VPS Tools
  {
    name: "infomaniak_list_vps",
    description: "List all VPS instances",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "infomaniak_get_vps",
    description: "Get detailed information about a VPS",
    inputSchema: {
      type: "object",
      properties: {
        vps_id: {
          type: "number",
          description: "The VPS ID",
        },
      },
      required: ["vps_id"],
    },
  },
  {
    name: "infomaniak_reboot_vps",
    description: "Reboot a VPS",
    inputSchema: {
      type: "object",
      properties: {
        vps_id: {
          type: "number",
          description: "The VPS ID to reboot",
        },
      },
      required: ["vps_id"],
    },
  },
  {
    name: "infomaniak_shutdown_vps",
    description: "Shutdown a VPS",
    inputSchema: {
      type: "object",
      properties: {
        vps_id: {
          type: "number",
          description: "The VPS ID to shutdown",
        },
      },
      required: ["vps_id"],
    },
  },
  {
    name: "infomaniak_boot_vps",
    description: "Boot a VPS",
    inputSchema: {
      type: "object",
      properties: {
        vps_id: {
          type: "number",
          description: "The VPS ID to boot",
        },
      },
      required: ["vps_id"],
    },
  },

  // Dedicated Server Tools
  {
    name: "infomaniak_list_dedicated_servers",
    description: "List all dedicated servers",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "infomaniak_get_dedicated_server",
    description: "Get detailed information about a dedicated server",
    inputSchema: {
      type: "object",
      properties: {
        server_id: {
          type: "number",
          description: "The dedicated server ID",
        },
      },
      required: ["server_id"],
    },
  },
  {
    name: "infomaniak_reboot_dedicated_server",
    description: "Reboot a dedicated server",
    inputSchema: {
      type: "object",
      properties: {
        server_id: {
          type: "number",
          description: "The dedicated server ID to reboot",
        },
      },
      required: ["server_id"],
    },
  },

  // SSL Certificate Tools
  {
    name: "infomaniak_list_certificates",
    description: "List all SSL certificates for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_certificate",
    description: "Get detailed information about an SSL certificate",
    inputSchema: {
      type: "object",
      properties: {
        certificate_id: {
          type: "number",
          description: "The SSL certificate ID",
        },
      },
      required: ["certificate_id"],
    },
  },

  // Invoicing Tools
  {
    name: "infomaniak_list_invoices",
    description: "List all invoices for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_invoice",
    description: "Get detailed information about an invoice",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
        invoice_id: {
          type: "number",
          description: "The invoice ID",
        },
      },
      required: ["account_id", "invoice_id"],
    },
  },

  // Generic API Call Tool
  {
    name: "infomaniak_api_call",
    description: "Make a custom API call to any Infomaniak API endpoint. Use this for advanced operations not covered by other tools.",
    inputSchema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          description: "HTTP method",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        },
        endpoint: {
          type: "string",
          description: "API endpoint path (e.g., /1/account or /2/drive/123)",
        },
        body: {
          type: "object",
          description: "Request body for POST/PUT/PATCH requests",
        },
        query_params: {
          type: "object",
          description: "Query parameters as key-value pairs",
        },
      },
      required: ["method", "endpoint"],
    },
  },
];

// Create the MCP server
const server = new Server(
  {
    name: "infomaniak-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      // Profile & Account (no validation needed - no args)
      case "infomaniak_ping":
        result = await client.ping();
        break;

      case "infomaniak_get_profile":
        result = await client.getProfile();
        break;

      case "infomaniak_list_accounts":
        result = await client.getAccounts();
        break;

      case "infomaniak_get_account": {
        const validated = validate(AccountIdSchema, args);
        result = await client.getAccount(validated.account_id);
        break;
      }

      case "infomaniak_list_products": {
        const validated = validate(AccountIdSchema, args);
        result = await client.getAccountProducts(validated.account_id);
        break;
      }

      // Domains
      case "infomaniak_list_domains": {
        const validated = validate(AccountIdSchema, args);
        result = await client.getDomains(validated.account_id);
        break;
      }

      case "infomaniak_get_domain": {
        const validated = validate(GetDomainSchema, args);
        result = await client.getDomain(validated.account_id, validated.domain);
        break;
      }

      case "infomaniak_list_dns_records": {
        const validated = validate(ListDnsRecordsSchema, args);
        result = await client.getDnsRecords(validated.domain);
        break;
      }

      case "infomaniak_create_dns_record": {
        const validated = validate(CreateDnsRecordSchema, args);
        result = await client.createDnsRecord(validated.domain, {
          source: validated.source,
          type: validated.type,
          target: validated.target,
          ttl: validated.ttl,
          priority: validated.priority,
        });
        break;
      }

      case "infomaniak_update_dns_record": {
        const validated = validate(UpdateDnsRecordSchema, args);
        result = await client.updateDnsRecord(
          validated.domain,
          validated.record_id,
          {
            source: validated.source,
            type: validated.type,
            target: validated.target,
            ttl: validated.ttl,
            priority: validated.priority,
          }
        );
        break;
      }

      case "infomaniak_delete_dns_record": {
        const validated = validate(DeleteDnsRecordSchema, args);
        result = await client.deleteDnsRecord(validated.domain, validated.record_id);
        break;
      }

      // Mail Services
      case "infomaniak_list_mail_services": {
        const validated = validate(AccountIdSchema, args);
        result = await client.getMailServices(validated.account_id);
        break;
      }

      case "infomaniak_get_mail_service": {
        const validated = validate(MailIdSchema, args);
        result = await client.getMailService(validated.mail_id);
        break;
      }

      case "infomaniak_list_mailboxes": {
        const validated = validate(MailIdSchema, args);
        result = await client.getMailboxes(validated.mail_id);
        break;
      }

      case "infomaniak_get_mailbox": {
        const validated = validate(MailboxIdSchema, args);
        result = await client.getMailbox(validated.mail_id, validated.mailbox_id);
        break;
      }

      case "infomaniak_create_mailbox": {
        const validated = validate(CreateMailboxSchema, args);
        result = await client.createMailbox(validated.mail_id, {
          mailbox_name: validated.mailbox_name,
          password: validated.password,
          max_size: validated.max_size,
        });
        break;
      }

      case "infomaniak_update_mailbox": {
        const validated = validate(UpdateMailboxSchema, args);
        result = await client.updateMailbox(
          validated.mail_id,
          validated.mailbox_id,
          {
            password: validated.password,
            max_size: validated.max_size,
          }
        );
        break;
      }

      case "infomaniak_delete_mailbox": {
        const validated = validate(DeleteMailboxSchema, args);
        result = await client.deleteMailbox(validated.mail_id, validated.mailbox_id);
        break;
      }

      case "infomaniak_add_mailbox_alias": {
        const validated = validate(MailboxAliasSchema, args);
        result = await client.addMailboxAlias(
          validated.mail_id,
          validated.mailbox_id,
          validated.alias
        );
        break;
      }

      case "infomaniak_delete_mailbox_alias": {
        const validated = validate(MailboxAliasSchema, args);
        result = await client.deleteMailboxAlias(
          validated.mail_id,
          validated.mailbox_id,
          validated.alias
        );
        break;
      }

      // Web Hosting
      case "infomaniak_list_web_hostings": {
        const validated = validate(AccountIdSchema, args);
        result = await client.getWebHostings(validated.account_id);
        break;
      }

      case "infomaniak_get_web_hosting": {
        const validated = validate(HostingIdSchema, args);
        result = await client.getWebHosting(validated.hosting_id);
        break;
      }

      case "infomaniak_list_sites": {
        const validated = validate(HostingIdSchema, args);
        result = await client.getSites(validated.hosting_id);
        break;
      }

      case "infomaniak_get_site": {
        const validated = validate(SiteIdSchema, args);
        result = await client.getSite(validated.hosting_id, validated.site_id);
        break;
      }

      case "infomaniak_create_site": {
        const validated = validate(CreateSiteSchema, args);
        result = await client.createSite(validated.hosting_id, {
          fqdn: validated.fqdn,
          path: validated.path,
          php_version: validated.php_version,
        });
        break;
      }

      case "infomaniak_update_site": {
        const validated = validate(UpdateSiteSchema, args);
        result = await client.updateSite(
          validated.hosting_id,
          validated.site_id,
          {
            path: validated.path,
            php_version: validated.php_version,
          }
        );
        break;
      }

      case "infomaniak_delete_site": {
        const validated = validate(DeleteSiteSchema, args);
        result = await client.deleteSite(validated.hosting_id, validated.site_id);
        break;
      }

      // Databases
      case "infomaniak_list_databases": {
        const validated = validate(HostingIdSchema, args);
        result = await client.getDatabases(validated.hosting_id);
        break;
      }

      case "infomaniak_get_database": {
        const validated = validate(DatabaseIdSchema, args);
        result = await client.getDatabase(validated.hosting_id, validated.database_id);
        break;
      }

      case "infomaniak_create_database": {
        const validated = validate(CreateDatabaseSchema, args);
        result = await client.createDatabase(validated.hosting_id, {
          name: validated.name,
          charset: validated.charset,
        });
        break;
      }

      case "infomaniak_delete_database": {
        const validated = validate(DeleteDatabaseSchema, args);
        result = await client.deleteDatabase(validated.hosting_id, validated.database_id);
        break;
      }

      // kDrive
      case "infomaniak_list_kdrives": {
        const validated = validate(AccountIdSchema, args);
        result = await client.getKDrives(validated.account_id);
        break;
      }

      case "infomaniak_get_kdrive": {
        const validated = validate(DriveIdSchema, args);
        result = await client.getKDrive(validated.drive_id);
        break;
      }

      // Swiss Backup
      case "infomaniak_list_swiss_backups": {
        const validated = validate(AccountIdSchema, args);
        result = await client.getSwissBackups(validated.account_id);
        break;
      }

      case "infomaniak_get_swiss_backup": {
        const validated = validate(BackupIdSchema, args);
        result = await client.getSwissBackup(validated.backup_id);
        break;
      }

      case "infomaniak_list_swiss_backup_slots": {
        const validated = validate(BackupIdSchema, args);
        result = await client.getSwissBackupSlots(validated.backup_id);
        break;
      }

      // VPS (no validation for list)
      case "infomaniak_list_vps":
        result = await client.getVpsList();
        break;

      case "infomaniak_get_vps": {
        const validated = validate(VpsIdSchema, args);
        result = await client.getVps(validated.vps_id);
        break;
      }

      case "infomaniak_reboot_vps": {
        const validated = validate(VpsIdSchema, args);
        result = await client.rebootVps(validated.vps_id);
        break;
      }

      case "infomaniak_shutdown_vps": {
        const validated = validate(VpsIdSchema, args);
        result = await client.shutdownVps(validated.vps_id);
        break;
      }

      case "infomaniak_boot_vps": {
        const validated = validate(VpsIdSchema, args);
        result = await client.bootVps(validated.vps_id);
        break;
      }

      // Dedicated Servers (no validation for list)
      case "infomaniak_list_dedicated_servers":
        result = await client.getDedicatedServers();
        break;

      case "infomaniak_get_dedicated_server": {
        const validated = validate(ServerIdSchema, args);
        result = await client.getDedicatedServer(validated.server_id);
        break;
      }

      case "infomaniak_reboot_dedicated_server": {
        const validated = validate(ServerIdSchema, args);
        result = await client.rebootDedicatedServer(validated.server_id);
        break;
      }

      // SSL Certificates
      case "infomaniak_list_certificates": {
        const validated = validate(AccountIdSchema, args);
        result = await client.getCertificates(validated.account_id);
        break;
      }

      case "infomaniak_get_certificate": {
        const validated = validate(CertificateIdSchema, args);
        result = await client.getCertificate(validated.certificate_id);
        break;
      }

      // Invoicing
      case "infomaniak_list_invoices": {
        const validated = validate(AccountIdSchema, args);
        result = await client.getInvoices(validated.account_id);
        break;
      }

      case "infomaniak_get_invoice": {
        const validated = validate(InvoiceIdSchema, args);
        result = await client.getInvoice(validated.account_id, validated.invoice_id);
        break;
      }

      // Generic API Call
      case "infomaniak_api_call": {
        const validated = validate(ApiCallSchema, args);
        result = await client.call(
          validated.method,
          validated.endpoint,
          validated.body,
          validated.query_params
        );
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    const content: TextContent[] = [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ];

    return { content };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Infomaniak MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
