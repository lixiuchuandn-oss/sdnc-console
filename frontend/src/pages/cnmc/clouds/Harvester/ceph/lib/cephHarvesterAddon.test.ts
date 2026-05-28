import {
  buildHarvesterAddonFormValuesFromStatus,
  buildMetadataDeviceSelectOptions,
  isCephOsdCandidateDeviceName,
  normalizeDatabaseSizeMBInput,
  parseDatabaseSizeMB,
  parseBlockDeviceOptions,
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

describe('cephHarvesterAddon block devices', () => {
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
  });

  describe('isCephOsdCandidateDeviceName', () => {
    it('rejects virtual device names', () => {
      expect(isCephOsdCandidateDeviceName('rbd0')).toBe(false);
      expect(isCephOsdCandidateDeviceName('/dev/rbd0')).toBe(false);
      expect(isCephOsdCandidateDeviceName('loop0')).toBe(false);
      expect(isCephOsdCandidateDeviceName('dm-0')).toBe(false);
    });

    it('accepts whole-disk names', () => {
      expect(isCephOsdCandidateDeviceName('sdd')).toBe(true);
      expect(isCephOsdCandidateDeviceName('/dev/nvme0n1')).toBe(true);
    });
  });

  describe('parseBlockDeviceOptions', () => {
    it('filters rbd devices and dedupes by resolved value', () => {
      const raw = {
        data: [
          {
            metadata: { name: 'node1-rbd-a' },
            spec: { nodeName: 'node1', devPath: '/dev/rbd0' },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devicePath: '/dev/rbd0',
                capacity: { sizeBytes: 215000000000 },
                details: { driveType: 'SSD', model: 'unknown', serialNumber: 'unknown' },
              },
            },
          },
          {
            metadata: { name: 'node1-rbd-b' },
            spec: { nodeName: 'node1', devPath: '/dev/rbd0' },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devicePath: '/dev/rbd0',
                capacity: { sizeBytes: 228000000000 },
                details: { driveType: 'SSD', model: 'unknown', serialNumber: 'unknown' },
              },
            },
          },
          {
            metadata: { name: 'node1-sdd' },
            spec: { nodeName: 'node1', devPath: '/dev/sdd' },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devicePath: '/dev/sdd',
                capacity: { sizeBytes: 2000000000000 },
                details: { driveType: 'HDD', model: 'WDC WD200', serialNumber: 'SN123' },
              },
            },
          },
        ],
      };

      const opts = parseBlockDeviceOptions(raw, 'node1');
      expect(opts).toHaveLength(1);
      expect(opts[0].value).toBe('sdd');
      expect(opts[0].blockDeviceCrName).toBe('node1-sdd');
    });
  });

  describe('databaseSizeMB helpers', () => {
    it('parses MB and legacy Gi strings', () => {
      expect(parseDatabaseSizeMB(30720)).toBe(30720);
      expect(parseDatabaseSizeMB('30Gi')).toBe(30720);
      expect(parseDatabaseSizeMB('')).toBeUndefined();
      expect(normalizeDatabaseSizeMBInput(1024)).toBe(1024);
    });
  });

  describe('buildMetadataDeviceSelectOptions', () => {
    it('excludes disks already selected as data devices', () => {
      const raw = {
        data: [
          {
            metadata: { name: 'node1-sdd' },
            spec: { nodeName: 'node1', devPath: '/dev/sdd' },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devicePath: '/dev/sdd',
                capacity: { sizeBytes: 2000000000000 },
                details: { driveType: 'HDD', model: 'WDC', serialNumber: 'SN1' },
              },
            },
          },
          {
            metadata: { name: 'node1-sdb' },
            spec: { nodeName: 'node1', devPath: '/dev/sdb' },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devicePath: '/dev/sdb',
                capacity: { sizeBytes: 500000000000 },
                details: { driveType: 'SSD', model: 'Samsung', serialNumber: 'SN2' },
              },
            },
          },
        ],
      };
      const opts = buildMetadataDeviceSelectOptions(raw, 'node1', undefined, ['sdd']);
      expect(opts).toHaveLength(1);
      expect(opts[0].value).toBe('sdb');
    });

    it('excludes HDD from metadata candidates', () => {
      const raw = {
        data: [
          {
            metadata: { name: 'node1-sdb' },
            spec: { nodeName: 'node1', devPath: '/dev/sdb' },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devicePath: '/dev/sdb',
                capacity: { sizeBytes: 500000000000 },
                details: { driveType: 'HDD', model: 'WDC', serialNumber: 'SN1' },
              },
            },
          },
          {
            metadata: { name: 'node1-nvme0n1' },
            spec: { nodeName: 'node1', devPath: '/dev/nvme0n1' },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devicePath: '/dev/nvme0n1',
                capacity: { sizeBytes: 500000000000 },
                details: { driveType: 'SSD', model: 'Samsung', serialNumber: 'SN2' },
              },
            },
          },
        ],
      };
      const opts = buildMetadataDeviceSelectOptions(raw, 'node1', undefined, []);
      expect(opts).toHaveLength(1);
      expect(opts[0].value).toBe('nvme0n1');
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
    expect(validateRunningClusterConfigChange(before, after)).toMatch(/不可移除已有 OSD/);
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
