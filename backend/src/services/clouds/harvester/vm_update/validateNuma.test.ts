import { validateNumaSpec } from './validateNuma';

describe('validateNumaSpec', () => {
  const baseVm = {
    spec: {
      template: {
        spec: {
          domain: {
            cpu: { dedicatedCpuPlacement: true, sockets: 2, cores: 4, threads: 1 },
            memory: { guest: '8Gi' },
            resources: { requests: { memory: '8Gi' } },
          },
        },
      },
    },
    metadata: { annotations: {} },
  };

  it('allows auto mode', () => {
    expect(() => validateNumaSpec({ numaMode: 'auto' }, baseVm)).not.toThrow();
  });

  it('allows manual mode with valid topology', () => {
    expect(() =>
      validateNumaSpec({ numaMode: 'manual', numaManualNodeCount: 2 }, baseVm),
    ).not.toThrow();
  });

  it('rejects manual when sockets not divisible', () => {
    expect(() =>
      validateNumaSpec(
        { numaMode: 'manual', numaManualNodeCount: 2, cpuSockets: 3 },
        baseVm,
      ),
    ).toThrow(/插槽/);
  });

  it('rejects hotplug + NUMA', () => {
    const hotplugVm = {
      ...baseVm,
      metadata: { annotations: { 'harvesterhci.io/enableCPUAndMemoryHotplug': 'true' } },
    };
    expect(() => validateNumaSpec({ numaMode: 'auto' }, hotplugVm)).toThrow(/热扩容/);
  });
});
