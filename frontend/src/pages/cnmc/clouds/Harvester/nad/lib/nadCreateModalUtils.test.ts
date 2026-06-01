import {
  buildBridgeNameForClusterNetwork,
  buildNadCreatePayload,
  buildNadCniConfig,
  clusterNetworkDisplayName,
  extractHarvesterNamespaceItems,
  extractNamespaceNameList,
  pickClusterNetworkDefault,
} from './nadCreateModalUtils';

describe('nadCreateModalUtils', () => {
  it('builds bridge name for cluster network', () => {
    expect(buildBridgeNameForClusterNetwork('mgmt')).toBe('mgmt-br');
    expect(buildBridgeNameForClusterNetwork('vlan-net')).toBe('vlan-net-br');
  });

  it('builds cni config with optional vlan', () => {
    const config = buildNadCniConfig('id-nad-abc', 'mgmt-br', 100);
    expect(config.type).toBe('bridge');
    expect(config.bridge).toBe('mgmt-br');
    expect(config.vlan).toBe(100);
  });

  it('builds nad create payload with alias annotation', () => {
    const payload = buildNadCreatePayload(
      {
        name: '业务网',
        namespace: 'proj-1',
        clusterNetwork: 'mgmt',
      },
      'id-nad-test123',
    );
    expect(payload.metadata.name).toBe('id-nad-test123');
    expect(payload.metadata.namespace).toBe('proj-1');
    expect(payload.metadata.annotations?.['tower.io/alias']).toBe('业务网');
    expect(JSON.parse(payload.spec.config).bridge).toBe('mgmt-br');
  });

  it('extracts namespace list and picks cluster network default', () => {
    const res = { data: { items: [{ metadata: { name: 'default' } }, { metadata: { name: 'proj-1' } }] } };
    expect(extractHarvesterNamespaceItems(res)).toHaveLength(2);
    expect(extractNamespaceNameList(res)).toEqual(['default', 'proj-1']);
    expect(pickClusterNetworkDefault([{ metadata: { name: 'vlan-a' } }], 'missing')).toBe('vlan-a');
  });

  it('clusterNetworkDisplayName maps mgmt', () => {
    expect(clusterNetworkDisplayName('mgmt')).toBe('管理网');
    expect(clusterNetworkDisplayName('vlan-a')).toBe('vlan-a');
  });
});
