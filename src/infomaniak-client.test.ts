/**
 * Unit tests for InfomaniakClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InfomaniakClient } from './infomaniak-client.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('InfomaniakClient', () => {
  let client: InfomaniakClient;

  beforeEach(() => {
    vi.resetAllMocks();
    client = new InfomaniakClient({ token: 'test-token-123' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default base URL', () => {
      const client = new InfomaniakClient({ token: 'token' });
      expect(client).toBeDefined();
    });

    it('should accept custom base URL', () => {
      const client = new InfomaniakClient({
        token: 'token',
        baseUrl: 'https://custom.api.com',
      });
      expect(client).toBeDefined();
    });
  });

  describe('authentication', () => {
    it('should add Bearer token to Authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', data: { message: 'pong' } }),
      });

      await client.ping();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/ping',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token-123',
          }),
        })
      );
    });

    it('should include Content-Type and Accept headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', data: {} }),
      });

      await client.ping();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        })
      );
    });
  });

  describe('error handling', () => {
    it('should throw error on 401 Unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(client.ping()).rejects.toThrow('Infomaniak API Error (401): Unauthorized');
    });

    it('should throw error on 403 Forbidden', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      });

      await expect(client.getAccounts()).rejects.toThrow('Infomaniak API Error (403): Forbidden');
    });

    it('should throw error on 404 Not Found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      });

      await expect(client.getAccount(99999)).rejects.toThrow('Infomaniak API Error (404): Not Found');
    });

    it('should throw error on 429 Rate Limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      await expect(client.ping()).rejects.toThrow('Infomaniak API Error (429): Rate limit exceeded');
    });

    it('should parse JSON error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: {
                code: 'invalid_parameter',
                description: 'The domain parameter is invalid',
              },
            })
          ),
      });

      await expect(client.getDnsRecords('invalid')).rejects.toThrow(
        'Infomaniak API Error (400): The domain parameter is invalid'
      );
    });

    it('should handle non-JSON error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(client.ping()).rejects.toThrow('Infomaniak API Error (500): Internal Server Error');
    });
  });

  describe('ping', () => {
    it('should call GET /1/ping', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', data: { message: 'pong' } }),
      });

      const result = await client.ping();

      expect(mockFetch).toHaveBeenCalledWith('https://api.infomaniak.com/1/ping', expect.objectContaining({ method: 'GET' }));
      expect(result.result).toBe('success');
    });
  });

  describe('getProfile', () => {
    it('should call GET /1/profile', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            data: {
              id: 123,
              login: 'testuser',
              email: 'test@example.com',
              first_name: 'Test',
              last_name: 'User',
            },
          }),
      });

      const result = await client.getProfile();

      expect(mockFetch).toHaveBeenCalledWith('https://api.infomaniak.com/1/profile', expect.objectContaining({ method: 'GET' }));
      expect(result.data.login).toBe('testuser');
    });
  });

  describe('getAccounts', () => {
    it('should call GET /1/account', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            data: [{ id: 1, name: 'Account 1' }],
          }),
      });

      const result = await client.getAccounts();

      expect(mockFetch).toHaveBeenCalledWith('https://api.infomaniak.com/1/account', expect.objectContaining({ method: 'GET' }));
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getAccount', () => {
    it('should call GET /1/account/:id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            data: { id: 123, name: 'My Account' },
          }),
      });

      const result = await client.getAccount(123);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/account/123',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.data.id).toBe(123);
    });
  });

  describe('DNS Records', () => {
    it('should list DNS records for a domain', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            data: [
              { id: 1, source: '@', type: 'A', target: '1.2.3.4', ttl: 3600 },
              { id: 2, source: 'www', type: 'CNAME', target: 'example.com', ttl: 3600 },
            ],
          }),
      });

      const result = await client.getDnsRecords('example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/domain/example.com/dns/record',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.data).toHaveLength(2);
    });

    it('should create a DNS record', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            data: { id: 123, source: 'test', type: 'A', target: '1.2.3.4', ttl: 3600 },
          }),
      });

      const result = await client.createDnsRecord('example.com', {
        source: 'test',
        type: 'A',
        target: '1.2.3.4',
        ttl: 3600,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/domain/example.com/dns/record',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ source: 'test', type: 'A', target: '1.2.3.4', ttl: 3600 }),
        })
      );
      expect(result.data.id).toBe(123);
    });

    it('should update a DNS record', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            data: { id: 123, source: 'test', type: 'A', target: '5.6.7.8', ttl: 7200 },
          }),
      });

      await client.updateDnsRecord('example.com', 123, {
        target: '5.6.7.8',
        ttl: 7200,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/domain/example.com/dns/record/123',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ target: '5.6.7.8', ttl: 7200 }),
        })
      );
    });

    it('should delete a DNS record', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', data: null }),
      });

      await client.deleteDnsRecord('example.com', 123);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/domain/example.com/dns/record/123',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('Mail Services', () => {
    it('should list mail services with account_id query param', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            data: [{ id: 1, customer_name: 'example.com' }],
          }),
      });

      await client.getMailServices(456);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/mail?account_id=456',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should create a mailbox', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            data: { id: 789, mailbox_name: 'info', email: 'info@example.com' },
          }),
      });

      await client.createMailbox(123, {
        mailbox_name: 'info',
        password: 'securepassword123',
        max_size: 5000,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/mail/123/mailbox',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            mailbox_name: 'info',
            password: 'securepassword123',
            max_size: 5000,
          }),
        })
      );
    });
  });

  describe('Web Hosting', () => {
    it('should list sites for a hosting', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            data: [{ id: 1, fqdn: 'example.com' }],
          }),
      });

      await client.getSites(100);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/web/100/site',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should create a site', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            data: { id: 50, fqdn: 'newsite.com' },
          }),
      });

      await client.createSite(100, {
        fqdn: 'newsite.com',
        php_version: '8.2',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/web/100/site',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ fqdn: 'newsite.com', php_version: '8.2' }),
        })
      );
    });
  });

  describe('VPS Operations', () => {
    it('should reboot VPS', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', data: null }),
      });

      await client.rebootVps(999);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/vps/999/reboot',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should shutdown VPS', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', data: null }),
      });

      await client.shutdownVps(999);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/vps/999/shutdown',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should boot VPS', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', data: null }),
      });

      await client.bootVps(999);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/vps/999/boot',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('Generic API Call', () => {
    it('should support custom GET requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', data: { custom: 'response' } }),
      });

      await client.call('GET', '/1/custom/endpoint');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/custom/endpoint',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should support custom POST requests with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', data: {} }),
      });

      await client.call('POST', '/1/custom/endpoint', { key: 'value' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/custom/endpoint',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ key: 'value' }),
        })
      );
    });

    it('should support query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'success', data: [] }),
      });

      await client.call('GET', '/1/search', undefined, { q: 'test', limit: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.infomaniak.com/1/search?q=test&limit=10',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });
});
