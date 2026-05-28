import {
  buildAllNodesEmptyDeviceRows,
  buildHarvesterAddonFormValuesFromStatus,
  normalizeDatabaseSizeMBInput,
  parseDatabaseSizeMB,
  validateRunningClusterConfigChange,
  type CephHarvesterAddonValuesConfig,
} from './cephHarvesterAddon';

function sampleRunningConfig(
  nodes: CephHarvesterAddonValuesConfig['cephCluster']['nodes'],
): CephHarvesterAddonValuesConfig {
  return {
    replicaSize: 3,
    requireSafeReplicaSize: false,
    compressionMode: 'none',
    storageClass: {
      jobImage: 'docker.io/rancher/shell:v0.5.0',
      reclaimPolicy: 'Delete',
      allowVolumeExpansion: true,
      volumeBindingMode: 'Immediate',
    },
    cephtools: { replicas: 3, image: 'quay.io/ceph/ceph:v19.2.3' },
    cephCluster: {
      cephVersionImage: 'quay.io/ceph/ceph:v19.2.3',
      allowUnsupported: false,
      monCount: 3,
      allowMultipleMonPerNode: false,
      mgrCount: 3,
      dashboardEnabled: true,
      useAllNodes: false,
      useAllDevices: false,
      nodes,
      osdsPerDevice: '1',
      osdObjectstore: 'bluestore',
      metadataDevice: '',
    },
    operator: { replicas: 1, image: 'docker.io/rook/ceph:v1.19.3' },
  };
}

describe('cephHarvesterAddon form', () => {
  describe('buildHarvesterAddonFormValuesFromStatus', () => {
    it('groups configured nodes and devices for Form.List', () => {
      const values = buildHarvesterAddonFormValuesFromStatus({
        config: {
          replicaSize: 3,
          requireSafeReplicaSize: false,
          compressionMode: 'none',
          storageClass: {
            jobImage: 'docker.io/rancher/shell:v0.5.0',
            reclaimPolicy: 'Delete',
            allowVolumeExpansion: true,
            volumeBindingMode: 'Immediate',
          },
          cephtools: { replicas: 3, image: 'quay.io/ceph/ceph:v19.2.3' },
          cephCluster: {
            cephVersionImage: 'quay.io/ceph/ceph:v19.2.3',
            allowUnsupported: false,
            monCount: 3,
            allowMultipleMonPerNode: false,
            mgrCount: 3,
            dashboardEnabled: true,
            useAllNodes: false,
            useAllDevices: false,
            nodes: [
              { nodeName: 'node1', deviceName: 'sdd' },
              { nodeName: 'node2', deviceName: 'sdd' },
              { nodeName: 'node3', deviceName: 'sdd' },
            ],
            osdsPerDevice: '1',
            osdObjectstore: 'bluestore',
            metadataDevice: '',
          },
          operator: { replicas: 1, image: 'docker.io/rook/ceph:v1.19.3' },
        },
      });

      expect(values.cephCluster.nodes).toHaveLength(3);
      expect(values.cephCluster.nodes[0]).toMatchObject({
        nodeName: 'node1',
        deviceNames: ['sdd'],
      });
    });

    it('does not pre-fill nodes when Addon is disabled', () => {
      const values = buildHarvesterAddonFormValuesFromStatus({
        phase: 'disabled',
        config: {
          replicaSize: 3,
          requireSafeReplicaSize: false,
          compressionMode: 'none',
          storageClass: {
            jobImage: 'docker.io/rancher/shell:v0.5.0',
            reclaimPolicy: 'Delete',
            allowVolumeExpansion: true,
            volumeBindingMode: 'Immediate',
          },
          cephtools: { replicas: 3, image: 'quay.io/ceph/ceph:v19.2.3' },
          cephCluster: {
            cephVersionImage: 'quay.io/ceph/ceph:v19.2.3',
            allowUnsupported: false,
            monCount: 3,
            allowMultipleMonPerNode: false,
            mgrCount: 3,
            dashboardEnabled: true,
            useAllNodes: false,
            useAllDevices: false,
            nodes: [{ nodeName: 'node1', deviceName: 'sdd' }],
            osdsPerDevice: '1',
            osdObjectstore: 'bluestore',
            metadataDevice: '',
          },
          operator: { replicas: 1, image: 'docker.io/rook/ceph:v1.19.3' },
        },
      });
      expect(values.cephCluster.nodes).toEqual([
        { nodeName: '', deviceNames: [], metadataDevice: '' },
      ]);
    });
  });

  it('buildAllNodesEmptyDeviceRows lists every node without disks', () => {
    expect(
      buildAllNodesEmptyDeviceRows([
        { value: 'node-a', label: 'node-a' },
        { value: 'node-b', label: 'node-b' },
      ]),
    ).toEqual([
      { nodeName: 'node-a', deviceNames: [], metadataDevice: '' },
      { nodeName: 'node-b', deviceNames: [], metadataDevice: '' },
    ]);
  });

  describe('databaseSizeMB helpers', () => {
    it('parses MB and legacy Gi strings', () => {
      expect(parseDatabaseSizeMB(30720)).toBe(30720);
      expect(parseDatabaseSizeMB('30Gi')).toBe(30720);
      expect(parseDatabaseSizeMB('')).toBeUndefined();
      expect(normalizeDatabaseSizeMBInput(1024)).toBe(1024);
    });
  });

});

describe('validateRunningClusterConfigChange', () => {
  const before = sampleRunningConfig([
    { nodeName: 'node1', deviceName: 'sdd' },
    { nodeName: 'node2', deviceName: 'sdd' },
  ]);

  it('allows adding a disk on an existing node', () => {
    const after = sampleRunningConfig([
      { nodeName: 'node1', deviceName: 'sdd' },
      { nodeName: 'node1', deviceName: 'sde' },
      { nodeName: 'node2', deviceName: 'sdd' },
    ]);
    expect(validateRunningClusterConfigChange(before, after)).toBeNull();
  });

  it('allows adding a new node with disks', () => {
    const after = sampleRunningConfig([
      { nodeName: 'node1', deviceName: 'sdd' },
      { nodeName: 'node2', deviceName: 'sdd' },
      { nodeName: 'node3', deviceName: 'sdd' },
    ]);
    expect(validateRunningClusterConfigChange(before, after)).toBeNull();
  });

  it('rejects removing an existing osd', () => {
    const after = sampleRunningConfig([{ nodeName: 'node1', deviceName: 'sdd' }]);
    expect(validateRunningClusterConfigChange(before, after)).toMatch(/不可移除已有数据盘/);
  });

  it('rejects unchanged config without new disks', () => {
    expect(validateRunningClusterConfigChange(before, before)).toMatch(/须新增至少一块数据盘/);
  });

  it('rejects replica size changes', () => {
    const after = {
      ...before,
      replicaSize: 2,
      cephCluster: {
        ...before.cephCluster,
        nodes: [
          ...before.cephCluster.nodes,
          { nodeName: 'node3', deviceName: 'sdd' },
        ],
      },
    };
    expect(validateRunningClusterConfigChange(before, after)).toMatch(/数据副本数/);
  });
});
