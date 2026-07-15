import { bindBgpRouterIdFromManagementIp } from './bgpRouterIdFromMgmt';

describe('bindBgpRouterIdFromManagementIp', () => {
  it('does not create bgp shell when missing', () => {
    const r = bindBgpRouterIdFromManagementIp('{}', '10.20.155.103');
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('no_bgp');
  });

  it('fills empty public router_id', () => {
    const r = bindBgpRouterIdFromManagementIp(
      JSON.stringify({
        bgp: [{ asn: 65001, router_id: '', neighbor: [] }],
        pe: { publicConfig: { publicBgp: { asn: 65001 } } },
      }),
      '10.20.155.103',
    );
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('filled');
    const cfg = JSON.parse(r.configJson);
    expect(cfg.bgp[0].router_id).toBe('10.20.155.103');
    expect(cfg.pe.publicConfig.publicBgp.routerId).toBe('10.20.155.103');
  });

  it('keeps manually set router_id', () => {
    const r = bindBgpRouterIdFromManagementIp(
      JSON.stringify({ bgp: [{ asn: 65001, router_id: '1.1.1.1' }] }),
      '10.20.155.103',
      '10.20.155.100',
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('manual_keep');
  });

  it('follows previous management ip when router_id matched old value', () => {
    const r = bindBgpRouterIdFromManagementIp(
      JSON.stringify({ bgp: [{ asn: 65001, router_id: '10.20.155.100' }] }),
      '10.20.155.103',
      '10.20.155.100',
    );
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('followed');
    expect(JSON.parse(r.configJson).bgp[0].router_id).toBe('10.20.155.103');
  });

  it('only binds public bgp segment, not VRF Lan', () => {
    const r = bindBgpRouterIdFromManagementIp(
      JSON.stringify({
        bgp: [
          { asn: 65001, vrf: 4001, router_id: '' },
          { asn: 65001, router_id: '' },
        ],
      }),
      '10.20.155.103',
    );
    expect(r.changed).toBe(true);
    const cfg = JSON.parse(r.configJson);
    expect(cfg.bgp[0].router_id).toBe('');
    expect(cfg.bgp[1].router_id).toBe('10.20.155.103');
  });
});
