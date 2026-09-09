import { z } from 'zod';
import type { ToolContract } from '../../domain/tool-contract.js';

export const driveListInput = z.object({ account_id: z.number().positive() });
export const driveListOutput = z.object({
  drives: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      accountId: z.number(),
      usedBytes: z.number(),
      capacityBytes: z.number(),
    }),
  ),
  displayText: z.string(),
});

export interface DrivePort {
  listDrives(accountId: number): Promise<z.infer<typeof driveListOutput>>;
}

export const listDrivesContract: ToolContract = {
  name: 'infomaniak_list_kdrives',
  description: 'List all kDrives of an account',
  inputSchema: driveListInput,
  outputSchema: driveListOutput,
  classification: 'read',
  rawApi: false,
  idempotent: true,
  limits: { accountIdExclusiveMinimum: 0, results: null },
  experimental: false,
  text: (output) => String(output.displayText),
};

export function listDrives(port: DrivePort, input: unknown) {
  return port.listDrives(driveListInput.parse(input).account_id);
}
