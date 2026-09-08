import { z } from 'zod';
import {
  address,
  mailbox,
  folder,
  listMessage,
  message,
  attachment,
  thread,
  page,
  outputs,
  type DraftContent,
  type MailInput,
} from '../../../domain/mail/mail.js';
import type { MailPort, DraftSubmission } from '../../../application/mail/mail.port.js';
import type { InfomaniakGateway, GatewayRequest } from './gateway.js';

// Consumed provider DTOs. Required fields and nullability come exclusively from M-B1..M-B9.
// z.object ignores unconsumed provider keys; it does not relax consumed fields.
const addressDto = z.object({ email: z.string(), name: z.string() }); // M-B6
const mailboxDto = z.object({
  uuid: z.string(),
  email: z.string(),
  is_primary: z.boolean(),
  is_valid: z.boolean(),
  is_locked: z.boolean(),
}); // M-B1
const folderDto = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  role: z.string(),
  unread_count: z.number().int(),
  total_count: z.number().int(),
  get children() {
    return z.array(folderDto);
  },
}); // M-B2
const listMessageDto = z.object({
  uid: z.string(),
  msg_id: z.string(),
  date: z.string(),
  subject: z.string(),
  from: z.array(addressDto),
  to: z.array(addressDto),
  cc: z.array(addressDto),
  bcc: z.array(addressDto),
  reply_to: z.array(addressDto),
  in_reply_to: z.string().nullable(),
  references: z.string().nullable(), // M-B4
  folder_id: z.string(),
  folder: z.string(),
  resource: z.string(),
  is_draft: z.boolean(),
  has_attachments: z.boolean(),
  seen: z.boolean(),
  answered: z.boolean(),
  forwarded: z.boolean(),
  flagged: z.boolean(),
  preview: z.string(),
  size: z.number().int(),
  dkim_status: z.string(),
});
const attachmentDto = z.object({
  part_id: z.number().int(),
  mime_type: z.string(),
  encoding: z.string(),
  size: z.number().int(),
  name: z.string(),
  disposition: z.string(),
  resource: z.string(),
}); // M-B7
const detailDto = listMessageDto.extend({
  body: z.object({ type: z.string(), value: z.string() }),
  headers: z.record(z.string(), z.unknown()),
  attachments: z.array(attachmentDto).nullable(), // M-B5
});
const threadDto = z.object({
  uid: z.string(),
  subject: z.string(),
  date: z.string(),
  from: z.array(addressDto),
  to: z.array(addressDto),
  messages_count: z.number().int(),
  unseen_messages: z.number().int(),
  has_attachments: z.boolean(),
  flagged: z.boolean(),
  answered: z.boolean(),
  forwarded: z.boolean(),
  messages: z.array(listMessageDto),
}); // M-B3
const pageDto = z.object({
  threads: z.array(threadDto),
  total_messages_count: z.number().int(),
  messages_count: z.number().int(),
  current_offset: z.number().int(),
  thread_mode: z.string(),
  resource_previous: z.string().nullable(),
  resource_next: z.string().nullable(), // Required null|string: M-B8 boundaries.
});
const createdDto = z.object({ uuid: z.string(), uid: z.string() }); // M-B9; attachments unconsumed.
const envelope = <T extends z.ZodType>(data: T) => z.object({ result: z.literal('success'), data });
const mapAddress = (dto: z.infer<typeof addressDto>) =>
  address.parse({ email: dto.email, name: dto.name });
function mapFolder(dto: z.infer<typeof folderDto>): z.infer<typeof folder> {
  return folder.parse({
    id: dto.id,
    path: dto.path,
    name: dto.name,
    role: dto.role,
    unread_count: dto.unread_count,
    total_count: dto.total_count,
    children: dto.children.map(mapFolder),
  });
}
function mapMessage(dto: z.infer<typeof listMessageDto>) {
  return listMessage.parse({
    uid: dto.uid,
    msg_id: dto.msg_id,
    date: dto.date,
    subject: dto.subject,
    from: dto.from.map(mapAddress),
    to: dto.to.map(mapAddress),
    cc: dto.cc.map(mapAddress),
    bcc: dto.bcc.map(mapAddress),
    reply_to: dto.reply_to.map(mapAddress),
    in_reply_to: dto.in_reply_to,
    references: dto.references,
    folder_id: dto.folder_id,
    folder: dto.folder,
    resource: dto.resource,
    is_draft: dto.is_draft,
    has_attachments: dto.has_attachments,
    seen: dto.seen,
    answered: dto.answered,
    forwarded: dto.forwarded,
    flagged: dto.flagged,
    preview: dto.preview,
    size: dto.size,
    dkim_status: dto.dkim_status,
  });
}
function mapThread(dto: z.infer<typeof threadDto>) {
  return thread.parse({
    uid: dto.uid,
    subject: dto.subject,
    date: dto.date,
    from: dto.from.map(mapAddress),
    to: dto.to.map(mapAddress),
    messages_count: dto.messages_count,
    unseen_messages: dto.unseen_messages,
    has_attachments: dto.has_attachments,
    flagged: dto.flagged,
    answered: dto.answered,
    forwarded: dto.forwarded,
    messages: dto.messages.map(mapMessage),
  });
}
const mailPath = (uuid: string) => ['mail', uuid];
const folderPath = (input: { uuid: string; folderId: string }) => [
  ...mailPath(input.uuid),
  'folder',
  input.folderId,
];
const messagePath = (input: { uuid: string; folderId: string; uid: string }) => [
  ...folderPath(input),
  'message',
  input.uid,
];
const compositeUids = (input: MailInput<'archive'>) =>
  input.uids.map((uid) => `${uid}@${input.folderId}`);
// S1 2739f6c9b3af9c9ea77e43b20e601a7e53a99bb6, mail-client.ts:46: escape, then line breaks -> <br>.
function html(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r\n|\r|\n/g, '<br>');
}
const recipients = (values: DraftContent['to'] | undefined) =>
  values?.length ? values.map(({ name, email }) => ({ name: name ?? '', email })) : null;

export class MailAdapter implements MailPort {
  constructor(
    private readonly gateway: InfomaniakGateway,
    private readonly downloadLimit: number,
  ) {}

  private async read<T>(request: GatewayRequest, schema: z.ZodType<T>): Promise<T> {
    try {
      const resultSchema = envelope(schema);
      // Gateway validates but retains original payload. Parse again to strip unconsumed keys.
      return resultSchema.parse(await this.gateway.request(request, resultSchema)).data;
    } catch {
      // Fixed code even for opaque object keys or malicious provider validation paths.
      throw new Error('MAIL_RESPONSE_INVALID');
    }
  }
  private async mutate(request: GatewayRequest) {
    try {
      await this.gateway.request(request, z.unknown());
    } catch {
      throw new Error('MAIL_MUTATION_FAILED');
    }
  }
  async list_mailboxes() {
    const dtos = await this.read(
      {
        method: 'GET',
        pathSegments: ['mailbox'],
        query: { with: 'aliases,permissions,accountId,count_users' },
      },
      z.array(mailboxDto),
    );
    return outputs.list_mailboxes.parse({
      mailboxes: dtos.map((dto) =>
        mailbox.parse({
          uuid: dto.uuid,
          email: dto.email,
          is_primary: dto.is_primary,
          is_valid: dto.is_valid,
          is_locked: dto.is_locked,
        }),
      ),
    });
  }
  async list_folders(input: MailInput<'list_folders'>) {
    const dtos = await this.read(
      {
        method: 'GET',
        pathSegments: [...mailPath(input.uuid), 'folder'],
        query: { with: 'ik-static' },
      },
      z.array(folderDto),
    );
    return outputs.list_folders.parse({ folders: dtos.map(mapFolder) });
  }
  private async role(uuid: string, role: string) {
    const matches: string[] = [];
    function visit(folders: z.infer<typeof folder>[]) {
      for (const entry of folders) {
        if (entry.role === role) matches.push(entry.id);
        visit(entry.children);
      }
    }
    visit((await this.list_folders({ uuid })).folders);
    if (matches.length === 0) throw new Error('MAIL_FOLDER_ROLE_MISSING');
    if (matches.length !== 1) throw new Error('MAIL_FOLDER_ROLE_AMBIGUOUS');
    return matches[0];
  }
  async list_messages(input: MailInput<'list_messages'>) {
    return this.search_messages(input);
  }
  async search_messages(input: MailInput<'search_messages'>) {
    const dto = await this.read(
      {
        method: 'GET',
        pathSegments: [...folderPath(input), 'message'],
        query: {
          offset: input.offset,
          limit: input.limit,
          thread: input.thread,
          severywhere: input.severywhere === undefined ? undefined : input.severywhere ? 1 : 0,
          scontains: input.scontains,
          sfrom: input.sfrom,
          sto: input.sto,
          ssubject: input.ssubject,
          sfromdate: input.sfromdate === undefined ? undefined : `${input.sfromdate} 00:00:00`,
          stodate: input.stodate === undefined ? undefined : `${input.stodate} 00:00:00`,
        },
      },
      pageDto,
    );
    return page.parse({
      current_offset: dto.current_offset,
      messages_count: dto.messages_count,
      total_messages_count: dto.total_messages_count,
      thread_mode: dto.thread_mode,
      threads: dto.threads.map(mapThread),
      hasMore: dto.resource_next !== null,
      nextOffset: dto.current_offset + input.limit,
    });
  }
  async list_drafts(input: MailInput<'list_drafts'>) {
    return this.list_messages({ ...input, folderId: await this.role(input.uuid, 'DRAFT') });
  }
  async get_message(input: MailInput<'get_message'>) {
    const dto = await this.read(
      {
        method: 'GET',
        pathSegments: messagePath(input),
        query: { prefered_format: 'html', with: 'auto_uncrypt,thread_context' },
      },
      detailDto,
    );
    return outputs.get_message.parse({
      message: message.parse({
        ...mapMessage(dto),
        body: { type: dto.body.type, value: dto.body.value },
        headers: dto.headers,
        attachments:
          dto.attachments === null
            ? null
            : dto.attachments.map((value) =>
                attachment.parse({
                  part_id: value.part_id,
                  mime_type: value.mime_type,
                  encoding: value.encoding,
                  size: value.size,
                  name: value.name,
                  disposition: value.disposition,
                  resource: value.resource,
                }),
              ),
      }),
    });
  }
  async download_attachment(input: MailInput<'download_attachment'>) {
    const { bytes, contentType } = await this.gateway.download(
      [...messagePath(input), 'attachment', input.attachmentId],
      { maxBytes: this.downloadLimit },
    );
    return outputs.download_attachment.parse({
      contentBase64: Buffer.from(bytes).toString('base64'),
      contentType,
      size: bytes.byteLength,
    });
  }
  async prepareDraft(content: DraftContent): Promise<DraftSubmission> {
    const matches = (await this.list_mailboxes()).mailboxes.filter(
      (box) => box.uuid === content.uuid,
    );
    if (matches.length === 0) throw new Error('MAIL_SENDER_MISSING');
    if (matches.length !== 1) throw new Error('MAIL_SENDER_AMBIGUOUS');
    const email = matches[0].email;
    const name = email.split('@')[0]; // Product derivation, S1 mail-client.ts:122,570; not measured civil identity.
    // Complete 26-field construction, S1 mail-client.ts:592-626 (official, not baseline).
    const body = {
      uuid: null as string | null,
      subject: content.subject,
      body: html(content.body),
      quote: null,
      mime_type: 'text/html',
      from: { id: null, name, email },
      reply_to: { name, email },
      to: recipients(content.to),
      cc: recipients(content.cc),
      bcc: recipients(content.bcc),
      references: content.references ?? null,
      in_reply_to: content.in_reply_to ?? null,
      in_reply_to_uid: content.in_reply_to_uid ?? null,
      forwarded_uid: null,
      attachments: [],
      identity_id: null,
      ack_request: false,
      st_uuid: null,
      uid: null,
      resource: null as string | null,
      priority: 'normal',
      encrypted: false,
      encryption_password: '',
      event_poll_uuid: null,
      action: 'save',
      delay: 0,
    };
    const path = [...mailPath(content.uuid), 'draft'];
    return {
      create: async () =>
        (
          await this.read(
            { method: 'POST', pathSegments: path, body, idempotent: false },
            createdDto,
          )
        ).uuid,
      replace: async (draftUuid, action) => {
        // The same invocation's complete POST body, adjusted as S1:675,693,744-752; no persistent cache.
        body.uuid = draftUuid;
        body.resource = `/api/${[...path, draftUuid].map(encodeURIComponent).join('/')}`;
        body.action = action;
        body.delay = 0;
        await this.mutate({
          method: 'PUT',
          pathSegments: [...path, draftUuid],
          body,
          idempotent: action === 'save',
        });
      },
    };
  }
  async delete_draft(input: MailInput<'delete_draft'>) {
    await this.mutate({
      method: 'DELETE',
      pathSegments: [...mailPath(input.uuid), 'draft', input.draftUuid],
      idempotent: false,
    });
    return outputs.delete_draft.parse({ ok: true, action: 'delete_draft' });
  }
  async mark_seen(input: MailInput<'mark_seen'>) {
    await this.mutate({
      method: 'POST',
      pathSegments: [...mailPath(input.uuid), 'message', input.seen ? 'seen' : 'unseen'],
      body: { uids: compositeUids(input) },
      idempotent: true,
    });
    return outputs.mark_seen.parse({ ok: true, action: 'mark_seen' });
  }
  async flag(input: MailInput<'flag'>) {
    await this.mutate({
      method: 'POST',
      pathSegments: [...mailPath(input.uuid), 'message', input.flagged ? 'star' : 'unstar'],
      body: { uids: compositeUids(input) },
      idempotent: true,
    });
    return outputs.flag.parse({ ok: true, action: 'flag' });
  }
  async move(input: MailInput<'move'>) {
    await this.mutate({
      method: 'POST',
      pathSegments: [...mailPath(input.uuid), 'message', 'move'],
      body: { uids: compositeUids(input), to: input.to, move_reactions: false },
      idempotent: false,
    });
    return outputs.move.parse({ ok: true, action: 'move' });
  }
  async archive(input: MailInput<'archive'>) {
    await this.move({ ...input, to: await this.role(input.uuid, 'ARCHIVE') });
    return outputs.archive.parse({ ok: true, action: 'archive' });
  }
  async delete(input: MailInput<'delete'>) {
    await this.move({ ...input, to: await this.role(input.uuid, 'TRASH') });
    return outputs.delete.parse({ ok: true, action: 'delete' });
  }
  async delete_permanently(input: MailInput<'delete_permanently'>) {
    await this.mutate({
      method: 'POST',
      pathSegments: [...mailPath(input.uuid), 'message', 'delete'],
      body: { uids: compositeUids(input), move_reactions: false },
      idempotent: false,
    });
    return outputs.delete_permanently.parse({ ok: true, action: 'delete_permanently' });
  }
  async create_folder(input: MailInput<'create_folder'>) {
    await this.mutate({
      method: 'POST',
      pathSegments: [...mailPath(input.uuid), 'folder'],
      body: {
        name: input.name,
        ...(input.parent_folder_id ? { parent: input.parent_folder_id } : {}),
      },
      idempotent: false,
    });
    return outputs.create_folder.parse({ ok: true, action: 'create_folder' });
  }
  async rename_folder(input: MailInput<'rename_folder'>) {
    await this.mutate({
      method: 'POST',
      pathSegments: [...folderPath(input), 'rename'],
      body: { name: input.name },
      idempotent: true,
    });
    return outputs.rename_folder.parse({ ok: true, action: 'rename_folder' });
  }
  async delete_folder(input: MailInput<'delete_folder'>) {
    await this.mutate({ method: 'DELETE', pathSegments: folderPath(input), idempotent: false });
    return outputs.delete_folder.parse({ ok: true, action: 'delete_folder' });
  }
}
