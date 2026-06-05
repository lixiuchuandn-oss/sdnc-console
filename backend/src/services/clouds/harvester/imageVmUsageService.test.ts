import {
  formatImageDeleteBlockedByVmsMessage,
} from './imageVmUsageService';

describe('imageVmUsageService', () => {
  it('formatImageDeleteBlockedByVmsMessage lists vm labels', () => {
    expect(
      formatImageDeleteBlockedByVmsMessage([
        { namespace: 'ns1', name: 'vm-1', displayName: '测试虚拟机' },
      ]),
    ).toBe('镜像仍被虚拟机「测试虚拟机」使用，无法删除');
    expect(
      formatImageDeleteBlockedByVmsMessage([
        { namespace: 'ns1', name: 'vm-1', displayName: 'vm-a' },
        { namespace: 'ns1', name: 'vm-2', displayName: 'vm-b' },
      ]),
    ).toBe('镜像仍被以下虚拟机使用，无法删除：vm-a、vm-b');
  });
});
