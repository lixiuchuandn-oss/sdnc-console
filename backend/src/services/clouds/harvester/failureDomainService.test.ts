import {
  formatFailureDomainDeleteBlockedMessage,
  readVmFailureDomainName,
} from './failureDomainService';
import { FAILURE_DOMAIN_NODE_LABEL } from './failureDomainTypes';

describe('failureDomainService vm usage helpers', () => {
  it('readVmFailureDomainName reads nodeSelector from rawData', () => {
    expect(
      readVmFailureDomainName({
        rawData: {
          spec: {
            template: {
              spec: {
                nodeSelector: {
                  [FAILURE_DOMAIN_NODE_LABEL]: 'rack-a',
                },
              },
            },
          },
        },
      }),
    ).toBe('rack-a');
  });

  it('formatFailureDomainDeleteBlockedMessage lists vm labels', () => {
    expect(
      formatFailureDomainDeleteBlockedMessage('rack-a', [
        { namespace: 'test', name: 'vm-1', displayName: '别名中文' },
      ]),
    ).toBe('故障域「rack-a」仍被虚拟机「别名中文」使用，无法删除');
    expect(
      formatFailureDomainDeleteBlockedMessage('rack-a', [
        { namespace: 'test', name: 'vm-1', displayName: 'vm-a' },
        { namespace: 'test', name: 'vm-2', displayName: 'vm-b' },
      ]),
    ).toBe('故障域「rack-a」仍被以下虚拟机使用，无法删除：vm-a、vm-b');
  });
});
