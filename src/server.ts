/**
 * Shared MCP Server Factory
 *
 * Creates and configures the MCP server with all tool definitions and handlers.
 * This module is transport-agnostic and can be used with stdio or HTTP transports.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { InfomaniakClient } from "./infomaniak-client.js";
import { KChatClient } from "./kchat-client.js";
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
  GetDomainNameserversSchema,
  UpdateDomainNameserversSchema,
  RenewDomainSchema,
  EmailRedirectionIdSchema,
  CreateEmailRedirectionSchema,
  CronJobIdSchema,
  CreateCronJobSchema,
  UpdateCronJobSchema,
  FtpAccountIdSchema,
  CreateFtpAccountSchema,
  UpdateFtpAccountSchema,
  KDriveFileIdSchema,
  ListKDriveFilesSchema,
  SearchKDriveFilesSchema,
  CreateKDriveDirectorySchema,
  MoveOrCopyKDriveFileSchema,
  RenameKDriveFileSchema,
  ShareKDriveFileSchema,
  KDriveTrashSchema,
  KDriveActivitySchema,
  KDriveFavoritesSchema,
  UpdateMailboxAutoresponderSchema,
  KChatTeamIdSchema,
  KChatChannelIdSchema,
  KChatPostIdSchema,
  CreateKChatPostSchema,
  SearchKChatPostsSchema,
  CreateKChatDirectChannelSchema,
  SearchKChatUsersSchema,
  ListKChatUsersSchema,
  KChatGetChannelPostsSchema,
} from "./schemas.js";

/**
 * Tool definitions for the Infomaniak MCP server
 */
export const tools: Tool[] = [
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
    name: "infomaniak_get_domain_nameservers",
    description: "Get the nameservers for a domain",
    inputSchema: { type: "object", properties: { domain: { type: "string", description: "The domain name" } }, required: ["domain"] },
  },
  {
    name: "infomaniak_update_domain_nameservers",
    description: "Update the nameservers for a domain",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        nameservers: { type: "array", items: { type: "object", properties: { host: { type: "string" }, ip: { type: "string" } }, required: ["host"] } },
      },
      required: ["domain", "nameservers"],
    },
  },
  {
    name: "infomaniak_renew_domain",
    description: "Renew a domain for a given number of years",
    inputSchema: { type: "object", properties: { domain: { type: "string" }, duration: { type: "number", description: "Renewal duration in years" } }, required: ["domain", "duration"] },
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

  {
    name: "infomaniak_list_email_redirections",
    description: "List all email redirections for a mail service",
    inputSchema: { type: "object", properties: { mail_id: { type: "number", description: "The mail service ID" } }, required: ["mail_id"] },
  },
  {
    name: "infomaniak_create_email_redirection",
    description: "Create an email redirection",
    inputSchema: {
      type: "object",
      properties: {
        mail_id: { type: "number" },
        from: { type: "string", description: "Source email address" },
        to: { type: "array", items: { type: "string" }, description: "Destination email address(es)" },
        keep_copy: { type: "boolean" },
      },
      required: ["mail_id", "from", "to"],
    },
  },
  {
    name: "infomaniak_delete_email_redirection",
    description: "Delete an email redirection",
    inputSchema: { type: "object", properties: { mail_id: { type: "number" }, redirection_id: { type: "number" } }, required: ["mail_id", "redirection_id"] },
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

  {
    name: "infomaniak_list_cron_jobs",
    description: "List all cron jobs for a web hosting",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" } }, required: ["hosting_id"] },
  },
  {
    name: "infomaniak_create_cron_job",
    description: "Create a cron job on a web hosting",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: { type: "number" },
        command: { type: "string" },
        schedule: { type: "string", description: "Cron expression e.g. '0 * * * *'" },
        description: { type: "string" },
      },
      required: ["hosting_id", "command", "schedule"],
    },
  },
  {
    name: "infomaniak_update_cron_job",
    description: "Update a cron job",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" }, cron_id: { type: "number" }, command: { type: "string" }, schedule: { type: "string" }, description: { type: "string" } }, required: ["hosting_id", "cron_id"] },
  },
  {
    name: "infomaniak_delete_cron_job",
    description: "Delete a cron job",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" }, cron_id: { type: "number" } }, required: ["hosting_id", "cron_id"] },
  },
  {
    name: "infomaniak_list_ftp_accounts",
    description: "List all FTP accounts for a web hosting",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" } }, required: ["hosting_id"] },
  },
  {
    name: "infomaniak_create_ftp_account",
    description: "Create an FTP account",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" }, login: { type: "string" }, password: { type: "string" }, home_directory: { type: "string" } }, required: ["hosting_id", "login", "password"] },
  },
  {
    name: "infomaniak_update_ftp_account",
    description: "Update an FTP account",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" }, ftp_id: { type: "number" }, password: { type: "string" }, home_directory: { type: "string" }, is_active: { type: "boolean" } }, required: ["hosting_id", "ftp_id"] },
  },
  {
    name: "infomaniak_delete_ftp_account",
    description: "Delete an FTP account",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" }, ftp_id: { type: "number" } }, required: ["hosting_id", "ftp_id"] },
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

  {
    name: "infomaniak_list_kdrive_files",
    description: "List files in a kDrive directory",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, parent_id: { type: "number", description: "Parent directory ID (omit for root)" } }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_get_kdrive_file",
    description: "Get details about a file or directory in kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_search_kdrive_files",
    description: "Search for files in a kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, query: { type: "string" } }, required: ["drive_id", "query"] },
  },
  {
    name: "infomaniak_create_kdrive_directory",
    description: "Create a new directory in a kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, name: { type: "string" }, parent_id: { type: "number" } }, required: ["drive_id", "name"] },
  },
  {
    name: "infomaniak_move_kdrive_file",
    description: "Move a file or directory to another location in kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" }, destination_directory_id: { type: "number" } }, required: ["drive_id", "file_id", "destination_directory_id"] },
  },
  {
    name: "infomaniak_copy_kdrive_file",
    description: "Copy a file or directory in kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" }, destination_directory_id: { type: "number" } }, required: ["drive_id", "file_id", "destination_directory_id"] },
  },
  {
    name: "infomaniak_rename_kdrive_file",
    description: "Rename a file or directory in kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" }, name: { type: "string" } }, required: ["drive_id", "file_id", "name"] },
  },
  {
    name: "infomaniak_delete_kdrive_file",
    description: "Delete a file or directory from kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_share_kdrive_file",
    description: "Create a shareable link for a file or directory in kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" }, right: { type: "string", enum: ["public", "password", "inherit"] }, valid_until: { type: "string" } }, required: ["drive_id", "file_id"] },
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

  // kDrive Extras
  {
    name: "infomaniak_list_kdrive_trash",
    description: "List files in the kDrive trash",
    inputSchema: { type: "object", properties: { drive_id: { type: "number", description: "The kDrive ID" } }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_restore_kdrive_file",
    description: "Restore a file from the kDrive trash",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_empty_kdrive_trash",
    description: "Permanently delete all files in the kDrive trash",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" } }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_list_kdrive_file_versions",
    description: "List version history of a file in kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_get_kdrive_activity",
    description: "Get activity log for a kDrive or a specific file",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number", description: "Optional: filter by file" } }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_add_kdrive_favorite",
    description: "Add a file or directory to kDrive favorites",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_remove_kdrive_favorite",
    description: "Remove a file or directory from kDrive favorites",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_list_kdrive_favorites",
    description: "List favorite files in a kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" } }, required: ["drive_id"] },
  },

  // Mail Extras
  {
    name: "infomaniak_get_mailbox_autoresponder",
    description: "Get the autoresponder (out-of-office) settings for a mailbox",
    inputSchema: { type: "object", properties: { mail_id: { type: "number" }, mailbox_id: { type: "number" } }, required: ["mail_id", "mailbox_id"] },
  },
  {
    name: "infomaniak_update_mailbox_autoresponder",
    description: "Enable or update the autoresponder for a mailbox",
    inputSchema: {
      type: "object",
      properties: {
        mail_id: { type: "number" },
        mailbox_id: { type: "number" },
        enabled: { type: "boolean", description: "Enable or disable the autoresponder" },
        subject: { type: "string", description: "Auto-reply subject" },
        body: { type: "string", description: "Auto-reply message body" },
        from_date: { type: "string", description: "Start date (ISO 8601)" },
        to_date: { type: "string", description: "End date (ISO 8601)" },
      },
      required: ["mail_id", "mailbox_id", "enabled"],
    },
  },
  {
    name: "infomaniak_list_mailbox_folders",
    description: "List folders in a mailbox",
    inputSchema: { type: "object", properties: { mail_id: { type: "number" }, mailbox_id: { type: "number" } }, required: ["mail_id", "mailbox_id"] },
  },

  // kChat Tools
  {
    name: "infomaniak_kchat_get_me",
    description: "Get the current kChat user profile",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "infomaniak_kchat_list_teams",
    description: "List all kChat teams",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "infomaniak_kchat_list_my_teams",
    description: "List kChat teams the current user belongs to",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "infomaniak_kchat_list_channels",
    description: "List all channels in a kChat team",
    inputSchema: { type: "object", properties: { team_id: { type: "string", description: "The team ID" } }, required: ["team_id"] },
  },
  {
    name: "infomaniak_kchat_list_my_channels",
    description: "List kChat channels the current user is a member of",
    inputSchema: { type: "object", properties: { team_id: { type: "string", description: "The team ID" } }, required: ["team_id"] },
  },
  {
    name: "infomaniak_kchat_get_channel",
    description: "Get details about a kChat channel",
    inputSchema: { type: "object", properties: { channel_id: { type: "string", description: "The channel ID" } }, required: ["channel_id"] },
  },
  {
    name: "infomaniak_kchat_get_channel_posts",
    description: "Get recent posts in a kChat channel",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        page: { type: "number", description: "Page number (0-indexed)" },
        per_page: { type: "number", description: "Posts per page (max 200)" },
      },
      required: ["channel_id"],
    },
  },
  {
    name: "infomaniak_kchat_create_post",
    description: "Send a message to a kChat channel",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "The channel ID" },
        message: { type: "string", description: "Message text (supports Markdown)" },
        root_id: { type: "string", description: "Parent post ID for threading" },
      },
      required: ["channel_id", "message"],
    },
  },
  {
    name: "infomaniak_kchat_delete_post",
    description: "Delete a kChat post",
    inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"] },
  },
  {
    name: "infomaniak_kchat_search_posts",
    description: "Search posts in a kChat team",
    inputSchema: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        terms: { type: "string", description: "Search terms" },
        is_or_search: { type: "boolean", description: "Use OR logic between terms" },
      },
      required: ["team_id", "terms"],
    },
  },
  {
    name: "infomaniak_kchat_create_direct",
    description: "Create or get a direct message channel between two users",
    inputSchema: {
      type: "object",
      properties: { user_ids: { type: "array", items: { type: "string" }, description: "Exactly two user IDs" } },
      required: ["user_ids"],
    },
  },
  {
    name: "infomaniak_kchat_search_users",
    description: "Search kChat users by username or name",
    inputSchema: { type: "object", properties: { term: { type: "string", description: "Search term" } }, required: ["term"] },
  },
  {
    name: "infomaniak_kchat_list_users",
    description: "List kChat users, optionally filtered by team or channel",
    inputSchema: {
      type: "object",
      properties: {
        in_team_id: { type: "string", description: "Filter by team" },
        in_channel_id: { type: "string", description: "Filter by channel" },
      },
      required: [],
    },
  },
];

/**
 * Handle a tool call and return the result
 */
async function handleToolCall(
  client: InfomaniakClient,
  name: string,
  args: Record<string, unknown> | undefined,
  kchatClient?: KChatClient | null,
): Promise<unknown> {
  if (name.startsWith("infomaniak_kchat_")) {
    if (!kchatClient) throw new Error("kChat is not configured. Set KCHAT_HOST and KCHAT_TOKEN environment variables.");
    return handleKChatToolCall(kchatClient, name, args);
  }
  switch (name) {
    // Profile & Account (no validation needed - no args)
    case "infomaniak_ping":
      return client.ping();

    case "infomaniak_get_profile":
      return client.getProfile();

    case "infomaniak_list_accounts":
      return client.getAccounts();

    case "infomaniak_get_account": {
      const validated = validate(AccountIdSchema, args);
      return client.getAccount(validated.account_id);
    }

    case "infomaniak_list_products": {
      const validated = validate(AccountIdSchema, args);
      return client.getAccountProducts(validated.account_id);
    }

    // Domains
    case "infomaniak_list_domains": {
      const validated = validate(AccountIdSchema, args);
      return client.getDomains(validated.account_id);
    }

    case "infomaniak_get_domain": {
      const validated = validate(GetDomainSchema, args);
      return client.getDomain(validated.account_id, validated.domain);
    }

    case "infomaniak_get_domain_nameservers": {
      const validated = validate(GetDomainNameserversSchema, args);
      return client.getDomainNameservers(validated.domain);
    }
    case "infomaniak_update_domain_nameservers": {
      const validated = validate(UpdateDomainNameserversSchema, args);
      return client.updateDomainNameservers(validated.domain, validated.nameservers);
    }
    case "infomaniak_renew_domain": {
      const validated = validate(RenewDomainSchema, args);
      return client.renewDomain(validated.domain, validated.duration);
    }

    case "infomaniak_list_dns_records": {
      const validated = validate(ListDnsRecordsSchema, args);
      return client.getDnsRecords(validated.domain);
    }

    case "infomaniak_create_dns_record": {
      const validated = validate(CreateDnsRecordSchema, args);
      return client.createDnsRecord(validated.domain, {
        source: validated.source,
        type: validated.type,
        target: validated.target,
        ttl: validated.ttl,
        priority: validated.priority,
      });
    }

    case "infomaniak_update_dns_record": {
      const validated = validate(UpdateDnsRecordSchema, args);
      return client.updateDnsRecord(
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
    }

    case "infomaniak_delete_dns_record": {
      const validated = validate(DeleteDnsRecordSchema, args);
      return client.deleteDnsRecord(validated.domain, validated.record_id);
    }

    // Mail Services
    case "infomaniak_list_mail_services": {
      const validated = validate(AccountIdSchema, args);
      return client.getMailServices(validated.account_id);
    }

    case "infomaniak_get_mail_service": {
      const validated = validate(MailIdSchema, args);
      return client.getMailService(validated.mail_id);
    }

    case "infomaniak_list_mailboxes": {
      const validated = validate(MailIdSchema, args);
      return client.getMailboxes(validated.mail_id);
    }

    case "infomaniak_get_mailbox": {
      const validated = validate(MailboxIdSchema, args);
      return client.getMailbox(validated.mail_id, validated.mailbox_id);
    }

    case "infomaniak_create_mailbox": {
      const validated = validate(CreateMailboxSchema, args);
      return client.createMailbox(validated.mail_id, {
        mailbox_name: validated.mailbox_name,
        password: validated.password,
        max_size: validated.max_size,
      });
    }

    case "infomaniak_update_mailbox": {
      const validated = validate(UpdateMailboxSchema, args);
      return client.updateMailbox(
        validated.mail_id,
        validated.mailbox_id,
        {
          password: validated.password,
          max_size: validated.max_size,
        }
      );
    }

    case "infomaniak_delete_mailbox": {
      const validated = validate(DeleteMailboxSchema, args);
      return client.deleteMailbox(validated.mail_id, validated.mailbox_id);
    }

    case "infomaniak_add_mailbox_alias": {
      const validated = validate(MailboxAliasSchema, args);
      return client.addMailboxAlias(
        validated.mail_id,
        validated.mailbox_id,
        validated.alias
      );
    }

    case "infomaniak_delete_mailbox_alias": {
      const validated = validate(MailboxAliasSchema, args);
      return client.deleteMailboxAlias(
        validated.mail_id,
        validated.mailbox_id,
        validated.alias
      );
    }

    case "infomaniak_list_email_redirections": {
      const validated = validate(MailIdSchema, args);
      return client.getEmailRedirections(validated.mail_id);
    }
    case "infomaniak_create_email_redirection": {
      const validated = validate(CreateEmailRedirectionSchema, args);
      return client.createEmailRedirection(validated.mail_id, { from: validated.from, to: validated.to, keep_copy: validated.keep_copy });
    }
    case "infomaniak_delete_email_redirection": {
      const validated = validate(EmailRedirectionIdSchema, args);
      return client.deleteEmailRedirection(validated.mail_id, validated.redirection_id);
    }

    // Web Hosting
    case "infomaniak_list_web_hostings": {
      const validated = validate(AccountIdSchema, args);
      return client.getWebHostings(validated.account_id);
    }

    case "infomaniak_get_web_hosting": {
      const validated = validate(HostingIdSchema, args);
      return client.getWebHosting(validated.hosting_id);
    }

    case "infomaniak_list_sites": {
      const validated = validate(HostingIdSchema, args);
      return client.getSites(validated.hosting_id);
    }

    case "infomaniak_get_site": {
      const validated = validate(SiteIdSchema, args);
      return client.getSite(validated.hosting_id, validated.site_id);
    }

    case "infomaniak_create_site": {
      const validated = validate(CreateSiteSchema, args);
      return client.createSite(validated.hosting_id, {
        fqdn: validated.fqdn,
        path: validated.path,
        php_version: validated.php_version,
      });
    }

    case "infomaniak_update_site": {
      const validated = validate(UpdateSiteSchema, args);
      return client.updateSite(
        validated.hosting_id,
        validated.site_id,
        {
          path: validated.path,
          php_version: validated.php_version,
        }
      );
    }

    case "infomaniak_delete_site": {
      const validated = validate(DeleteSiteSchema, args);
      return client.deleteSite(validated.hosting_id, validated.site_id);
    }

    // Databases
    case "infomaniak_list_databases": {
      const validated = validate(HostingIdSchema, args);
      return client.getDatabases(validated.hosting_id);
    }

    case "infomaniak_get_database": {
      const validated = validate(DatabaseIdSchema, args);
      return client.getDatabase(validated.hosting_id, validated.database_id);
    }

    case "infomaniak_create_database": {
      const validated = validate(CreateDatabaseSchema, args);
      return client.createDatabase(validated.hosting_id, {
        name: validated.name,
        charset: validated.charset,
      });
    }

    case "infomaniak_delete_database": {
      const validated = validate(DeleteDatabaseSchema, args);
      return client.deleteDatabase(validated.hosting_id, validated.database_id);
    }

    case "infomaniak_list_cron_jobs": {
      const validated = validate(HostingIdSchema, args);
      return client.getCronJobs(validated.hosting_id);
    }
    case "infomaniak_create_cron_job": {
      const validated = validate(CreateCronJobSchema, args);
      return client.createCronJob(validated.hosting_id, { command: validated.command, schedule: validated.schedule, description: validated.description });
    }
    case "infomaniak_update_cron_job": {
      const validated = validate(UpdateCronJobSchema, args);
      return client.updateCronJob(validated.hosting_id, validated.cron_id, { command: validated.command, schedule: validated.schedule, description: validated.description });
    }
    case "infomaniak_delete_cron_job": {
      const validated = validate(CronJobIdSchema, args);
      return client.deleteCronJob(validated.hosting_id, validated.cron_id);
    }
    case "infomaniak_list_ftp_accounts": {
      const validated = validate(HostingIdSchema, args);
      return client.getFtpAccounts(validated.hosting_id);
    }
    case "infomaniak_create_ftp_account": {
      const validated = validate(CreateFtpAccountSchema, args);
      return client.createFtpAccount(validated.hosting_id, { login: validated.login, password: validated.password, home_directory: validated.home_directory });
    }
    case "infomaniak_update_ftp_account": {
      const validated = validate(UpdateFtpAccountSchema, args);
      return client.updateFtpAccount(validated.hosting_id, validated.ftp_id, { password: validated.password, home_directory: validated.home_directory, is_active: validated.is_active });
    }
    case "infomaniak_delete_ftp_account": {
      const validated = validate(FtpAccountIdSchema, args);
      return client.deleteFtpAccount(validated.hosting_id, validated.ftp_id);
    }

    // kDrive
    case "infomaniak_list_kdrives": {
      const validated = validate(AccountIdSchema, args);
      return client.getKDrives(validated.account_id);
    }

    case "infomaniak_get_kdrive": {
      const validated = validate(DriveIdSchema, args);
      return client.getKDrive(validated.drive_id);
    }

    case "infomaniak_list_kdrive_files": {
      const validated = validate(ListKDriveFilesSchema, args);
      return client.listKDriveFiles(validated.drive_id, validated.parent_id);
    }
    case "infomaniak_get_kdrive_file": {
      const validated = validate(KDriveFileIdSchema, args);
      return client.getKDriveFile(validated.drive_id, validated.file_id);
    }
    case "infomaniak_search_kdrive_files": {
      const validated = validate(SearchKDriveFilesSchema, args);
      return client.searchKDriveFiles(validated.drive_id, validated.query);
    }
    case "infomaniak_create_kdrive_directory": {
      const validated = validate(CreateKDriveDirectorySchema, args);
      return client.createKDriveDirectory(validated.drive_id, { name: validated.name, parent_id: validated.parent_id });
    }
    case "infomaniak_move_kdrive_file": {
      const validated = validate(MoveOrCopyKDriveFileSchema, args);
      return client.moveKDriveFile(validated.drive_id, validated.file_id, validated.destination_directory_id);
    }
    case "infomaniak_copy_kdrive_file": {
      const validated = validate(MoveOrCopyKDriveFileSchema, args);
      return client.copyKDriveFile(validated.drive_id, validated.file_id, validated.destination_directory_id);
    }
    case "infomaniak_rename_kdrive_file": {
      const validated = validate(RenameKDriveFileSchema, args);
      return client.renameKDriveFile(validated.drive_id, validated.file_id, validated.name);
    }
    case "infomaniak_delete_kdrive_file": {
      const validated = validate(KDriveFileIdSchema, args);
      return client.deleteKDriveFile(validated.drive_id, validated.file_id);
    }
    case "infomaniak_share_kdrive_file": {
      const validated = validate(ShareKDriveFileSchema, args);
      return client.shareKDriveFile(validated.drive_id, validated.file_id, { right: validated.right, valid_until: validated.valid_until });
    }

    // Swiss Backup
    case "infomaniak_list_swiss_backups": {
      const validated = validate(AccountIdSchema, args);
      return client.getSwissBackups(validated.account_id);
    }

    case "infomaniak_get_swiss_backup": {
      const validated = validate(BackupIdSchema, args);
      return client.getSwissBackup(validated.backup_id);
    }

    case "infomaniak_list_swiss_backup_slots": {
      const validated = validate(BackupIdSchema, args);
      return client.getSwissBackupSlots(validated.backup_id);
    }

    // VPS (no validation for list)
    case "infomaniak_list_vps":
      return client.getVpsList();

    case "infomaniak_get_vps": {
      const validated = validate(VpsIdSchema, args);
      return client.getVps(validated.vps_id);
    }

    case "infomaniak_reboot_vps": {
      const validated = validate(VpsIdSchema, args);
      return client.rebootVps(validated.vps_id);
    }

    case "infomaniak_shutdown_vps": {
      const validated = validate(VpsIdSchema, args);
      return client.shutdownVps(validated.vps_id);
    }

    case "infomaniak_boot_vps": {
      const validated = validate(VpsIdSchema, args);
      return client.bootVps(validated.vps_id);
    }

    // Dedicated Servers (no validation for list)
    case "infomaniak_list_dedicated_servers":
      return client.getDedicatedServers();

    case "infomaniak_get_dedicated_server": {
      const validated = validate(ServerIdSchema, args);
      return client.getDedicatedServer(validated.server_id);
    }

    case "infomaniak_reboot_dedicated_server": {
      const validated = validate(ServerIdSchema, args);
      return client.rebootDedicatedServer(validated.server_id);
    }

    // SSL Certificates
    case "infomaniak_list_certificates": {
      const validated = validate(AccountIdSchema, args);
      return client.getCertificates(validated.account_id);
    }

    case "infomaniak_get_certificate": {
      const validated = validate(CertificateIdSchema, args);
      return client.getCertificate(validated.certificate_id);
    }

    // Invoicing
    case "infomaniak_list_invoices": {
      const validated = validate(AccountIdSchema, args);
      return client.getInvoices(validated.account_id);
    }

    case "infomaniak_get_invoice": {
      const validated = validate(InvoiceIdSchema, args);
      return client.getInvoice(validated.account_id, validated.invoice_id);
    }

    // Generic API Call
    case "infomaniak_api_call": {
      const validated = validate(ApiCallSchema, args);
      return client.call(
        validated.method,
        validated.endpoint,
        validated.body,
        validated.query_params
      );
    }

    // kDrive Extras
    case "infomaniak_list_kdrive_trash": {
      const validated = validate(KDriveTrashSchema, args);
      return client.listKDriveTrash(validated.drive_id);
    }

    case "infomaniak_restore_kdrive_file": {
      const validated = validate(KDriveFileIdSchema, args);
      return client.restoreKDriveFile(validated.drive_id, validated.file_id);
    }

    case "infomaniak_empty_kdrive_trash": {
      const validated = validate(DriveIdSchema, args);
      return client.emptyKDriveTrash(validated.drive_id);
    }

    case "infomaniak_list_kdrive_file_versions": {
      const validated = validate(KDriveFileIdSchema, args);
      return client.listKDriveFileVersions(validated.drive_id, validated.file_id);
    }

    case "infomaniak_get_kdrive_activity": {
      const validated = validate(KDriveActivitySchema, args);
      return client.getKDriveActivity(validated.drive_id, validated.file_id);
    }

    case "infomaniak_add_kdrive_favorite": {
      const validated = validate(KDriveFileIdSchema, args);
      return client.addKDriveFavorite(validated.drive_id, validated.file_id);
    }

    case "infomaniak_remove_kdrive_favorite": {
      const validated = validate(KDriveFileIdSchema, args);
      return client.removeKDriveFavorite(validated.drive_id, validated.file_id);
    }

    case "infomaniak_list_kdrive_favorites": {
      const validated = validate(KDriveFavoritesSchema, args);
      return client.listKDriveFavorites(validated.drive_id);
    }

    // Mail Extras
    case "infomaniak_get_mailbox_autoresponder": {
      const validated = validate(MailboxIdSchema, args);
      return client.getMailboxAutoresponder(validated.mail_id, validated.mailbox_id);
    }

    case "infomaniak_update_mailbox_autoresponder": {
      const validated = validate(UpdateMailboxAutoresponderSchema, args);
      return client.updateMailboxAutoresponder(validated.mail_id, validated.mailbox_id, {
        enabled: validated.enabled,
        subject: validated.subject,
        body: validated.body,
        from_date: validated.from_date,
        to_date: validated.to_date,
      });
    }

    case "infomaniak_list_mailbox_folders": {
      const validated = validate(MailboxIdSchema, args);
      return client.listMailboxFolders(validated.mail_id, validated.mailbox_id);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleKChatToolCall(
  client: KChatClient,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<unknown> {
  switch (name) {
    case "infomaniak_kchat_get_me":
      return client.getMe();

    case "infomaniak_kchat_list_teams":
      return client.listTeams();

    case "infomaniak_kchat_list_my_teams":
      return client.listMyTeams();

    case "infomaniak_kchat_list_channels": {
      const validated = validate(KChatTeamIdSchema, args);
      return client.listChannels(validated.team_id);
    }

    case "infomaniak_kchat_list_my_channels": {
      const validated = validate(KChatTeamIdSchema, args);
      return client.listMyChannels(validated.team_id);
    }

    case "infomaniak_kchat_get_channel": {
      const validated = validate(KChatChannelIdSchema, args);
      return client.getChannel(validated.channel_id);
    }

    case "infomaniak_kchat_get_channel_posts": {
      const validated = validate(KChatGetChannelPostsSchema, args);
      return client.getChannelPosts(validated.channel_id, validated.page, validated.per_page);
    }

    case "infomaniak_kchat_create_post": {
      const validated = validate(CreateKChatPostSchema, args);
      return client.createPost(validated.channel_id, validated.message, validated.root_id);
    }

    case "infomaniak_kchat_delete_post": {
      const validated = validate(KChatPostIdSchema, args);
      return client.deletePost(validated.post_id);
    }

    case "infomaniak_kchat_search_posts": {
      const validated = validate(SearchKChatPostsSchema, args);
      return client.searchPosts(validated.team_id, validated.terms, validated.is_or_search);
    }

    case "infomaniak_kchat_create_direct": {
      const validated = validate(CreateKChatDirectChannelSchema, args);
      return client.createDirectChannel(validated.user_ids as [string, string]);
    }

    case "infomaniak_kchat_search_users": {
      const validated = validate(SearchKChatUsersSchema, args);
      return client.searchUsers(validated.term);
    }

    case "infomaniak_kchat_list_users": {
      const validated = validate(ListKChatUsersSchema, args);
      return client.listUsers({ inTeamId: validated.in_team_id, inChannelId: validated.in_channel_id });
    }

    default:
      throw new Error(`Unknown kChat tool: ${name}`);
  }
}

/**
 * Create and configure an MCP server instance
 *
 * @param client - The Infomaniak API client to use for tool calls
 * @returns Configured MCP Server instance
 */
export function createMcpServer(client: InfomaniakClient, kchatClient?: KChatClient | null): Server {
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
      const result = await handleToolCall(client, name, args, kchatClient);

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

  return server;
}
