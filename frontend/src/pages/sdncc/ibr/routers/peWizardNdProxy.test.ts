import {
  applyWanNdProxy,
  collectWanNdProxyIfNames,
  ifaceHasNdProxy,
  ndProxySidHostFromPrefix,
  patchVrConfigWanNdProxy,
  pickIfaceHardwareMac,
  validateWanNdProxyIntent,
  wanNdProxyEnabledOn,
} from './peWizardNdProxy';

describe('peWizardNdProxy', () => {
  it('strips SID prefix mask for ipv6 nd proxy host', () => {
    expect(ndProxySidHostFromPrefix('240e:398:8507:1:1::301')).toBe('240e:398:8507:1:1::301');
    expect(ndProxySidHostFromPrefix('240e:398:8507:1:1::301/64')).toBe('240e:398:8507:1:1::301');
    expect(ndProxySidHostFromPrefix('')).toBe('');
    expect(ndProxySidHostFromPrefix('not-an-ip')).toBe('');
  });

  it('writes ipv6_nd_proxy only when enabled and SID host is valid', () => {
    const item: Record<string, unknown> = { name: 'GigabitEthernet 0/7/0' };
    expect(applyWanNdProxy(item, false, '240e:398:8507:1:1::301')).toBe(false);
    expect(item.ipv6_nd_proxy).toBeUndefined();
    expect(applyWanNdProxy(item, true, '240e:398:8507:1:1::301/64')).toBe(true);
    expect(item.ipv6_nd_proxy).toBe('240e:398:8507:1:1::301');
    expect(applyWanNdProxy(item, false, '240e:398:8507:1:1::301')).toBe(false);
    expect(item.ipv6_nd_proxy).toBeUndefined();
    expect(applyWanNdProxy({ name: 'x' }, true, '')).toBe(false);
  });

  it('patches only managed WAN ipv6_nd_proxy on existing VR config', () => {
    const cfg = patchVrConfigWanNdProxy(
      {
        interfaces_GigabitEthernet: [
          { name: 'GigabitEthernet 0/7/0', ipv6_static: '2001:db8::1/64', ipv6_nd_proxy: 'old::1' },
          { name: 'GigabitEthernet 0/1/0', ipv6_static: '2001:db8:1::1/64' },
        ],
        pe: { publicConfig: { wanName: 'GigabitEthernet 0/7/0', wanNdProxy: true } },
      },
      {
        wanNdProxy: true,
        wanDev: 'GigabitEthernet 0/7/0',
        sidPrefix: '240e:398:8507:1:1::301/64',
      },
    );
    const ifaces = cfg.interfaces_GigabitEthernet as Array<Record<string, unknown>>;
    expect(ifaces[0].ipv6_nd_proxy).toBe('240e:398:8507:1:1::301');
    expect(ifaces[1].ipv6_nd_proxy).toBeUndefined();
    const pe = cfg.pe as { publicConfig: Record<string, unknown> };
    expect(pe.publicConfig.wanNdProxy).toBe(true);
    expect(pe.publicConfig.wanNdProxyIfNames).toEqual(['GigabitEthernet 0/7/0']);

    const cleared = patchVrConfigWanNdProxy(cfg, {
      wanNdProxy: false,
      wanDev: 'GigabitEthernet 0/7/0',
      sidPrefix: '240e:398:8507:1:1::301/64',
    });
    const clearedIfaces = cleared.interfaces_GigabitEthernet as Array<Record<string, unknown>>;
    expect(clearedIfaces[0].ipv6_nd_proxy).toBeUndefined();
    const clearedPe = cleared.pe as { publicConfig: Record<string, unknown> };
    expect(clearedPe.publicConfig.wanNdProxy).toBe(false);
    expect(clearedPe.publicConfig.wanNdProxyIfNames).toEqual([]);
  });

  it('collects spoke and hub WAN names that enabled ND proxy', () => {
    expect(
      collectWanNdProxyIfNames({
        wanNdProxy: true,
        wanDev: 'GigabitEthernet 0/7/0',
      }),
    ).toEqual(['GigabitEthernet 0/7/0']);
    expect(
      collectWanNdProxyIfNames({
        hubWanInventory: [
          { ifName: 'GigabitEthernet 0/7/0', ndProxy: true },
          { ifName: 'GigabitEthernet 0/8/0', ndProxy: false },
        ],
      }),
    ).toEqual(['GigabitEthernet 0/7/0']);
  });

  it('reads optional hardware MAC and ipv6_nd_proxy presence', () => {
    expect(pickIfaceHardwareMac({ ethernet_address: '00:11:22:33:44:55' })).toBe('00:11:22:33:44:55');
    expect(pickIfaceHardwareMac({ ipv6_static: '2100::100/64' })).toBeUndefined();
    expect(ifaceHasNdProxy({ ipv6_nd_proxy: '240e:398:8507:1:1::301' })).toBe(true);
    expect(wanNdProxyEnabledOn('GigabitEthernet 0/7/0', ['GigabitEthernet0/7/0'])).toBe(true);
    expect(wanNdProxyEnabledOn('GigabitEthernet 0/7/0', ['GigabitEthernet 0/7/0'])).toBe(true);
  });

  it('rejects checked ND proxy without SID host', () => {
    expect(
      validateWanNdProxyIntent({
        wanNdProxy: true,
        wanDev: 'GigabitEthernet 0/7/0',
        sidPrefix: '',
      }),
    ).toMatch(/SID/);
    expect(
      validateWanNdProxyIntent({
        wanNdProxy: true,
        wanDev: 'GigabitEthernet 0/7/0',
        sidPrefix: '2100:0:0:0:0::100',
      }),
    ).toBeNull();
  });
});
