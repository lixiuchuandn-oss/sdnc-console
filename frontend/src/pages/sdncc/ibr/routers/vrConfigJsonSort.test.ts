import { sortVrConfigJsonKeys } from './vrConfigJsonSort';
import { buildIpsecPresetVrConfigFromValues } from './ipsecPresetWizardLib';

describe('sortVrConfigJsonKeys', () => {
  it('orders uuid and role before profile-specific keys', () => {
    const sorted = sortVrConfigJsonKeys(
      { bgp: [], role: 'CE', uuid: 'u1', ce: { x: 1 } },
      'ce',
    ) as Record<string, unknown>;
    expect(Object.keys(sorted)).toEqual(['uuid', 'role', 'ce', 'bgp']);
  });

  it('orders ipsec_preset before interfaces for ipsec profile', () => {
    const sorted = sortVrConfigJsonKeys(
      { interfaces_lo: [], ipsec_preset: {}, role: '标准' },
      'ipsec',
    ) as Record<string, unknown>;
    expect(Object.keys(sorted)[0]).toBe('role');
    expect(Object.keys(sorted)[1]).toBe('ipsec_preset');
  });
});

describe('buildIpsecPresetVrConfigFromValues', () => {
  it('builds preset, interfaces and default route', () => {
    const cfg = buildIpsecPresetVrConfigFromValues({
      wanInterface: 'GigabitEthernet 3/0/0',
      wanIpv4: '1.1.1.1/24',
      ipsecPublicIp: '1.1.1.254',
      enableNat: true,
      lanInterface: 'GigabitEthernet 3/0/1',
      lanIpv4: '10.0.0.1/24',
    });
    expect(cfg.ipsec_preset).toMatchObject({
      version: 2,
      wan_interface: 'GigabitEthernet 3/0/0',
      public_ip: '1.1.1.1',
      gateway: '1.1.1.254',
      enable_nat: true,
    });
    expect(cfg.ipv4_route).toEqual([{ destination: '0.0.0.0/0', via: '1.1.1.254', priority: 100 }]);
    expect(Array.isArray(cfg.interfaces_GigabitEthernet)).toBe(true);
  });
});
