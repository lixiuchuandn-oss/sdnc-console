import type { DatacenterRack, DatacenterRackDevice } from '../../../../../../services/datacenterTopologyApi';
import {
  buildHarvesterNodeSelectOptions,
  buildNodeMetricsMapFromK8sMetrics,
  buildSwitchSelectOptions,
  clampRackCarouselIndex,
  collectTakenRefKeys,
  filterSelectOptionsExcludingTakenRefs,
  findRackIndexBySwitchRef,
  harvesterNodeName,
  nextRackSortOrderDefault,
  normalizeHarvesterNodesList,
  rackGridFullSpan,
  resolveRackDeviceLabel,
  switchDisplayLabel,
  switchStableRef,
} from './datacenterTopologySectionUtils';

describe('datacenterTopologySectionUtils', () => {
  it('normalizeHarvesterNodesList reads items from envelope', () => {
    expect(normalizeHarvesterNodesList({ data: { items: [{ metadata: { name: 'n1' } }] } })).toHaveLength(1);
    expect(normalizeHarvesterNodesList(null)).toEqual([]);
  });

  it('harvesterNodeName reads metadata.name', () => {
    expect(harvesterNodeName({ metadata: { name: 'node-a' } })).toBe('node-a');
  });

  it('buildNodeMetricsMapFromK8sMetrics parses cpu/memory', () => {
    const map = buildNodeMetricsMapFromK8sMetrics([
      { metadata: { name: 'n1' }, usage: { cpu: '500m', memory: '1Gi' } },
    ]);
    expect(map.n1?.cpuUsedCores).toBeCloseTo(0.5);
    expect(map.n1?.memUsedBytes).toBeGreaterThan(0);
  });

  it('switchStableRef prefers management host from probe record', () => {
    const sw = { info: { host: '10.0.0.1', lines: [{ stdout: 'System Name: SW1' }] } };
    expect(switchStableRef(sw)).toBe('10.0.0.1');
    expect(switchDisplayLabel(sw)).toContain('SW1');
  });

  it('buildHarvesterNodeSelectOptions includes management IP', () => {
    const opts = buildHarvesterNodeSelectOptions([
      { metadata: { name: 'n1' }, status: { addresses: [{ type: 'InternalIP', address: '192.168.1.2' }] } },
    ]);
    expect(opts[0]?.label).toContain('192.168.1.2');
  });

  it('filterSelectOptionsExcludingTakenRefs keeps editing ref', () => {
    const options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    const out = filterSelectOptionsExcludingTakenRefs(options, ['a', 'b'], 'b');
    expect(out.map((o) => o.value)).toEqual(['b']);
  });

  it('collectTakenRefKeys filters by sourceKind', () => {
    const devices: DatacenterRackDevice[] = [
      {
        id: '1',
        rackId: 'r1',
        sourceKind: 'node',
        refKey: 'n1',
        customLabel: null,
        slotOrder: 1,
      },
      {
        id: '2',
        rackId: 'r1',
        sourceKind: 'switch',
        refKey: '10.0.0.1',
        customLabel: null,
        slotOrder: 2,
      },
    ];
    expect(collectTakenRefKeys(devices, 'switch')).toEqual(['10.0.0.1']);
  });

  it('resolveRackDeviceLabel for missing node', () => {
    const d: DatacenterRackDevice = {
      id: '1',
      rackId: 'r1',
      sourceKind: 'node',
      refKey: 'ghost',
      customLabel: null,
      slotOrder: 0,
    };
    expect(resolveRackDeviceLabel(d, [], [])).toContain('未在集群中找到');
  });

  it('findRackIndexBySwitchRef matches switch refKey', () => {
    const racks: DatacenterRack[] = [
      {
        id: 'r1',
        cloudId: 'c1',
        name: 'R1',
        sortOrder: 0,
        devices: [
          {
            id: 'd1',
            rackId: 'r1',
            sourceKind: 'switch',
            refKey: '10.0.0.9',
            customLabel: null,
            slotOrder: 1,
          },
        ],
      },
    ];
    expect(findRackIndexBySwitchRef(racks, '10.0.0.9')).toBe(0);
    expect(findRackIndexBySwitchRef(racks, 'missing')).toBe(-1);
  });

  it('rackGridFullSpan and carousel helpers', () => {
    expect(rackGridFullSpan(24)).toBe('1 / 25');
    expect(nextRackSortOrderDefault([{ id: 'a', cloudId: 'c', name: 'A', sortOrder: 3, devices: [] }])).toBe(4);
    expect(clampRackCarouselIndex(5, 2)).toBe(1);
    expect(clampRackCarouselIndex(5, 0)).toBe(0);
  });

  it('buildSwitchSelectOptions dedupes by ref', () => {
    const sw = { info: { host: '1.1.1.1' } };
    const opts = buildSwitchSelectOptions([sw, sw]);
    expect(opts).toHaveLength(1);
    expect(opts[0]?.value).toBe('1.1.1.1');
  });
});
