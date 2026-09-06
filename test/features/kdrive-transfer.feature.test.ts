import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  BODY_LIMIT,
  DOWNLOAD_LIMIT,
  UPLOAD_LIMIT,
  ENVELOPE_RESERVE,
  createTransferFeature,
  tools,
  PAGE_LIMIT_MIN,
  PAGE_LIMIT_MAX,
  PAGE_LIMIT_DEFAULT,
} from '../../src/application/drive/transfer.feature.js';
import * as navigation from '../../src/application/drive/navigation.feature.js';
import type { DriveTransferPort } from '../../src/application/drive/transfer.port.js';
import { KDriveTransferAdapter } from '../../src/adapters/outbound/infomaniak/kdrive-transfer.adapter.js';
import { InfomaniakGateway, TokenBucket } from '../../src/adapters/outbound/infomaniak/gateway.js';
import * as feature from '../../src/features/kdrive-transfer.feature.js';
import { composeFeatureModules } from '../../src/main/discover-feature-modules.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/kdrive-transfer.json', import.meta.url), 'utf8'),
);
const policy = { readOnly: false, allowRawApi: false, allowExperimental: false };
const item = {
  item: {
    id: 42,
    name: 'été.txt',
    type: 'file',
    sizeBytes: 3,
    parentId: 7,
    mimeType: 'text/plain',
  },
};
const input = { drive_id: 9, file_id: 42 };
const uploadInput = { drive_id: 9, file_name: 'été.txt', base64_content: 'AAEC' };
const cases = [
  {
    name: 'infomaniak_download_kdrive_file',
    input,
    method: 'GET',
    path: '/2/drive/9/files/42/download',
    dto: null,
    output: {
      fileId: 42,
      fileName: 'été.txt',
      contentType: 'application/octet-stream',
      sizeBytes: 3,
      encoding: 'base64',
      content: 'AAEC',
    },
  },
  {
    name: 'infomaniak_upload_kdrive_file',
    input: uploadInput,
    method: 'POST',
    path: '/3/drive/9/upload',
    dto: fixture.item,
    output: item,
  },
  {
    name: 'infomaniak_create_kdrive_directory',
    input: { drive_id: 9, name: 'Archives', parent_id: 7, only_for_me: true },
    method: 'POST',
    path: '/3/drive/9/files/7/directory',
    dto: fixture.directory,
    output: { item: { id: 43, name: 'Archives', type: 'dir', parentId: 7 } },
  },
  {
    name: 'infomaniak_move_kdrive_file',
    input: { ...input, destination_directory_id: 7 },
    method: 'POST',
    path: '/3/drive/9/files/42/move/7',
    dto: fixture.mutation,
    output: { fileId: 42, operation: 'move', success: true },
  },
  {
    name: 'infomaniak_copy_kdrive_file',
    input: { ...input, destination_directory_id: 7 },
    method: 'POST',
    path: '/3/drive/9/files/42/copy/7',
    dto: fixture.item,
    output: item,
  },
  {
    name: 'infomaniak_rename_kdrive_file',
    input: { ...input, name: 'été.txt' },
    method: 'POST',
    path: '/2/drive/9/files/42/rename',
    dto: fixture.mutation,
    output: { fileId: 42, operation: 'rename', success: true },
  },
  {
    name: 'infomaniak_delete_kdrive_file',
    input,
    method: 'DELETE',
    path: '/2/drive/9/files/42',
    dto: fixture.mutation,
    output: { fileId: 42, operation: 'trash', success: true },
  },
];
function setup() {
  let now = 0;
  const clock = {
    now: () => now,
    wait: vi.fn(async (ms: number) => {
      now += ms;
    }),
  };
  const fetcher = vi.fn<typeof fetch>();
  const gateway = new InfomaniakGateway({
    token: 'SECRET',
    timeoutMs: 1000,
    bucket: new TokenBucket(clock),
    fetch: fetcher,
    clock,
    random: () => 0,
    utcNow: () => 0,
  });
  const adapter = new KDriveTransferAdapter(gateway);
  return { fetcher, gateway, adapter, clock, module: createTransferFeature(adapter) };
}
function mockPort() {
  return {
    download: vi.fn<DriveTransferPort['download']>(),
    upload: vi.fn<DriveTransferPort['upload']>().mockResolvedValue(item),
    mkdir: vi.fn<DriveTransferPort['mkdir']>(),
    move: vi.fn<DriveTransferPort['move']>(),
    copy: vi.fn<DriveTransferPort['copy']>(),
    rename: vi.fn<DriveTransferPort['rename']>(),
    trash: vi.fn<DriveTransferPort['trash']>(),
  };
}
function response(dto: unknown) {
  return dto === null
    ? new Response(new Uint8Array([0, 1, 2]), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': "attachment; filename*=UTF-8''%C3%A9t%C3%A9.txt",
        },
      })
    : Response.json(dto);
}

describe('kDrive transfer contracts', () => {
  it('exports exactly seven classified tools and shared limits without redefining pagination', () => {
    expect(tools.map((tool) => tool.name)).toEqual(cases.map((c) => c.name));
    // Only inputSchema differs: registry declarations omit the default-bound superRefine
    // so per-runtime handlers can enforce configured limits, including increases.
    const withoutInputSchema = (tool: (typeof tools)[number]) =>
      Object.fromEntries(Object.entries(tool).filter(([key]) => key !== 'inputSchema'));
    expect(feature.tools.map(withoutInputSchema)).toEqual(tools.map(withoutInputSchema));
    expect(tools.map((tool) => tool.classification)).toEqual([
      'read',
      'write',
      'write',
      'write',
      'write',
      'write',
      'destructive',
    ]);
    expect(tools.map((tool) => tool.idempotent)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect([DOWNLOAD_LIMIT, UPLOAD_LIMIT, BODY_LIMIT, ENVELOPE_RESERVE]).toEqual([
      10485760, 52428800, 20971520, 65536,
    ]);
    expect([PAGE_LIMIT_MIN, PAGE_LIMIT_MAX, PAGE_LIMIT_DEFAULT]).toEqual([
      navigation.PAGE_LIMIT_MIN,
      navigation.PAGE_LIMIT_MAX,
      navigation.PAGE_LIMIT_DEFAULT,
    ]);
  });

  it.each(cases)('serves $name end to end with validated domain JSON', async (c) => {
    const { fetcher, module } = setup();
    fetcher.mockResolvedValue(response(c.dto));
    const result = await module.invoke(c.name, c.input, policy);
    expect(result.structuredContent).toEqual(c.output);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(c.output, null, 2) }]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_DTO');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe(c.path);
    expect(request?.method).toBe(c.method);
    if (c.name.includes('upload')) {
      expect(new URL(String(url)).searchParams.get('total_size')).toBe('3');
      expect(new URL(String(url)).searchParams.get('file_name')).toBe('été.txt');
      expect(request?.body).toEqual(Buffer.from([0, 1, 2]));
    }
    if (c.name.includes('create'))
      expect(JSON.parse(String(request?.body))).toEqual({ name: 'Archives', only_for_me: true });
    if (c.name.includes('rename'))
      expect(JSON.parse(String(request?.body))).toEqual({ name: 'été.txt' });
  });

  it.each(cases.slice(1))('denies $name before validation, port and HTTP', async (c) => {
    const port = mockPort();
    const result = await createTransferFeature(port).invoke(
      c.name,
      {},
      { ...policy, readOnly: true },
    );
    expect(result).toEqual({
      content: [{ type: 'text', text: `[POLICY_DENIED] read_only: ${c.name}` }],
      structuredContent: { error: { code: 'POLICY_DENIED', reason: 'read_only', tool: c.name } },
      isError: true,
      resultType: 'complete',
      _meta: {},
    });
    for (const method of Object.values(port)) expect(method).not.toHaveBeenCalled();
    const { fetcher, gateway } = setup();
    const handlers = feature.createHandlers({
      gateway,
      config: { policy: { ...policy, readOnly: true } },
    });
    expect(await handlers[c.name]({})).toEqual(result.structuredContent);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(cases)('auto-composes $name from gateway and config', async (c) => {
    const { gateway, fetcher, clock } = setup();
    fetcher.mockImplementation(async () => response(c.dto));
    const config = loadRuntimeConfig({
      INFOMANIAK_API_TOKEN: 'SECRET',
      INFOMANIAK_READ_ONLY: 'false',
    });
    const module = composeFeatureModules([feature], {
      gateway,
      config,
      clock,
      createGateway: () => gateway,
    });
    const result = await module.invoke(c.name, c.input, policy);
    expect(result.structuredContent).toEqual(c.output);
    expect(result.content[0].text).toBe(JSON.stringify(c.output, null, 2));
  });

  it.each(cases.slice(1))('does not retry $name after a provider error', async (c) => {
    const { module, fetcher, clock } = setup();
    fetcher.mockImplementation(async () => new Response('SECRET', { status: 503 }));
    await expect(module.invoke(c.name, c.input, policy)).rejects.toThrow('Infomaniak HTTP 503');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(clock.wait).not.toHaveBeenCalled();
  });

  it.each(cases.slice(1))(
    'rejects unsuccessful DTOs for $name without dumping provider data',
    async (c) => {
      const { module, fetcher } = setup();
      fetcher.mockResolvedValue(Response.json({ result: 'error', data: 'SECRET' }));
      await expect(module.invoke(c.name, c.input, policy)).rejects.toThrow(
        /^Invalid Infomaniak response: /,
      );
    },
  );
});

describe('upload admission before decoding and port', () => {
  it.each(['body', 'upload', 'defaults'] as const)(
    'admits exact serialized %s limit and denies +1 including unknown Unicode metadata',
    async (bound) => {
      const effective = bound === 'defaults' ? BODY_LIMIT - ENVELOPE_RESERVE : 512;
      const options =
        bound === 'defaults'
          ? {}
          : bound === 'body'
            ? { bodyLimit: ENVELOPE_RESERVE + effective, uploadLimit: 1024 }
            : { bodyLimit: ENVELOPE_RESERVE + 1024, uploadLimit: effective };
      const port = mockPort();
      const module = createTransferFeature(port, options);
      const args = {
        ...uploadInput,
        content_type: 'text/plain',
        directory_path: 'é/文',
        extra_metadata: '',
      };
      args.extra_metadata = 'x'.repeat(effective - Buffer.byteLength(JSON.stringify(args)));
      expect(Buffer.byteLength(JSON.stringify(args))).toBe(effective);
      await module.invoke(cases[1].name, args, policy);
      expect(port.upload).toHaveBeenCalledTimes(1);
      expect(port.upload.mock.calls[0][0]).toHaveProperty('extra_metadata', args.extra_metadata);
      port.upload.mockClear();
      args.extra_metadata += 'x';
      const decoder = vi.spyOn(Buffer, 'from');
      try {
        await expect(module.invoke(cases[1].name, args, policy)).rejects.toThrow(
          'Upload arguments limit exceeded',
        );
        expect(decoder).not.toHaveBeenCalled();
        expect(port.upload).not.toHaveBeenCalled();
      } finally {
        decoder.mockRestore();
      }
    },
  );

  it('checks base64 length before decoding or scanning a huge payload', async () => {
    const port = mockPort();
    const module = createTransferFeature(port, { bodyLimit: ENVELOPE_RESERVE + 128 });
    const decoder = vi.spyOn(Buffer, 'from');
    try {
      await expect(
        module.invoke(cases[1].name, { ...uploadInput, base64_content: 'A'.repeat(132) }, policy),
      ).rejects.toThrow('Upload arguments limit exceeded');
      expect(decoder).not.toHaveBeenCalled();
      expect(port.upload).not.toHaveBeenCalled();
    } finally {
      decoder.mockRestore();
    }
  });

  it.each(['A', 'AA=', 'AA===', 'A===', 'AA?=', 'AA A', '=AAA'])(
    'rejects malformed base64 %s before port',
    async (base64_content) => {
      const port = mockPort();
      await expect(
        createTransferFeature(port).invoke(
          cases[1].name,
          { ...uploadInput, base64_content },
          policy,
        ),
      ).rejects.toThrow('Invalid base64');
      expect(port.upload).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { text_content: 'a', base64_content: 'YQ==' }])(
    'requires exactly one content encoding: %j',
    async (content) => {
      const port = mockPort();
      await expect(
        createTransferFeature(port).invoke(
          cases[1].name,
          { drive_id: 9, file_name: 'x', ...content },
          policy,
        ),
      ).rejects.toThrow('exactly one');
      expect(port.upload).not.toHaveBeenCalled();
    },
  );

  it('preserves JSON escaping and UTF-8 cost for text content', async () => {
    const args = { drive_id: 9, file_name: '文', text_content: 'é\n"\\' };
    const cost = Buffer.byteLength(JSON.stringify(args));
    const port = mockPort();
    await createTransferFeature(port, { uploadLimit: cost }).invoke(cases[1].name, args, policy);
    await expect(
      createTransferFeature(port, { uploadLimit: cost - 1 }).invoke(cases[1].name, args, policy),
    ).rejects.toThrow('Upload arguments limit exceeded');
    expect(port.upload).toHaveBeenCalledTimes(1);
  });

  it('injects admission limits through the auto-composed module', async () => {
    const { gateway, fetcher } = setup();
    const handlers = feature.createHandlers({
      gateway,
      config: { policy, transfer: { bodyLimit: ENVELOPE_RESERVE + 1 } },
    });
    await expect(handlers[cases[1].name](uploadInput)).rejects.toThrow(
      'Upload arguments limit exceeded',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['reduced', 'increased'] as const)(
    'uses captured %s limits through registry validation',
    async (kind) => {
      const { gateway, fetcher, clock } = setup();
      const effective = kind === 'reduced' ? 256 : BODY_LIMIT;
      const env = {
        INFOMANIAK_API_TOKEN: 'SECRET',
        MCP_HTTP_BODY_LIMIT: String(effective + ENVELOPE_RESERVE),
        KDRIVE_MAX_UPLOAD_BYTES: String(effective),
        KDRIVE_MAX_DOWNLOAD_BYTES: '3',
      };
      const config = loadRuntimeConfig(env);
      env.KDRIVE_MAX_UPLOAD_BYTES = '1';
      const module = composeFeatureModules([feature], {
        gateway,
        config,
        clock,
        createGateway: () => gateway,
      });
      const args = { drive_id: 9, file_name: 'x', base64_content: '', metadata: '' };
      const overhead = Buffer.byteLength(JSON.stringify(args));
      const encoded = Math.floor((effective - overhead) / 4) * 4;
      args.base64_content = 'AAAA'.repeat(encoded / 4);
      args.metadata = 'x'.repeat(effective - Buffer.byteLength(JSON.stringify(args)));
      fetcher.mockResolvedValue(Response.json(fixture.item));
      await module.invoke(cases[1].name, args, policy);
      expect(fetcher).toHaveBeenCalledTimes(1);
      fetcher.mockClear();
      args.metadata += 'é';
      await expect(module.invoke(cases[1].name, args, policy)).rejects.toThrow(
        'Upload arguments limit exceeded',
      );
      expect(fetcher).not.toHaveBeenCalled();
      fetcher.mockResolvedValue(new Response(new Uint8Array(4)));
      await expect(module.invoke(cases[0].name, input, policy)).rejects.toThrow(
        'Download limit exceeded',
      );
    },
  );

  it.each([
    { downloadLimit: -1 },
    { uploadLimit: NaN },
    { bodyLimit: ENVELOPE_RESERVE - 1 },
    { bodyLimit: Infinity },
    { uploadLimit: 0.5 },
  ])('rejects invalid limit options %j', (options) => {
    expect(() => createTransferFeature(mockPort(), options)).toThrow(/limit/i);
  });
});

describe('binary mapping and decoded limits', () => {
  it.each([{ base64_content: 'AAEC' }, { text_content: 'éx' }])(
    'checks actual decoded bytes at the upload limit and +1: %j',
    async (content) => {
      const { adapter, fetcher } = setup();
      fetcher.mockImplementation(async () => Response.json(fixture.item));
      const args = { drive_id: 9, file_name: 'x', ...content };
      await expect(adapter.upload(args, 3)).resolves.toEqual(item);
      await expect(adapter.upload(args, 2)).rejects.toThrow('Upload limit exceeded');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('maps upload options and content type without leaking unknown metadata into HTTP', async () => {
    const { module, fetcher } = setup();
    fetcher.mockResolvedValue(Response.json(fixture.item));
    await module.invoke(
      cases[1].name,
      {
        ...uploadInput,
        directory_id: 7,
        directory_path: 'été/文',
        conflict: 'version',
        last_modified_at: 123,
        content_type: 'text/plain',
        extra: 'local',
      },
      policy,
    );
    const [url, req] = fetcher.mock.calls[0];
    expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual({
      directory_id: '7',
      file_name: 'été.txt',
      total_size: '3',
      conflict: 'version',
      directory_path: 'été/文',
      last_modified_at: '123',
    });
    expect(req?.headers).toHaveProperty('Content-Type', 'text/plain');
  });

  it.each(['utf-8', 'base64', 'auto'] as const)(
    'maps text download with %s and allows read-only',
    async (encoding) => {
      const { module, fetcher } = setup();
      fetcher.mockResolvedValue(
        new Response('été', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
      );
      const result = await module.invoke(
        cases[0].name,
        { ...input, encoding },
        { ...policy, readOnly: true },
      );
      expect(result.structuredContent).toMatchObject({
        content: encoding === 'base64' ? Buffer.from('été').toString('base64') : 'été',
        sizeBytes: 5,
        encoding: encoding === 'base64' ? 'base64' : 'utf-8',
      });
    },
  );

  it.each([0, 1])('checks default download size at limit + %i', async (extra) => {
    const { module, fetcher } = setup();
    fetcher.mockResolvedValue(new Response(new Uint8Array(DOWNLOAD_LIMIT + extra)));
    const result = module.invoke(cases[0].name, input, policy);
    if (extra) await expect(result).rejects.toThrow('Download limit exceeded');
    else expect((await result).structuredContent.sizeBytes).toBe(DOWNLOAD_LIMIT);
  });

  it('passes an injected download bound to the gateway', async () => {
    const { adapter, fetcher } = setup();
    fetcher.mockResolvedValue(new Response(new Uint8Array(4)));
    await expect(
      createTransferFeature(adapter, { downloadLimit: 3 }).invoke(cases[0].name, input, policy),
    ).rejects.toThrow('Download limit exceeded');
  });
});

describe('large payload admission', () => {
  it('uploads base64 at the default effective JSON limit and rejects its +1 envelope before decoding', async () => {
    const effective = BODY_LIMIT - ENVELOPE_RESERVE;
    const args = { ...uploadInput, base64_content: '', metadata: '' };
    const overhead = Buffer.byteLength(JSON.stringify(args));
    const encodedLength = Math.floor((effective - overhead) / 4) * 4;
    args.base64_content = 'AAAA'.repeat(encodedLength / 4);
    args.metadata = 'x'.repeat(effective - Buffer.byteLength(JSON.stringify(args)));
    expect(Buffer.byteLength(JSON.stringify(args))).toBe(effective);
    const { module, fetcher } = setup();
    fetcher.mockResolvedValue(Response.json(fixture.item));
    await module.invoke(cases[1].name, args, policy);
    expect(fetcher.mock.calls[0][1]?.body).toHaveProperty('byteLength', (encodedLength / 4) * 3);
    fetcher.mockClear();
    args.metadata += 'x';
    const decoder = vi.spyOn(Buffer, 'from');
    try {
      await expect(module.invoke(cases[1].name, args, policy)).rejects.toThrow(
        'Upload arguments limit exceeded',
      );
      expect(decoder).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      decoder.mockRestore();
    }
  });

  it('rejects a payload below 50 MiB whose base64 JSON would exceed the default body admission', async () => {
    const { module, fetcher } = setup();
    const base64_content = 'AAAA'.repeat(6 * 1024 * 1024);
    expect((base64_content.length * 3) / 4).toBeLessThan(UPLOAD_LIMIT);
    await expect(
      module.invoke(cases[1].name, { ...uploadInput, base64_content }, policy),
    ).rejects.toThrow('Upload arguments limit exceeded');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
