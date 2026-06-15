import { validateHugepagesSpec } from './validateHugepages';

describe('validateHugepagesSpec', () => {
  const baseVm = {
    spec: {
      template: {
        spec: {
          domain: {
            memory: { guest: '4Gi' },
            resources: { requests: { memory: '4Gi' }, limits: { memory: '4Gi' } },
          },
        },
      },
    },
    metadata: { annotations: {} },
  };

  it('allows enabling 2Mi hugepages', () => {
    expect(() =>
      validateHugepagesSpec({ hugepagesEnabled: true, hugepagesPageSize: '2Mi' }, baseVm),
    ).not.toThrow();
  });

  it('rejects hotplug + hugepages', () => {
    const hotplugVm = {
      ...baseVm,
      metadata: { annotations: { 'harvesterhci.io/enableCPUAndMemoryHotplug': 'true' } },
    };
    expect(() =>
      validateHugepagesSpec({ hugepagesEnabled: true, hugepagesPageSize: '2Mi' }, hotplugVm),
    ).toThrow(/热扩容/);
  });

  it('rejects invalid page size', () => {
    expect(() =>
      validateHugepagesSpec({ hugepagesEnabled: true, hugepagesPageSize: '4Mi' }, baseVm),
    ).toThrow(/2Mi 或 1Gi/);
  });
});
