import {
  fetchMonitoringOverviewFastLaneCoreOutcome,
  fetchMonitoringOverviewFastLaneExtrasOutcome,
  fetchMonitoringOverviewSlowLaneOutcome,
} from './overviewFetchBundles';

jest.mock('../../../../../../services/monitoringApi', () => ({
  fetchNodeResources: jest.fn(),
  fetchNodeMetrics: jest.fn(),
  fetchStorageNodes: jest.fn(),
  fetchCephDashboardSummary: jest.fn(),
  fetchCephResources: jest.fn(),
  fetchAlertsRules: jest.fn(),
  fetchBlockDevices: jest.fn(),
  fetchVirtualMachines: jest.fn(),
  fetchVirtualMachineInstances: jest.fn(),
}));

jest.mock('services/harvester/clusterInventory', () => ({
  fetchHarvesterStorageClasses: jest.fn(),
}));

const monitoringApi = jest.requireMock('../../../../../../services/monitoringApi') as {
  fetchNodeResources: jest.Mock;
  fetchNodeMetrics: jest.Mock;
  fetchStorageNodes: jest.Mock;
  fetchCephDashboardSummary: jest.Mock;
  fetchCephResources: jest.Mock;
  fetchAlertsRules: jest.Mock;
  fetchBlockDevices: jest.Mock;
  fetchVirtualMachines: jest.Mock;
  fetchVirtualMachineInstances: jest.Mock;
};

const clusterInventory = jest.requireMock('services/harvester/clusterInventory') as {
  fetchHarvesterStorageClasses: jest.Mock;
};

describe('overviewFetchBundles', () => {
  const signal = new AbortController().signal;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetchMonitoringOverviewFastLaneCoreOutcome merges core lane data', async () => {
    monitoringApi.fetchNodeResources.mockResolvedValue({ ok: true, data: { data: [] } });
    monitoringApi.fetchNodeMetrics.mockResolvedValue({ ok: true, data: { data: [] } });
    monitoringApi.fetchStorageNodes.mockResolvedValue({ ok: true, data: { items: [] } });

    const out = await fetchMonitoringOverviewFastLaneCoreOutcome('cloud-1', signal);
    expect(out.laneError).toBeNull();
    expect(out.data.nodeResources).toEqual({ data: [] });
    expect(out.data.storageNodes).toEqual({ items: [] });
  });

  it('fetchMonitoringOverviewFastLaneCoreOutcome surfaces first core error', async () => {
    monitoringApi.fetchNodeResources.mockResolvedValue({ ok: false, error: 'nodes down' });
    monitoringApi.fetchNodeMetrics.mockResolvedValue({ ok: true, data: {} });
    monitoringApi.fetchStorageNodes.mockResolvedValue({ ok: true, data: {} });

    const out = await fetchMonitoringOverviewFastLaneCoreOutcome('cloud-1', signal);
    expect(out.laneError).toBe('nodes down');
    expect(out.data.nodeResources).toBeNull();
  });

  it('fetchMonitoringOverviewFastLaneExtrasOutcome skips ceph dashboard error envelope', async () => {
    monitoringApi.fetchCephDashboardSummary.mockResolvedValue({
      ok: true,
      data: { data: { health: 'HEALTH_OK' }, _tower: { cephDashboardError: true } },
    });
    monitoringApi.fetchCephResources.mockResolvedValue({ ok: true, data: { clusters: [] } });
    clusterInventory.fetchHarvesterStorageClasses.mockResolvedValue({ items: [] });

    const out = await fetchMonitoringOverviewFastLaneExtrasOutcome('cloud-1', signal);
    expect(out.laneError).toBeNull();
    expect(out.data.cephHealthMinimal).toBeNull();
    expect(out.data.cephResourcesRaw).toEqual({ clusters: [] });
    expect(out.data.storageClassesJson).toEqual({ items: [] });
  });

  it('fetchMonitoringOverviewSlowLaneOutcome merges slow lane payloads', async () => {
    monitoringApi.fetchAlertsRules.mockResolvedValue({ ok: true, data: { rules: [] } });
    monitoringApi.fetchBlockDevices.mockResolvedValue({ ok: true, data: { data: [] } });
    monitoringApi.fetchVirtualMachines.mockResolvedValue({ ok: true, data: { items: [] } });
    monitoringApi.fetchVirtualMachineInstances.mockResolvedValue({ ok: true, data: { items: [] } });

    const out = await fetchMonitoringOverviewSlowLaneOutcome('cloud-1', signal);
    expect(out.laneError).toBeNull();
    expect(out.data.alertsRules).toEqual({ rules: [] });
    expect(out.data.blockDevices).toEqual({ data: [] });
  });
});
