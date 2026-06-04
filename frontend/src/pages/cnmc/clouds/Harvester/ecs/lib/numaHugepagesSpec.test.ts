import {
  parseHugepagesFromVm,
  parseMemoryGiFromQuantity,
  parseNumaFromVm,
  validateHugepagesForm,
  validateNumaForm,
  validateVmPerformanceAdvancedForm,
  formatHugepagesSummary,
  formatNumaSummary,
  buildManualNumaNodes,
  describeManualNumaPreview,
  normalizeNumaMode,
} from './numaHugepagesSpec';

describe('numaHugepagesSpec', () => {
  it('parses hugepages from VM domain', () => {
    expect(parseHugepagesFromVm({ memory: { hugepages: { pageSize: '2Mi' } } })).toEqual({
      hugepagesEnabled: true,
      hugepagesPageSize: '2Mi',
    });
  });

  it('parses numa modes from vm', () => {
    expect(parseNumaFromVm({ cpu: { numa: { guestMappingPassthrough: {} } } })).toEqual({
      numaMode: 'auto',
      numaManualNodeCount: 2,
    });
    expect(
      parseNumaFromVm({
        cpu: { numa: { nodes: [{ vcpus: '0-3', memory: '4Gi' }, { vcpus: '4-7', memory: '4Gi' }] } },
      }),
    ).toEqual({ numaMode: 'manual', numaManualNodeCount: 2 });
  });

  it('validates hotplug conflict', () => {
    expect(
      validateVmPerformanceAdvancedForm({
        numaMode: 'auto',
        dedicatedCPUPlacement: true,
        hotExpandEnabled: true,
      }),
    ).toMatch(/热扩容/);
  });

  it('validates manual numa params', () => {
    expect(
      validateNumaForm({
        numaMode: 'manual',
        numaManualNodeCount: 2,
        dedicatedCPUPlacement: true,
        cpuSockets: 2,
        cpuCores: 4,
        cpuThreads: 1,
        memory: '8Gi',
      }),
    ).toBeNull();
  });

  it('builds manual preview', () => {
    const preview = describeManualNumaPreview({
      numaMode: 'manual',
      numaManualNodeCount: 2,
      cpuSockets: 2,
      cpuCores: 4,
      cpuThreads: 1,
      memory: '8Gi',
    });
    expect(preview).toContain('节点1');
    expect(preview).toContain('vCPU 0-3');
  });

  it('formats summary', () => {
    expect(formatNumaSummary('manual', 2)).toBe('手动拓扑 · 2 节点');
    expect(normalizeNumaMode({ numaGuestMappingPassthrough: true })).toBe('auto');
  });

  it('parses memory quantity', () => {
    expect(parseMemoryGiFromQuantity('8Gi')).toBe(8);
  });

  it('validates 1Gi hugepages alignment', () => {
    expect(
      validateHugepagesForm({
        hugepagesEnabled: true,
        hugepagesPageSize: '1Gi',
        memory: '1.5Gi',
      }),
    ).toMatch(/整数 GiB/);
  });

  it('formats hugepages summary', () => {
    expect(formatHugepagesSummary(true, '1Gi')).toBe('1 GiB 大页');
  });
});
