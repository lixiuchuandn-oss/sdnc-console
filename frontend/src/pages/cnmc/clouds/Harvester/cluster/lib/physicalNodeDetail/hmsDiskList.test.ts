import {
  filterHmsDisksForDisplay,
  hmsDiskDeviceBasename,
  isHmsNbdOrRbdDiskEntry,
} from './hmsDiskList';

describe('hmsDiskList', () => {
  describe('hmsDiskDeviceBasename', () => {
    it('strips /dev/ prefix', () => {
      expect(hmsDiskDeviceBasename('/dev/sda')).toBe('sda');
      expect(hmsDiskDeviceBasename('rbd0')).toBe('rbd0');
    });
  });

  describe('isHmsNbdOrRbdDiskEntry', () => {
    it('matches nbd and rbd device names', () => {
      expect(isHmsNbdOrRbdDiskEntry({ name: 'nbd0' })).toBe(true);
      expect(isHmsNbdOrRbdDiskEntry({ name: '/dev/nbd12' })).toBe(true);
      expect(isHmsNbdOrRbdDiskEntry({ Name: 'RBD3' })).toBe(true);
      expect(isHmsNbdOrRbdDiskEntry({ name: 'rbd0' })).toBe(true);
      expect(isHmsNbdOrRbdDiskEntry({ type: 'rbd' })).toBe(true);
      expect(isHmsNbdOrRbdDiskEntry({ name: 'sda', type: 'disk' })).toBe(false);
      expect(isHmsNbdOrRbdDiskEntry({ name: 'nvme0n1' })).toBe(false);
    });
  });

  describe('filterHmsDisksForDisplay', () => {
    it('removes nbd/rbd from top level and children', () => {
      const out = filterHmsDisksForDisplay([
        { name: 'sda', type: 'disk' },
        { name: 'nbd0', type: 'disk' },
        {
          name: 'sdb',
          type: 'disk',
          children: [{ name: 'sdb1', type: 'part' }, { name: 'rbd0', type: 'disk' }],
        },
      ]);
      expect(out).toHaveLength(2);
      const first = out[0] as { name?: string };
      const second = out[1] as { children?: { name?: string }[] };
      expect(first.name).toBe('sda');
      expect(second.children).toHaveLength(1);
      expect(second.children![0].name).toBe('sdb1');
    });
  });
});
