import type { InvocationContext } from '../../domain/tool-contract.js';

export interface ExperimentalPolicy {
  enabled: boolean;
  allowRawApi: boolean;
  readOnly: boolean;
}
export function experimentalPolicy(policy: InvocationContext): ExperimentalPolicy {
  return {
    enabled: policy.allowExperimental,
    allowRawApi: policy.allowRawApi,
    readOnly: policy.readOnly,
  };
}
