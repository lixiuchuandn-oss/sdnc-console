import {
  diskCapacityDisplay,
  diskTypeChip,
  ellip,
  isHmsVirtualDiskEntry,
  isPhysicalRootDisk,
  nicStateToPortKind,
  physicalHardDisksOnly,
} from './embeddedPhysicalNodePanelUtils';

describe('embeddedPhysicalNodePanelUtils', () => {
  describe('ellip', () => {
    it('truncates long text with ellipsis', () => {
      expect(ellip(11, 'short')).toBe('short');
      expect(ellip(11, 'very-long-disk-name')).toBe('very-long-…');
    });
  });

  describe('isPhysicalRootDisk', () => {
    it('excludes partition/lvm types', () => {
      expect(isPhysicalRootDisk({ type: 'disk' })).toBe(true);
      expect(isPhysicalRootDisk({ type: 'part' })).toBe(false);
      expect(isPhysicalRootDisk({ Type: 'lvm' })).toBe(false);
    });
  });

  describe('isHmsVirtualDiskEntry', () => {
    it('treats missing model and virtio-style entries as virtual', () => {
      expect(isHmsVirtualDiskEntry({ name: 'sda' })).toBe(true);
      expect(isHmsVirtualDiskEntry({ model: 'virtio-scsi' })).toBe(true);
      expect(isHmsVirtualDiskEntry({ name: 'vda' })).toBe(true);
      expect(isHmsVirtualDiskEntry({ name: 'sda', model: 'Samsung SSD' })).toBe(false);
    });
  });

  describe('physicalHardDisksOnly', () => {
    it('keeps only physical disks with HMS model', () => {
      const disks = physicalHardDisksOnly({
        disk: [
          { name: 'sda', type: 'disk', model: 'WDC WD1800' },
          { name: 'sdb', type: 'disk' },
          { name: 'sda1', type: 'part' },
          { name: 'vda', model: 'virtio' },
        ],
      });
      expect(disks).toHaveLength(1);
      expect(disks[0].name).toBe('sda');
    });
  });

  describe('nicStateToPortKind', () => {
    it('maps HMS nic state to port kind', () => {
      expect(nicStateToPortKind({ state: 'up' })).toBe('up');
      expect(nicStateToPortKind({ state: 'Down' })).toBe('down');
      expect(nicStateToPortKind({ state: 'admin down' })).toBe('admin');
      expect(nicStateToPortKind({ placeholder: true })).toBe('unknown');
    });
  });

  describe('diskTypeChip', () => {
    it('classifies nvme and rotational disks', () => {
      expect(diskTypeChip({ name: 'nvme0n1' })).toBe('SSD');
      expect(diskTypeChip({ name: 'sda', rota: 1 })).toBe('HDD');
      expect(diskTypeChip({ name: 'sdb', model: 'Samsung SSD 860' })).toBe('SSD');
      expect(diskTypeChip({ name: 'sdc' })).toBe('DISK');
    });
  });

  describe('diskCapacityDisplay', () => {
    it('reads size field', () => {
      expect(diskCapacityDisplay({ size: '1.8T' })).toBe('1.8T');
      expect(diskCapacityDisplay({})).toBe('');
    });
  });
});
