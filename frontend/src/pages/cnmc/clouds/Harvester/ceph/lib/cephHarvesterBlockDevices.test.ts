import {
  blockDeviceDriveKindLabel,
  buildMetadataDeviceSelectOptions,
  formatBlockDeviceSizeBytes,
  formatBlockDeviceStorageController,
  isBlockDevicePartition,
  isCephOsdCandidateDeviceName,
  isPartitionDevPath,
  isRemovableBlockDevice,
  parseBlockDeviceOptions,
  resolveBlockDeviceDriveKind,
  resolveBlockDeviceNodeName,
} from './cephHarvesterBlockDevices';

describe('cephHarvesterBlockDevices', () => {
  describe('formatBlockDeviceStorageController', () => {
    it('drops empty and unknown', () => {
      expect(formatBlockDeviceStorageController(undefined)).toBe('');
      expect(formatBlockDeviceStorageController('unknown')).toBe('');
      expect(formatBlockDeviceStorageController('NVMe')).toBe('NVMe');
    });
  });

  describe('formatBlockDeviceSizeBytes', () => {
    it('formats TB/GB/MB', () => {
      expect(formatBlockDeviceSizeBytes(2e12)).toMatch(/TB/);
      expect(formatBlockDeviceSizeBytes(500e9)).toMatch(/GB/);
      expect(formatBlockDeviceSizeBytes(0)).toBe('');
    });
  });

  describe('isCephOsdCandidateDeviceName', () => {
    it('rejects virtual devices', () => {
      expect(isCephOsdCandidateDeviceName('rbd0')).toBe(false);
      expect(isCephOsdCandidateDeviceName('loop7')).toBe(false);
      expect(isCephOsdCandidateDeviceName('sdd')).toBe(true);
      expect(isCephOsdCandidateDeviceName('/dev/nvme0n1')).toBe(true);
    });
  });

  describe('isRemovableBlockDevice', () => {
    it('detects removable flag and USB bus', () => {
      expect(isRemovableBlockDevice({ isRemovable: true })).toBe(true);
      expect(isRemovableBlockDevice({ busPath: 'pci-0000:00:14.0-usb-0:1:1.0' })).toBe(true);
      expect(isRemovableBlockDevice({ busPath: 'pci-0000:00:17.0' })).toBe(false);
    });
  });

  describe('isPartitionDevPath / isBlockDevicePartition', () => {
    it('detects partition paths', () => {
      expect(isPartitionDevPath('/dev/sde1')).toBe(true);
      expect(isPartitionDevPath('/dev/nvme0n1p2')).toBe(true);
      expect(isPartitionDevPath('/dev/sdd')).toBe(false);
    });

    it('detects NDM partition metadata', () => {
      expect(
        isBlockDevicePartition({
          ndmDeviceTypeLabel: 'part',
          devPath: '/dev/sdd',
        }),
      ).toBe(true);
      expect(
        isBlockDevicePartition({
          hasParentDeviceLabel: true,
          devPath: '/dev/sdd',
        }),
      ).toBe(true);
    });
  });

  describe('resolveBlockDeviceNodeName', () => {
    it('prefers spec then labels then Steve fields', () => {
      expect(
        resolveBlockDeviceNodeName(
          { nodeName: 'from-spec' },
          { labels: { 'kubernetes.io/hostname': 'from-label' }, fields: ['', '', '', '', 'from-steve'] },
        ),
      ).toBe('from-spec');
      expect(
        resolveBlockDeviceNodeName(
          {},
          { labels: { 'kubernetes.io/hostname': 'from-label' }, fields: ['', '', '', '', 'from-steve'] },
        ),
      ).toBe('from-label');
    });
  });

  describe('resolveBlockDeviceDriveKind', () => {
    it('uses driveType and nvme basename', () => {
      expect(
        resolveBlockDeviceDriveKind({
          driveType: 'HDD',
          value: 'sdd',
          devPath: '/dev/sdd',
          model: '',
        }),
      ).toBe('hdd');
      expect(
        resolveBlockDeviceDriveKind({
          driveType: '',
          value: 'nvme0n1',
          devPath: '/dev/nvme0n1',
          model: '',
        }),
      ).toBe('ssd');
      expect(blockDeviceDriveKindLabel('ssd')).toBe('固态盘');
    });
  });

  describe('parseBlockDeviceOptions', () => {
    const provisionedDisk = (overrides: Record<string, unknown> = {}) => ({
      metadata: { name: 'node1-sdd', ...(overrides.metadata as object) },
      spec: { nodeName: 'node1', devPath: '/dev/sdd', ...(overrides.spec as object) },
      status: {
        provisionPhase: 'Provisioned',
        deviceStatus: {
          devPath: '/dev/sdd',
          capacity: { sizeBytes: 2e12 },
          details: {
            driveType: 'HDD',
            model: 'WDC',
            serialNumber: 'SN1',
            deviceType: 'disk',
            ...(overrides.details as object),
          },
          ...(overrides.deviceStatus as object),
        },
        ...(overrides.status as object),
      },
    });

    it('keeps provisioned disks for the requested node', () => {
      const raw = { data: [provisionedDisk()] };
      const opts = parseBlockDeviceOptions(raw, 'node1');
      expect(opts).toHaveLength(1);
      expect(opts[0].value).toBe('sdd');
      expect(opts[0].blockDeviceCrName).toBe('node1-sdd');
      expect(opts[0].devPath).toBe('/dev/sdd');
    });

    it('resolves node and path from Steve list fields when spec is absent', () => {
      const raw = {
        data: [
          {
            metadata: {
              name: '7d44613640dfdb5cc934abe2ad4252d6',
              fields: ['7d44613640dfdb5cc934abe2ad4252d6', 'disk', '/dev/sdb', '', 'node-steve', 'Provisioned'],
            },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devPath: '/dev/sdb',
                capacity: { sizeBytes: 500e9 },
                details: { driveType: 'SSD', model: 'Samsung', serialNumber: 'SN2', deviceType: 'disk' },
              },
            },
          },
        ],
      };
      const opts = parseBlockDeviceOptions(raw, 'node-steve');
      expect(opts).toHaveLength(1);
      expect(opts[0].value).toBe('sdb');
      expect(opts[0].nodeName).toBe('node-steve');
    });

    it('prefers status.deviceStatus.devPath over spec.devicePath', () => {
      const raw = {
        data: [
          {
            metadata: { name: 'node1-sdd' },
            spec: { nodeName: 'node1', devicePath: '/dev/wrong' },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devPath: '/dev/sdd',
                capacity: { sizeBytes: 1e12 },
                details: { driveType: 'HDD', model: 'X', serialNumber: 'S', deviceType: 'disk' },
              },
            },
          },
        ],
      };
      expect(parseBlockDeviceOptions(raw, 'node1')[0].devPath).toBe('/dev/sdd');
    });

    it('excludes rbd and loop devices', () => {
      const raw = {
        data: [
          provisionedDisk({
            spec: { nodeName: 'node1', devPath: '/dev/rbd0' },
            metadata: { name: 'node1-rbd0' },
          }),
          provisionedDisk(),
        ],
      };
      const opts = parseBlockDeviceOptions(raw, 'node1');
      expect(opts.map((o) => o.value)).toEqual(['sdd']);
    });

    it('excludes removable USB disks', () => {
      const raw = {
        data: [
          provisionedDisk({
            metadata: { name: 'node1-usb' },
            details: {
              driveType: 'SSD',
              model: 'DataTraveler',
              serialNumber: 'USB1',
              isRemovable: true,
              busPath: 'pci-0000:00:14.0-usb-0:1:1.0',
            },
          }),
          provisionedDisk(),
        ],
      };
      const opts = parseBlockDeviceOptions(raw, 'node1');
      expect(opts.map((o) => o.value)).toEqual(['sdd']);
    });

    it('excludes partitions (Ventoy /dev/sde1)', () => {
      const raw = {
        data: [
          {
            metadata: {
              name: 'node1-sde1',
              labels: {
                'ndm.harvesterhci.io/device-type': 'part',
                'ndm.harvesterhci.io/parent-device': 'sde',
              },
            },
            spec: { nodeName: 'node1', devPath: '/dev/sde1' },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devPath: '/dev/sde1',
                capacity: { sizeBytes: 8e9 },
                details: { driveType: 'SSD', model: 'Ventoy', serialNumber: 'V1', deviceType: 'part' },
                parentDevice: 'sde',
              },
            },
          },
          provisionedDisk(),
        ],
      };
      const opts = parseBlockDeviceOptions(raw, 'node1');
      expect(opts.map((o) => o.value)).toEqual(['sdd']);
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
                devPath: '/dev/sdd',
                capacity: { sizeBytes: 2000000000000 },
                details: { driveType: 'HDD', model: 'WDC', serialNumber: 'SN1', deviceType: 'disk' },
              },
            },
          },
          {
            metadata: { name: 'node1-sdb' },
            spec: { nodeName: 'node1', devPath: '/dev/sdb' },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devPath: '/dev/sdb',
                capacity: { sizeBytes: 500000000000 },
                details: { driveType: 'SSD', model: 'Samsung', serialNumber: 'SN2', deviceType: 'disk' },
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
                devPath: '/dev/sdb',
                capacity: { sizeBytes: 500000000000 },
                details: { driveType: 'HDD', model: 'WDC', serialNumber: 'SN1', deviceType: 'disk' },
              },
            },
          },
          {
            metadata: { name: 'node1-nvme0n1' },
            spec: { nodeName: 'node1', devPath: '/dev/nvme0n1' },
            status: {
              provisionPhase: 'Provisioned',
              deviceStatus: {
                devPath: '/dev/nvme0n1',
                capacity: { sizeBytes: 500000000000 },
                details: { driveType: 'SSD', model: 'Samsung', serialNumber: 'SN2', deviceType: 'disk' },
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
