import { z } from 'zod';
import type { DrivePort } from '../../../application/drive/list-drives.js';
import type { InfomaniakGateway } from './gateway.js';

// Relevé /2/drive: used_size:int (provider key).
const drivesDto = z.looseObject({
  result: z.string(),
  data: z.array(
    z.looseObject({
      id: z.number(),
      name: z.string(),
      account_id: z.number(),
      used_size: z.number(),
      size: z.number(),
    }),
  ),
});

export class DriveListAdapter implements DrivePort {
  constructor(private readonly gateway: InfomaniakGateway) {}

  async listDrives(accountId: number) {
    const response = await this.gateway.request(
      { method: 'GET', pathSegments: ['2', 'drive'], query: { account_id: accountId } },
      drivesDto,
    );
    return {
      drives: response.data.map((drive) => ({
        id: drive.id,
        name: drive.name,
        accountId: drive.account_id,
        usedBytes: drive.used_size,
        capacityBytes: drive.size,
      })),
      displayText: JSON.stringify(response, null, 2),
    };
  }
}
