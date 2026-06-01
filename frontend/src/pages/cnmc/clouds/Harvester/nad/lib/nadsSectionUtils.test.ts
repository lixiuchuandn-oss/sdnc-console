import {
  collectVmDisplayNamesUsingNad,
  filterNadsForTable,
  findDependentSubnetsForNad,
  inferCniTypeFromConfig,
  OVN_NAD_ORPHAN_ONLY,
  parseKubeOvnSubnetsListResponse,
  processNadList,
  resolveLinkedKubeOvnSubnet,
} from './nadsSectionUtils';

describe('nadsSectionUtils', () => {
  const kubeOvnNad = {
    metadata: { name: 'net-a', namespace: 'proj-1', uid: 'uid-1' },
    spec: {
      config: JSON.stringify({
        type: 'kube-ovn',
        provider: 'net-a.proj-1.ovn',
      }),
    },
  };

  const bridgeNad = {
    metadata: { name: 'br-net', namespace: 'proj-1', uid: 'uid-2' },
    spec: { config: JSON.stringify({ type: 'bridge', bridge: 'br0' }) },
  };

  it('processes nad list and infers cni type from plugins', () => {
    const rows = processNadList([kubeOvnNad, bridgeNad], false);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r._name === 'net-a')?._type).toBe('kube-ovn');
    expect(rows.find((r) => r._name === 'br-net')?._type).toBe('bridge');
  });

  it('filters bridge-only when onlyBridge is true', () => {
    const rows = processNadList([kubeOvnNad, bridgeNad], true);
    expect(rows).toHaveLength(1);
    expect(rows[0]._name).toBe('br-net');
  });

  it('finds dependent subnets for kube-ovn nad', () => {
    const row = processNadList([kubeOvnNad], false)[0];
    const subnets = [{ metadata: { name: 'net-a' } }, { metadata: { name: 'other' } }];
    expect(findDependentSubnetsForNad(row, subnets)).toEqual(['net-a']);
  });

  it('filters orphan ovn nad', () => {
    const rows = processNadList([kubeOvnNad], false);
    const subnetMap = new Map<string, unknown>();
    const filtered = filterNadsForTable(rows, {
      keyword: '',
      nsFilter: '',
      ipamFilter: '',
      orphanOvnNadFilter: OVN_NAD_ORPHAN_ONLY,
      ovnSubnetsLoading: false,
      subnetByNameLc: subnetMap,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]._name).toBe('net-a');
  });

  it('collectVmDisplayNamesUsingNad matches namespace/name ref', () => {
    const vms = [
      {
        namespace: 'proj-1',
        networks: ['proj-1/net-a'],
        name: 'vm-1',
      },
    ];
    expect(collectVmDisplayNamesUsingNad(vms, { _namespace: 'proj-1', _name: 'net-a' })).toEqual([
      'vm-1',
    ]);
  });

  it('inferCniTypeFromConfig reads plugins', () => {
    expect(
      inferCniTypeFromConfig({ plugins: [{ type: 'kube-ovn', provider: 'x.y.ovn' }] }),
    ).toBe('kube-ovn');
  });

  it('resolveLinkedKubeOvnSubnet matches subnet map', () => {
    const row = processNadList([kubeOvnNad], false)[0];
    const map = new Map<string, unknown>([['net-a', { metadata: { name: 'net-a' } }]]);
    expect(resolveLinkedKubeOvnSubnet(row, map)).toEqual({ metadata: { name: 'net-a' } });
  });

  it('parseKubeOvnSubnetsListResponse reads data.items and items', () => {
    expect(
      parseKubeOvnSubnetsListResponse({ data: { items: [{ metadata: { name: 'a' } }] } }),
    ).toHaveLength(1);
    expect(parseKubeOvnSubnetsListResponse({ items: [{ metadata: { name: 'b' } }] })).toHaveLength(1);
    expect(parseKubeOvnSubnetsListResponse({})).toEqual([]);
  });
});
