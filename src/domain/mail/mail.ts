import { z } from 'zod';

// Output fields and their exact types: operator measurements M-B1..M-B9.
export const address = z.object({ email: z.string(), name: z.string() }); // M-B6
export const mailbox = z.object({
  uuid: z.string(), email: z.string(), is_primary: z.boolean(),
  is_valid: z.boolean(), is_locked: z.boolean(),
}); // M-B1
export const folder = z.object({
  id: z.string(), path: z.string(), name: z.string(), role: z.string(),
  unread_count: z.number().int(), total_count: z.number().int(),
  get children() { return z.array(folder); },
}); // M-B2; role remains open.
export const listMessage = z.object({
  uid: z.string(), msg_id: z.string(), date: z.string(), subject: z.string(),
  from: z.array(address), to: z.array(address), cc: z.array(address), bcc: z.array(address), reply_to: z.array(address),
  in_reply_to: z.string().nullable(), references: z.string().nullable(), // M-B4
  folder_id: z.string(), folder: z.string(), resource: z.string(),
  is_draft: z.boolean(), has_attachments: z.boolean(), seen: z.boolean(), answered: z.boolean(),
  forwarded: z.boolean(), flagged: z.boolean(), preview: z.string(), size: z.number().int(), dkim_status: z.string(),
});
export const attachment = z.object({
  part_id: z.number().int(), mime_type: z.string(), encoding: z.string(), size: z.number().int(),
  name: z.string(), disposition: z.string(), resource: z.string(),
}); // M-B7
export const message = listMessage.extend({
  body: z.object({ type: z.string(), value: z.string() }),
  headers: z.record(z.string(), z.unknown()), // Product: opaque data object (M-B5).
  attachments: z.array(attachment).nullable(), // M-B5
});
export const thread = z.object({
  uid: z.string(), subject: z.string(), date: z.string(), from: z.array(address), to: z.array(address),
  messages_count: z.number().int(), unseen_messages: z.number().int(), has_attachments: z.boolean(),
  flagged: z.boolean(), answered: z.boolean(), forwarded: z.boolean(), messages: z.array(listMessage),
}); // M-B3
export const page = z.object({
  current_offset: z.number().int(), messages_count: z.number().int(), total_messages_count: z.number().int(),
  thread_mode: z.string(), threads: z.array(thread), hasMore: z.boolean(), nextOffset: z.number().int(),
}); // Product projection C of M-B8; no pagination resources.

// Input optionality, limits and validation below are product decisions, not API measurements.
const identifier = z.string();
const simpleIdentifier = z.string().regex(/^[^@]*$/);
const box = { uuid: identifier };
const location = { ...box, folderId: simpleIdentifier };
const messageLocation = { ...location, uid: simpleIdentifier };
const pagination = { ...box, thread: z.enum(['on', 'off']), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200).default(50) };
const recipient = z.strictObject({ email: z.email(), name: z.string().optional() });
const content = {
  ...box, subject: z.string(), body: z.string(), to: z.array(recipient).min(1),
  cc: z.array(recipient).optional(), bcc: z.array(recipient).optional(),
  references: z.string().optional(), in_reply_to: z.string().optional(), in_reply_to_uid: z.string().optional(),
};
const batch = { ...location, uids: z.array(simpleIdentifier).min(1) };
export const inputs = {
  list_mailboxes: z.strictObject({}),
  list_folders: z.strictObject(box),
  list_messages: z.strictObject({ ...pagination, folderId: simpleIdentifier }),
  get_message: z.strictObject(messageLocation),
  search_messages: z.strictObject({ ...pagination, folderId: simpleIdentifier,
    severywhere: z.boolean().optional(), scontains: z.string().optional(), sfrom: z.string().optional(),
    sto: z.string().optional(), ssubject: z.string().optional(), sfromdate: z.iso.date().optional(), stodate: z.iso.date().optional(),
  }),
  download_attachment: z.strictObject({ ...messageLocation, attachmentId: z.number().int() }),
  create_draft: z.strictObject(content),
  update_draft: z.strictObject({ ...content, draftUuid: identifier }),
  send_draft: z.strictObject({ ...content, draftUuid: identifier }),
  send_message: z.strictObject(content),
  list_drafts: z.strictObject(pagination),
  delete_draft: z.strictObject({ ...box, draftUuid: identifier }),
  mark_seen: z.strictObject({ ...batch, seen: z.boolean() }),
  flag: z.strictObject({ ...batch, flagged: z.boolean() }),
  move: z.strictObject({ ...batch, to: identifier }),
  archive: z.strictObject(batch),
  delete: z.strictObject(batch),
  delete_permanently: z.strictObject(batch),
  create_folder: z.strictObject({ ...box, name: z.string(), parent_folder_id: z.string().optional() }),
  rename_folder: z.strictObject({ ...location, name: z.string() }),
  delete_folder: z.strictObject(location),
};
const ack = (action: string) => z.object({ ok: z.literal(true), action: z.literal(action) });
const draftAck = (action: string) => ack(action).extend({ draftUuid: z.string() });
export const outputs = {
  list_mailboxes: z.object({ mailboxes: z.array(mailbox) }),
  list_folders: z.object({ folders: z.array(folder) }),
  list_messages: page, search_messages: page, list_drafts: page,
  get_message: z.object({ message }),
  download_attachment: z.object({ contentBase64: z.string(), contentType: z.string(), size: z.number().int() }),
  create_draft: z.object({ draftUuid: z.string() }),
  update_draft: draftAck('update_draft'), send_draft: draftAck('send_draft'),
  send_message: z.object({ sent: z.boolean(), draftUuid: z.string(), error: z.literal('SEND_NOT_CONFIRMED').optional() })
    .refine(value => value.sent ? value.error === undefined : value.error === 'SEND_NOT_CONFIRMED', 'MAIL_INVALID_SEND_RESULT'),
  delete_draft: ack('delete_draft'), mark_seen: ack('mark_seen'), flag: ack('flag'), move: ack('move'),
  archive: ack('archive'), delete: ack('delete'), delete_permanently: ack('delete_permanently'),
  create_folder: ack('create_folder'), rename_folder: ack('rename_folder'), delete_folder: ack('delete_folder'),
};
export type MailOperation = keyof typeof inputs;
export type MailInput<K extends MailOperation> = z.infer<(typeof inputs)[K]>;
export type MailOutput<K extends MailOperation> = z.infer<(typeof outputs)[K]>;
export type DraftContent = MailInput<'create_draft'>;
