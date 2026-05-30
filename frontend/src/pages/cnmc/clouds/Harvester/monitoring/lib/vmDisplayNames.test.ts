import {
  applyVmDisplayNameToLabels,
  buildPromVmNameSelector,
  buildVmPrometheusNameToDisplayNameMap,
  buildVmSelectOptions,
  resolveVmMetricLegendName,
} from './vmDisplayNames';

describe('vmDisplayNames', () => {
  it('maps metadata.name to readVmName display', () => {
    const map = buildVmPrometheusNameToDisplayNameMap({
      data: [
        {
          metadata: {
            name: 'id-vm-abc',
            namespace: 'ns1',
            annotations: { 'tower.io/alias': '业务虚拟机 A' },
          },
        },
      ],
    });
    expect(map['id-vm-abc']).toBe('业务虚拟机 A');
    expect(map['ns1/id-vm-abc']).toBe('业务虚拟机 A');
  });

  it('resolves legend template with display name', () => {
    const nameMap = { 'id-vm-abc': '业务虚拟机 A' };
    expect(
      resolveVmMetricLegendName(
        { name: 'id-vm-abc', drive: 'disk0' },
        '{{name}}: {{drive}}',
        'fallback',
        nameMap,
      ),
    ).toBe('业务虚拟机 A: disk0');
  });

  it('buildVmSelectOptions excludes recycle bin and sorts by display name', () => {
    const options = buildVmSelectOptions({
      data: [
        {
          metadata: {
            name: 'id-vm-b',
            annotations: { 'tower.io/alias': 'B机' },
          },
        },
        {
          metadata: {
            name: 'id-vm-a',
            annotations: { 'tower.io/alias': 'A机' },
            labels: { 'tower.io/recycle-bin': 'true' },
          },
        },
      ],
    });
    expect(options).toEqual([{ id: 'id-vm-b', displayName: 'B机' }]);
  });

  it('buildPromVmNameSelector returns empty for all VMs', () => {
    expect(buildPromVmNameSelector()).toBe('');
    expect(buildPromVmNameSelector('  ')).toBe('');
  });

  it('buildPromVmNameSelector escapes quotes in vm id', () => {
    expect(buildPromVmNameSelector('id-vm-"x"')).toBe('{name="id-vm-\\"x\\""}');
  });

  it('applyVmDisplayNameToLabels maps domain label', () => {
    const labels = applyVmDisplayNameToLabels(
      { name: 'id-vm-x', domain: 'id-vm-x' },
      { 'id-vm-x': '展示名' },
    );
    expect(labels.name).toBe('展示名');
    expect(labels.domain).toBe('展示名');
  });
});
