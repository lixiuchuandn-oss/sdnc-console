import {
  filterPciDevices,
  getPciDeviceState,
  getPciNodeName,
  pciVendorLabel,
  pciVendorName,
} from './pciDevicesSectionUtils';

describe('pciDevicesSectionUtils', () => {
  const sample = {
    name: 'gpu-01',
    nodeName: 'node-a',
    resourceName: 'nvidia.com/gpu',
    vendorId: '10DE',
    status: { pciAddress: '0000:01:00.0', vendorId: '10DE' },
    raw: { status: { kernelDriverInUse: 'vfio-pci' } },
  };

  describe('pciVendorName / pciVendorLabel', () => {
    it('maps known vendor ids', () => {
      expect(pciVendorName('10de')).toBe('NVIDIA');
      expect(pciVendorLabel('10de')).toBe('NVIDIA (10de)');
    });
  });

  describe('getPciNodeName', () => {
    it('reads nodeName from row', () => {
      expect(getPciNodeName(sample)).toBe('node-a');
    });
  });

  describe('getPciDeviceState', () => {
    it('detects vfio driver as passthrough-ready', () => {
      expect(getPciDeviceState(sample)).toBe('可透传');
    });
  });

  describe('filterPciDevices', () => {
    const bound = {
      ...sample,
      name: 'bound-gpu',
      vmInfo: { vmName: 'vm1', vmNamespace: 'default', vmDisplayName: 'VM1' },
    };
    const otherNode = { ...sample, name: 'other', nodeName: 'node-b' };

    it('filters by node and bind state', () => {
      const rows = filterPciDevices([sample, bound, otherNode], {
        keyword: '',
        nodeFilter: 'node-a',
        statusFilter: '',
        bindFilter: 'bound',
      });
      expect(rows).toHaveLength(1);
      expect((rows[0] as { name?: string }).name).toBe('bound-gpu');
    });

    it('matches keyword against vendor label', () => {
      const rows = filterPciDevices([sample, otherNode], {
        keyword: 'nvidia',
        nodeFilter: '',
        statusFilter: '',
        bindFilter: '',
      });
      expect(rows).toHaveLength(2);
    });
  });
});
