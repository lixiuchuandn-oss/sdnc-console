import {
  extractSrv6PrefixFromConfig,
  hasSrv6EndpointConflict,
  hasSrv6NameConflict,
  normalizeSrv6TunnelPayload,
  validateSrv6VrEndpointsForCreate,
  validateSrv6TunnelTopology,
  type VrConfigRow,
} from './srv6.validation';

const peConfigJson = () =>
  JSON.stringify({
    segment_routing_srv6: { locator: 'loc-a', prefix: '2001:db8:1' },
    bgp: [{ asn: 65001, vrf: 0 }],
    interfaces_eth0: [
      { name: 'eth0', ipv6_static: '2001:db8::1/64' },
      { name: 'eth1', vrf: 10, ipv4_static: '10.0.0.1/24' },
    ],
  });

const ceConfigJson = () =>
  JSON.stringify({
    bgp: [{ asn: 65010 }],
    interfaces_eth0: [{ name: 'eth0', ipv4_static: '203.0.113.1/24' }],
  });

describe('srv6.validation', () => {
  it('normalizeSrv6TunnelPayload rejects missing fields', () => {
    const r = normalizeSrv6TunnelPayload({ name: 't1' });
    expect(r.ok).toBe(false);
  });

  it('normalizeSrv6TunnelPayload preserves tunnelTopology for create validation', () => {
    const r = normalizeSrv6TunnelPayload({
      name: 't1',
      peA: 'a',
      peB: 'b',
      ceA: 'c',
      ceB: 'd',
      tunnelTopology: 'H',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tunnelTopology).toBe('H');
  });

  it('hasSrv6NameConflict is case-insensitive', () => {
    expect(hasSrv6NameConflict([{ id: '1', name: 'Tunnel-A' }], 'tunnel-a')).toBe(true);
    expect(hasSrv6NameConflict([{ id: '1', name: 'Tunnel-A' }], 'tunnel-a', '1')).toBe(false);
  });

  it('hasSrv6EndpointConflict detects symmetric endpoints', () => {
    const existing = [{ id: '1', peA: 'a', peB: 'b', ceA: 'c', ceB: 'd' }];
    expect(
      hasSrv6EndpointConflict(existing, { peA: 'b', peB: 'a', ceA: 'd', ceB: 'c' }),
    ).toBe(true);
  });

  it('extractSrv6PrefixFromConfig reads segment_routing_srv6 and pe metadata', () => {
    expect(
      extractSrv6PrefixFromConfig({
        segment_routing_srv6: { prefix: '2001:db8::' },
      }),
    ).toBe('2001:db8::');
    expect(
      extractSrv6PrefixFromConfig({
        pe: { publicConfig: { sidPrefix: '2001:db8:2' } },
      }),
    ).toBe('2001:db8:2');
  });

  it('validateSrv6VrEndpointsForCreate passes complete PE/CE rows', () => {
    const payload = {
      name: 't1',
      peA: 'pe-a',
      peB: 'pe-b',
      ceA: 'ce-a',
      ceB: 'ce-b',
    };
    const rows: VrConfigRow[] = [
      { uuid: 'pe-a', role: 'SPOKE_PE', config_json: peConfigJson() },
      { uuid: 'pe-b', role: 'SPOKE_PE', config_json: peConfigJson() },
      { uuid: 'ce-a', role: 'CE', config_json: ceConfigJson() },
      { uuid: 'ce-b', role: 'CE', config_json: ceConfigJson() },
    ];
    expect(validateSrv6VrEndpointsForCreate(payload, rows).ok).toBe(true);
  });

  it('validateSrv6VrEndpointsForCreate rejects PE prefix with mask', () => {
    const badPe = JSON.stringify({
      segment_routing_srv6: { locator: 'loc', prefix: '2001:db8::/64' },
      bgp: [{ asn: 1, vrf: 0 }],
      interfaces_eth0: [
        { ipv6_static: '2001:db8::1/64' },
        { vrf: 1, name: 'in' },
      ],
    });
    const r = validateSrv6VrEndpointsForCreate(
      { name: 't', peA: 'pe-a', peB: 'pe-b', ceA: 'ce-a', ceB: 'ce-b' },
      [{ uuid: 'pe-a', role: 'SPOKE_PE', config_json: badPe }],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('SRv6 SID 前缀不允许包含');
  });

  it('validateSrv6VrEndpointsForCreate reports missing VR row', () => {
    const r = validateSrv6VrEndpointsForCreate(
      { name: 't', peA: 'missing', peB: 'pe-b', ceA: 'ce-a', ceB: 'ce-b' },
      [],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('未找到 VR 配置');
  });

  it('validateSrv6VrEndpointsForCreate rejects CE with only public IPv6', () => {
    const ceOnlyV6 = JSON.stringify({
      bgp: [{ asn: 65010 }],
      interfaces_eth0: [{ name: 'eth0', ipv6_static: '2001:db8::1/64' }],
    });
    const r = validateSrv6VrEndpointsForCreate(
      { name: 't', peA: 'pe-a', peB: 'pe-b', ceA: 'ce-a', ceB: 'ce-b' },
      [
        { uuid: 'pe-a', role: 'SPOKE_PE', config_json: peConfigJson() },
        { uuid: 'pe-b', role: 'SPOKE_PE', config_json: peConfigJson() },
        { uuid: 'ce-a', role: 'CE', config_json: ceOnlyV6 },
        { uuid: 'ce-b', role: 'CE', config_json: ceConfigJson() },
      ],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('公网口 IPv4');
  });

  it('validateSrv6TunnelTopology requires one HUB_PE and one SPOKE_PE for H', () => {
    const payload = { name: 't', peA: 'hub', peB: 'spoke', ceA: 'ce-a', ceB: 'ce-b' };
    const rows: VrConfigRow[] = [
      { uuid: 'hub', role: 'HUB_PE', config_json: peConfigJson() },
      { uuid: 'spoke', role: 'SPOKE_PE', config_json: peConfigJson() },
    ];
    expect(validateSrv6TunnelTopology(payload, rows, 'H').ok).toBe(true);
    expect(validateSrv6TunnelTopology(payload, rows, 'S').ok).toBe(false);
  });

  it('validateSrv6TunnelTopology rejects dual HUB_PE on H topology', () => {
    const payload = { name: 't', peA: 'hub-a', peB: 'hub-b', ceA: 'ce-a', ceB: 'ce-b' };
    const rows: VrConfigRow[] = [
      { uuid: 'hub-a', role: 'HUB_PE', config_json: peConfigJson() },
      { uuid: 'hub-b', role: 'HUB_PE', config_json: peConfigJson() },
    ];
    const r = validateSrv6TunnelTopology(payload, rows, 'H');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('HUB_PE');
  });

  it('validateSrv6TunnelTopology allows dual HUB_PE on S (Hub–Hub 点对点)', () => {
    const payload = { name: 't', peA: 'hub-a', peB: 'hub-b', ceA: 'ce-a', ceB: 'ce-b' };
    const rows: VrConfigRow[] = [
      { uuid: 'hub-a', role: 'HUB_PE', config_json: peConfigJson() },
      { uuid: 'hub-b', role: 'HUB_PE', config_json: peConfigJson() },
    ];
    expect(validateSrv6TunnelTopology(payload, rows, 'S').ok).toBe(true);
  });

  it('validateSrv6VrEndpointsForCreate includes topology check on create', () => {
    const payload = {
      name: 't',
      peA: 'hub',
      peB: 'spoke',
      ceA: 'ce-a',
      ceB: 'ce-b',
      tunnelTopology: 'H' as const,
    };
    const rows: VrConfigRow[] = [
      { uuid: 'hub', role: 'HUB_PE', config_json: peConfigJson() },
      { uuid: 'spoke', role: 'SPOKE_PE', config_json: peConfigJson() },
      { uuid: 'ce-a', role: 'CE', config_json: ceConfigJson() },
      { uuid: 'ce-b', role: 'CE', config_json: ceConfigJson() },
    ];
    expect(validateSrv6VrEndpointsForCreate(payload, rows).ok).toBe(true);
  });
});
