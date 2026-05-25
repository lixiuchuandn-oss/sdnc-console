import {
  filterUsbDevices,
  getUsbDeviceName,
  getUsbNodeName,
  getUsbState,
  usbStateLabel,
  usbVendorLabel,
} from './usbDevicesSectionUtils';

describe('usbDevicesSectionUtils', () => {
  const active = {
    name: 'usb-disk',
    resourceName: 'usb.example/disk',
    nodeName: 'node-1',
    vendorId: '0951',
    enabled: true,
    raw: { status: { devicePath: '/dev/bus/usb/001/002' } },
  };
  const inactive = {
    name: 'usb-keyboard',
    nodeName: 'node-2',
    enabled: false,
    raw: { status: { vendorId: '046b' } },
  };

  describe('getUsbState', () => {
    it('maps enabled boolean to active/inactive', () => {
      expect(getUsbState(active)).toBe('active');
      expect(getUsbState(inactive)).toBe('inactive');
    });
  });

  describe('usbStateLabel', () => {
    it('returns Chinese labels', () => {
      expect(usbStateLabel('active')).toBe('活跃');
      expect(usbStateLabel('unknown')).toBe('未知');
    });
  });

  describe('usbVendorLabel', () => {
    it('maps Kingston vendor id', () => {
      expect(usbVendorLabel('0951')).toBe('Kingston (0951)');
    });
  });

  describe('getUsbNodeName / getUsbDeviceName', () => {
    it('reads node and metadata name', () => {
      expect(getUsbNodeName(active)).toBe('node-1');
      expect(getUsbDeviceName({ raw: { metadata: { name: 'usb-cr-1' } } })).toBe('usb-cr-1');
    });
  });

  describe('filterUsbDevices', () => {
    it('filters by node and status', () => {
      const rows = filterUsbDevices([active, inactive], {
        keyword: '',
        nodeFilter: 'node-1',
        statusFilter: 'active',
        bindFilter: '',
      });
      expect(rows).toHaveLength(1);
      expect((rows[0] as { name?: string }).name).toBe('usb-disk');
    });

    it('matches keyword against device path', () => {
      const rows = filterUsbDevices([active, inactive], {
        keyword: '001/002',
        nodeFilter: '',
        statusFilter: '',
        bindFilter: '',
      });
      expect(rows).toHaveLength(1);
    });

    it('filters unbound devices', () => {
      const claimed = { ...active, claimed: true };
      const rows = filterUsbDevices([active, claimed], {
        keyword: '',
        nodeFilter: '',
        statusFilter: '',
        bindFilter: 'unbound',
      });
      expect(rows).toHaveLength(1);
      expect((rows[0] as { claimed?: boolean }).claimed).toBeFalsy();
    });
  });
});
