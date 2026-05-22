import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../../utils/towerKubeOvnNames';
import { SUBNET_TYPE_ANNOTATION_KEY, TOWER_ALIAS_ANNOTATION } from '../../kube-ovn/lib/kubeOvnSubnetConstants';
import {
  buildClusterNetworkOptions,
  buildFlowStaleFingerprint,
  buildPnNicTopology,
  buildProviderNetworkOptions,
  buildSubnetsGroupedForProvider,
  deriveProviderNetworkMeta,
  filterVlansForProvider,
  flowZoomButtonTitle,
  kubeMetaName,
  parseClusterNetworkItems,
  pickClusterNetworkByName,
  providerNetworkHeaderTitle,
  resolveEffectiveSelection,
  resolveUserSelectionAfterListChange,
} from './networkTopologySectionUtils';

describe('networkTopologySectionUtils', () => {
  it('kubeMetaName reads metadata.name', () => {
    expect(kubeMetaName({ metadata: { name: 'pn1' } })).toBe('pn1');
  });

  it('buildProviderNetworkOptions uses alias annotation', () => {
    const opts = buildProviderNetworkOptions([
      {
        metadata: {
          name: 'pn1',
          annotations: { [TOWER_IO_ALIES_ANNOTATION]: '生产网' },
        },
      },
    ]);
    expect(opts[0]?.label).toContain('生产网');
    expect(opts[0]?.value).toBe('pn1');
  });

  it('buildClusterNetworkOptions uses friendly label fn', () => {
    const opts = buildClusterNetworkOptions([{ metadata: { name: 'cn-a' } }], () => '友好名');
    expect(opts[0]?.label).toContain('友好名');
  });

  it('resolveEffectiveSelection falls back to first item', () => {
    const items = [{ metadata: { name: 'first' } }];
    expect(resolveEffectiveSelection(undefined, items)).toBe('first');
    expect(resolveEffectiveSelection('picked', items)).toBe('picked');
  });

  it('deriveProviderNetworkMeta reads ready and alias', () => {
    const meta = deriveProviderNetworkMeta({
      metadata: { name: 'pn', annotations: { [TOWER_IO_ALIES_ANNOTATION]: '别名' } },
      status: { ready: true },
    });
    expect(meta.metaName).toBe('pn');
    expect(meta.displayName).toBe('别名');
    expect(meta.ready).toBe(true);
    expect(providerNetworkHeaderTitle(meta)).toBe('别名');
  });

  it('filterVlansForProvider filters by spec.provider', () => {
    const vlans = [
      { metadata: { name: 'v1' }, spec: { provider: 'pn1' } },
      { metadata: { name: 'v2' }, spec: { provider: 'other' } },
    ];
    expect(filterVlansForProvider(vlans, 'pn1').map((v) => kubeMetaName(v))).toEqual(['v1']);
  });

  it('buildSubnetsGroupedForProvider splits public and flat', () => {
    const vlans = [{ metadata: { name: 'vlan10' }, spec: { provider: 'pn1', id: 10 } }];
    const subnets = [
      {
        metadata: {
          name: 'pub1',
          annotations: { [SUBNET_TYPE_ANNOTATION_KEY]: 'public', [TOWER_ALIAS_ANNOTATION]: '公网' },
        },
        spec: { vlan: 'vlan10', cidrBlock: '10.0.0.0/24', gateway: '10.0.0.1' },
      },
      {
        metadata: { name: 'flat1', annotations: { [SUBNET_TYPE_ANNOTATION_KEY]: 'flat' } },
        spec: { vlan: 'vlan10', cidr: '192.168.0.0/24' },
      },
    ];
    const { publicSubnetsForPn, flatSubnetsForPn } = buildSubnetsGroupedForProvider('pn1', vlans, subnets);
    expect(publicSubnetsForPn).toHaveLength(1);
    expect(publicSubnetsForPn[0]?.alias).toBe('公网');
    expect(flatSubnetsForPn).toHaveLength(1);
  });

  it('buildPnNicTopology assigns default vs custom nodes', () => {
    const topo = buildPnNicTopology(
      {
        spec: {
          defaultInterface: 'eth0',
          customInterfaces: [{ interface: 'eth1', nodes: ['n2'] }],
        },
      },
      ['n1', 'n2'],
    );
    expect(topo?.defaultIf).toBe('eth0');
    expect(topo?.nodesOnDefault).toEqual(['n1']);
  });

  it('parseClusterNetworkItems accepts items or data.items', () => {
    expect(parseClusterNetworkItems({ items: [{ metadata: { name: 'a' } }] })).toHaveLength(1);
    expect(parseClusterNetworkItems({ data: { items: [{ metadata: { name: 'b' } }] } })).toHaveLength(1);
  });

  it('pickClusterNetworkByName returns single match', () => {
    const list = [{ metadata: { name: 'cn1' } }, { metadata: { name: 'cn2' } }];
    expect(pickClusterNetworkByName(list, 'cn2')).toHaveLength(1);
    expect(kubeMetaName(pickClusterNetworkByName(list, 'cn2')[0])).toBe('cn2');
  });

  it('resolveUserSelectionAfterListChange keeps valid prev', () => {
    const items = [{ metadata: { name: 'a' } }, { metadata: { name: 'b' } }];
    expect(resolveUserSelectionAfterListChange('b', items)).toBe('b');
    expect(resolveUserSelectionAfterListChange('gone', items)).toBe('a');
  });

  it('buildFlowStaleFingerprint differs by topoView', () => {
    const underlay = buildFlowStaleFingerprint({
      topoView: 'underlay',
      effectiveProviderName: 'pn',
      vlanLoading: false,
      subnetLoading: false,
      physicalTopoLoading: false,
      effectiveClusterNetworkName: '',
      clusterNetworksLoading: false,
    });
    expect(underlay).toContain('underlay:pn');
    expect(flowZoomButtonTitle(true, '放大')).toBe('暂无拓扑画布');
  });
});
