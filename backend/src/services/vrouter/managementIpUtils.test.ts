import { normalizeManagementIp } from './managementIpUtils';

describe('normalizeManagementIp', () => {
  it('accepts bare IPv4', () => {
    expect(normalizeManagementIp('192.168.1.10')).toBe('192.168.1.10');
  });

  it('strips CIDR prefix', () => {
    expect(normalizeManagementIp('10.0.0.2/24')).toBe('10.0.0.2');
  });

  it('rejects invalid host', () => {
    expect(() => normalizeManagementIp('not-an-ip')).toThrow(/格式无效/);
    expect(() => normalizeManagementIp('')).toThrow(/不能为空/);
  });
});
