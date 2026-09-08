import type { DraftContent, MailInput, MailOperation, MailOutput } from '../../domain/mail/mail.js';

// Per-invocation submission: the adapter holds the complete body only for this call.
// No provider DTO, cache, URL, configuration or network primitive crosses this port.
export interface DraftSubmission {
  create(): Promise<string>;
  replace(draftUuid: string, action: 'save' | 'send'): Promise<void>;
}
export type DirectMailOperation = Exclude<
  MailOperation,
  'create_draft' | 'update_draft' | 'send_draft' | 'send_message'
>;
export type MailPort = {
  [K in DirectMailOperation]: (input: MailInput<K>) => Promise<MailOutput<K>>;
} & { prepareDraft(content: DraftContent): Promise<DraftSubmission> };
