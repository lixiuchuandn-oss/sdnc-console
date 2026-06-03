import { buildPhysicalNodeDetailTabItems } from '../buildPhysicalNodeDetailTabItems';
import { buildPhysicalNodeDetailDerived } from './tabModel';
import type { PhysicalNodeDetailTabContext } from './types';

describe('physicalNodeDetail tabModel', () => {
  const baseCtx: PhysicalNodeDetailTabContext = {
    record: {
      name: 'node-a',
      ready: true,
      status: {
        capacity: { cpu: '8', memory: '32Gi' },
        allocatable: { cpu: '7', memory: '30Gi' },
        nodeInfo: { architecture: 'amd64', kubeletVersion: 'v1.28.0' },
      },
    },
    titleName: 'node-a',
    ready: true,
    nodeRoles: ['worker'],
    internalIP: '10.0.0.1',
    harvesterVersion: '',
    annotations: {},
    ntp: null,
    podRequests: null,
    podLimits: null,
    nics: [],
    nicColumns: [],
    hardware: null,
    physicalIfaces: [],
    ifaceStatusMap: {},
  };

  it('buildPhysicalNodeDetailDerived reads capacity from status', () => {
    const d = buildPhysicalNodeDetailDerived(baseCtx);
    expect(d.capCpu).toBe('8');
    expect(d.allocMem).toBe('30Gi');
    expect(d.cpuUsageDisplay).toContain('0.00/7.00');
  });

  it('buildPhysicalNodeDetailTabItems returns 9 tabs', () => {
    const items = buildPhysicalNodeDetailTabItems(baseCtx);
    expect(items).toHaveLength(9);
    expect(items?.map((t) => t?.key)).toEqual([
      'harv-node',
      'harv-annotations',
      'harv-sched',
      'hms-board',
      'hms-cpu',
      'hms-memory',
      'hms-disk',
      'hms-nics',
      'hms-lldp',
    ]);
  });

  it('sorts empty memory modules after installed ones', () => {
    const d = buildPhysicalNodeDetailDerived({
      ...baseCtx,
      hardware: {
        memory: [{ Size: 'No Module Installed' }, { Size: '16 GB', Locator: 'DIMM0' }],
      },
    });
    expect((d.memListSorted[0] as { Locator?: string }).Locator).toBe('DIMM0');
  });

  it('excludes NBD and RBD disks from HMS storage list', () => {
    const d = buildPhysicalNodeDetailDerived({
      ...baseCtx,
      hardware: {
        disk: [
          { name: 'sda', type: 'disk', model: 'WDC' },
          { name: 'nbd0', type: 'disk' },
          { name: 'rbd1', type: 'disk' },
        ],
      },
    });
    expect(d.diskList).toHaveLength(1);
    expect((d.diskList[0] as { name?: string }).name).toBe('sda');
  });
});
