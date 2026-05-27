import {
  buildGpuNodeFilterOptions,
  deriveGpuType,
  filterGpuDevices,
  getGpuDeviceState,
  getGpuNodeName,
  gpuDeviceRowKey,
  gpuPciAddress,
  gpuVendorName,
} from './gpusSectionUtils';

describe('gpusSectionUtils', () => {
  const sample = {
    type: 'passthrough',
    name: 'gpu-01',
    node: 'node-a',
    resourceName: 'nvidia.com/gpu',
    pciAddress: '0000:01:00.0',
    status: { vendorId: '10de', deviceName: 'gpu-01' },
    state: { name: 'active', error: false, transitioning: false },
  };

  describe('gpuVendorName', () => {
    it('maps known vendor ids', () => {
      expect(gpuVendorName('10de')).toBe('NVIDIA');
      expect(gpuVendorName('8086')).toBe('Intel');
    });
  });

  describe('deriveGpuType', () => {
    it('uses explicit type when present', () => {
      expect(deriveGpuType(sample)).toBe('passthrough');
    });

    it('derives vgpu from mdevName', () => {
      expect(deriveGpuType({ kind: 'GPUDevice', mdevName: 'nvidia-63' })).toBe('vgpu');
    });
  });

  describe('getGpuNodeName / gpuPciAddress', () => {
    it('reads node and pci from row', () => {
      expect(getGpuNodeName(sample)).toBe('node-a');
      expect(gpuPciAddress(sample)).toBe('0000:01:00.0');
    });
  });

  describe('getGpuDeviceState', () => {
    it('reads state object', () => {
      expect(getGpuDeviceState(sample)).toMatchObject({ name: 'active' });
    });
  });

  describe('filterGpuDevices', () => {
    const bound = {
      ...sample,
      name: 'bound-gpu',
      claimed: true,
      vmInfo: { vmName: 'vm1', vmNamespace: 'default', vmDisplayName: 'VM1' },
    };
    const otherNode = { ...sample, name: 'other', node: 'node-b', status: { deviceName: 'other', vendorId: '8086' } };
    const errorGpu = {
      ...sample,
      name: 'err-gpu',
      state: { name: 'error', error: true, transitioning: false },
    };

    it('filters by node and bind state', () => {
      const rows = filterGpuDevices([sample, bound, otherNode], {
        keyword: '',
        typeFilter: '',
        nodeFilter: 'node-a',
        statusFilter: '',
        bindFilter: 'bound',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe('bound-gpu');
    });

    it('filters by status error', () => {
      const rows = filterGpuDevices([sample, errorGpu], {
        keyword: '',
        typeFilter: '',
        nodeFilter: '',
        statusFilter: 'error',
        bindFilter: '',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe('err-gpu');
    });

    it('matches keyword against vendor id', () => {
      const rows = filterGpuDevices([sample, otherNode], {
        keyword: '10de',
        typeFilter: '',
        nodeFilter: '',
        statusFilter: '',
        bindFilter: '',
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe('gpuDeviceRowKey / buildGpuNodeFilterOptions', () => {
    it('builds stable row key and node options', () => {
      expect(gpuDeviceRowKey(sample)).toContain('0000:01:00.0');
      expect(buildGpuNodeFilterOptions([sample, { node: 'node-b' }])).toEqual(['node-a', 'node-b']);
    });
  });
});
