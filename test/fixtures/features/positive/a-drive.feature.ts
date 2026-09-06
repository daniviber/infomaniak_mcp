import { listDrives, listDrivesContract } from '../../../../src/application/drive/list-drives.js';
import { DriveListAdapter } from '../../../../src/adapters/outbound/infomaniak/drive-list.adapter.js';
import type { InfomaniakGateway } from '../../../../src/adapters/outbound/infomaniak/gateway.js';

export const tools = [listDrivesContract] as const;
export function createHandlers(deps: { gateway: InfomaniakGateway }) {
  const adapter = new DriveListAdapter(deps.gateway);
  return { [listDrivesContract.name]: (input: unknown) => listDrives(adapter, input) };
}
