/**
 * Unit tests for Zod validation schemas
 */

import { describe, it, expect } from 'vitest';
import {
  validate,
  AccountIdSchema,
  DomainNameSchema,
  CreateDnsRecordSchema,
  UpdateDnsRecordSchema,
  DeleteDnsRecordSchema,
  CreateMailboxSchema,
  MailboxAliasSchema,
  CreateSiteSchema,
  CreateDatabaseSchema,
  ApiCallSchema,
} from './schemas.js';

describe('validate helper', () => {
  it('should return validated data on success', () => {
    const result = validate(AccountIdSchema, { account_id: 123 });
    expect(result.account_id).toBe(123);
  });

  it('should throw descriptive error on validation failure', () => {
    expect(() => validate(AccountIdSchema, {})).toThrow('Validation error: account_id: account_id is required');
  });

  it('should include field path in error message', () => {
    expect(() => validate(AccountIdSchema, { account_id: -1 })).toThrow('account_id: account_id must be positive');
  });
});

describe('AccountIdSchema', () => {
  it('should accept valid account_id', () => {
    const result = validate(AccountIdSchema, { account_id: 12345 });
    expect(result.account_id).toBe(12345);
  });

  it('should reject missing account_id', () => {
    expect(() => validate(AccountIdSchema, {})).toThrow('account_id is required');
  });

  it('should reject negative account_id', () => {
    expect(() => validate(AccountIdSchema, { account_id: -1 })).toThrow('account_id must be positive');
  });

  it('should reject zero account_id', () => {
    expect(() => validate(AccountIdSchema, { account_id: 0 })).toThrow('account_id must be positive');
  });

  it('should reject non-number account_id', () => {
    expect(() => validate(AccountIdSchema, { account_id: 'abc' })).toThrow('Validation error');
  });
});

describe('DomainNameSchema', () => {
  it('should accept valid domain', () => {
    const result = validate(DomainNameSchema, { domain: 'example.com' });
    expect(result.domain).toBe('example.com');
  });

  it('should reject empty domain', () => {
    expect(() => validate(DomainNameSchema, { domain: '' })).toThrow('domain cannot be empty');
  });

  it('should reject missing domain', () => {
    expect(() => validate(DomainNameSchema, {})).toThrow('domain is required');
  });
});

describe('CreateDnsRecordSchema', () => {
  it('should accept valid A record', () => {
    const result = validate(CreateDnsRecordSchema, {
      domain: 'example.com',
      source: 'www',
      type: 'A',
      target: '192.168.1.1',
    });
    expect(result.type).toBe('A');
    expect(result.source).toBe('www');
  });

  it('should accept valid MX record with priority', () => {
    const result = validate(CreateDnsRecordSchema, {
      domain: 'example.com',
      source: '@',
      type: 'MX',
      target: 'mail.example.com',
      priority: 10,
    });
    expect(result.priority).toBe(10);
  });

  it('should accept optional TTL', () => {
    const result = validate(CreateDnsRecordSchema, {
      domain: 'example.com',
      source: '@',
      type: 'TXT',
      target: 'v=spf1 include:_spf.google.com ~all',
      ttl: 3600,
    });
    expect(result.ttl).toBe(3600);
  });

  it('should reject invalid record type', () => {
    expect(() =>
      validate(CreateDnsRecordSchema, {
        domain: 'example.com',
        source: '@',
        type: 'INVALID',
        target: '1.2.3.4',
      })
    ).toThrow('Validation error');
  });

  it('should reject TTL below minimum', () => {
    expect(() =>
      validate(CreateDnsRecordSchema, {
        domain: 'example.com',
        source: '@',
        type: 'A',
        target: '1.2.3.4',
        ttl: 30,
      })
    ).toThrow('Validation error');
  });

  it('should reject TTL above maximum', () => {
    expect(() =>
      validate(CreateDnsRecordSchema, {
        domain: 'example.com',
        source: '@',
        type: 'A',
        target: '1.2.3.4',
        ttl: 100000,
      })
    ).toThrow('Validation error');
  });

  it('should reject empty target', () => {
    expect(() =>
      validate(CreateDnsRecordSchema, {
        domain: 'example.com',
        source: '@',
        type: 'A',
        target: '',
      })
    ).toThrow('target cannot be empty');
  });

  it('should accept all valid record types', () => {
    const types = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];
    for (const type of types) {
      const result = validate(CreateDnsRecordSchema, {
        domain: 'example.com',
        source: '@',
        type,
        target: 'target.example.com',
      });
      expect(result.type).toBe(type);
    }
  });
});

describe('UpdateDnsRecordSchema', () => {
  it('should require domain and record_id', () => {
    const result = validate(UpdateDnsRecordSchema, {
      domain: 'example.com',
      record_id: 123,
    });
    expect(result.domain).toBe('example.com');
    expect(result.record_id).toBe(123);
  });

  it('should accept partial updates', () => {
    const result = validate(UpdateDnsRecordSchema, {
      domain: 'example.com',
      record_id: 123,
      target: '5.6.7.8',
    });
    expect(result.target).toBe('5.6.7.8');
    expect(result.ttl).toBeUndefined();
  });

  it('should reject invalid record_id', () => {
    expect(() =>
      validate(UpdateDnsRecordSchema, {
        domain: 'example.com',
        record_id: -1,
      })
    ).toThrow('Validation error');
  });
});

describe('DeleteDnsRecordSchema', () => {
  it('should accept valid deletion request', () => {
    const result = validate(DeleteDnsRecordSchema, {
      domain: 'example.com',
      record_id: 456,
    });
    expect(result.record_id).toBe(456);
  });

  it('should reject missing record_id', () => {
    expect(() =>
      validate(DeleteDnsRecordSchema, {
        domain: 'example.com',
      })
    ).toThrow('record_id is required');
  });
});

describe('CreateMailboxSchema', () => {
  it('should accept valid mailbox creation', () => {
    const result = validate(CreateMailboxSchema, {
      mail_id: 100,
      mailbox_name: 'info',
      password: 'SecurePass123!',
    });
    expect(result.mailbox_name).toBe('info');
  });

  it('should accept optional max_size', () => {
    const result = validate(CreateMailboxSchema, {
      mail_id: 100,
      mailbox_name: 'info',
      password: 'SecurePass123!',
      max_size: 5000,
    });
    expect(result.max_size).toBe(5000);
  });

  it('should reject short password', () => {
    expect(() =>
      validate(CreateMailboxSchema, {
        mail_id: 100,
        mailbox_name: 'info',
        password: 'short',
      })
    ).toThrow('password must be at least 8 characters');
  });

  it('should reject empty mailbox_name', () => {
    expect(() =>
      validate(CreateMailboxSchema, {
        mail_id: 100,
        mailbox_name: '',
        password: 'SecurePass123!',
      })
    ).toThrow('mailbox_name cannot be empty');
  });
});

describe('MailboxAliasSchema', () => {
  it('should accept valid email alias', () => {
    const result = validate(MailboxAliasSchema, {
      mail_id: 100,
      mailbox_id: 200,
      alias: 'contact@example.com',
    });
    expect(result.alias).toBe('contact@example.com');
  });

  it('should reject invalid email format', () => {
    expect(() =>
      validate(MailboxAliasSchema, {
        mail_id: 100,
        mailbox_id: 200,
        alias: 'not-an-email',
      })
    ).toThrow('alias must be a valid email');
  });
});

describe('CreateSiteSchema', () => {
  it('should accept valid site creation', () => {
    const result = validate(CreateSiteSchema, {
      hosting_id: 50,
      fqdn: 'mysite.example.com',
    });
    expect(result.fqdn).toBe('mysite.example.com');
  });

  it('should accept optional php_version', () => {
    const result = validate(CreateSiteSchema, {
      hosting_id: 50,
      fqdn: 'mysite.example.com',
      php_version: '8.2',
    });
    expect(result.php_version).toBe('8.2');
  });

  it('should reject empty fqdn', () => {
    expect(() =>
      validate(CreateSiteSchema, {
        hosting_id: 50,
        fqdn: '',
      })
    ).toThrow('fqdn cannot be empty');
  });
});

describe('CreateDatabaseSchema', () => {
  it('should accept valid database creation', () => {
    const result = validate(CreateDatabaseSchema, {
      hosting_id: 50,
      name: 'mydb',
    });
    expect(result.name).toBe('mydb');
  });

  it('should accept optional charset', () => {
    const result = validate(CreateDatabaseSchema, {
      hosting_id: 50,
      name: 'mydb',
      charset: 'utf8mb4',
    });
    expect(result.charset).toBe('utf8mb4');
  });

  it('should reject empty database name', () => {
    expect(() =>
      validate(CreateDatabaseSchema, {
        hosting_id: 50,
        name: '',
      })
    ).toThrow('database name cannot be empty');
  });
});

describe('ApiCallSchema', () => {
  it('should accept valid GET request', () => {
    const result = validate(ApiCallSchema, {
      method: 'GET',
      endpoint: '/1/account',
    });
    expect(result.method).toBe('GET');
  });

  it('should accept POST request with body', () => {
    const result = validate(ApiCallSchema, {
      method: 'POST',
      endpoint: '/1/domain/example.com/dns/record',
      body: { source: '@', type: 'A', target: '1.2.3.4' },
    });
    expect(result.body).toEqual({ source: '@', type: 'A', target: '1.2.3.4' });
  });

  it('should accept query_params', () => {
    const result = validate(ApiCallSchema, {
      method: 'GET',
      endpoint: '/1/mail',
      query_params: { account_id: '123' },
    });
    expect(result.query_params).toEqual({ account_id: '123' });
  });

  it('should reject invalid HTTP method', () => {
    expect(() =>
      validate(ApiCallSchema, {
        method: 'INVALID',
        endpoint: '/1/test',
      })
    ).toThrow('Validation error');
  });

  it('should reject endpoint not starting with /', () => {
    expect(() =>
      validate(ApiCallSchema, {
        method: 'GET',
        endpoint: '1/account',
      })
    ).toThrow('endpoint must start with /');
  });

  it('should accept all valid HTTP methods', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
    for (const method of methods) {
      const result = validate(ApiCallSchema, {
        method,
        endpoint: '/1/test',
      });
      expect(result.method).toBe(method);
    }
  });
});
