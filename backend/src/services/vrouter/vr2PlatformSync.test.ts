import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { getVR2QueryResult } from './vrController';
import { shouldPreserveSrv6PlatformLedger, syncVr2ConfigsToPlatform } from './vr2PlatformSync';

jest.mock('../../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

jest.mock('./vrController', () => ({
  getVR2QueryResult: jest.fn(),
}));

const { AppDataSource } = jest.requireMock('../../config/database') as {
  AppDataSource: { getRepository: jest.Mock };
};

const getVR2 = getVR2QueryResult as jest.MockedFunction<typeof getVR2QueryResult>;

const LEDGER_JSON = JSON.stringify({
  bgp: [
    {
      neighbor: [{ remote_ip: '2200::100', remote_as: 65001, ebgp_multihop: 255 }],
      neighbor_disable_connected_check: ['2200::100'],
    },
  ],
});

const VR2_WITHOUT_MULTIHOP = {
  role: 'SPOKE_PE',
  bgp: [
    {
      neighbor: [{ remote_ip: '2200::100', remote_as: 65001 }],
      neighbor_disable_connected_check: ['2200::100'],
    },
  ],
};

const okVr2 = (config: unknown) => ({
  config,
  csmBizError: null,
  transportError: null,
  csm_http_body_raw: config,
});

describe('shouldPreserveSrv6PlatformLedger', () => {
  const ids = new Set(['pe-a']);

  it('preserves only when baseline exists and VR is tunnel-referenced', () => {
    expect(shouldPreserveSrv6PlatformLedger({ srv6BaselineJson: '{}' }, ids, 'pe-a')).toBe(true);
    expect(shouldPreserveSrv6PlatformLedger({ srv6BaselineJson: '   ' }, ids, 'pe-a')).toBe(false);
    expect(shouldPreserveSrv6PlatformLedger({ srv6BaselineJson: '{}' }, ids, 'other')).toBe(false);
    expect(shouldPreserveSrv6PlatformLedger(null, ids, 'pe-a')).toBe(false);
  });
});

describe('syncVr2ConfigsToPlatform', () => {
  const rows = new Map<string, Record<string, unknown>>();
  const save = jest.fn(async (row: Record<string, unknown>) => row);
  const create = jest.fn((row: Record<string, unknown>) => ({ ...row }));
  const findOne = jest.fn(async ({ where: { uuid } }: { where: { uuid: string } }) => rows.get(uuid) ?? null);
  const tunnelFind = jest.fn(async () => [] as Array<{ peA: string; peB: string; ceA: string; ceB: string }>);

  beforeEach(() => {
    jest.clearAllMocks();
    rows.clear();
    AppDataSource.getRepository.mockImplementation((entity: unknown) => {
      if (entity === SRv6Tunnel) return { find: tunnelFind };
      return { findOne, save, create };
    });
    getVR2.mockResolvedValue(okVr2(VR2_WITHOUT_MULTIHOP) as Awaited<ReturnType<typeof getVR2QueryResult>>);
  });

  it('does not overwrite config_json when VR has SRv6 baseline and tunnel ref', async () => {
    rows.set('pe-a', {
      uuid: 'pe-a',
      config_json: LEDGER_JSON,
      srv6BaselineJson: '{"bgp":[]}',
      role: 'SPOKE_PE',
    });
    tunnelFind.mockResolvedValue([{ peA: 'pe-a', peB: 'pe-b', ceA: 'ce-a', ceB: 'ce-b' }]);

    const r = await syncVr2ConfigsToPlatform(['pe-a']);
    expect(r.ok).toBe(true);
    expect(r.skippedLedger).toBe(1);
    expect(r.updated).toBe(0);
    expect(save).not.toHaveBeenCalled();
    const neighbor = (JSON.parse(String(rows.get('pe-a')?.config_json)).bgp[0].neighbor as Array<{
      ebgp_multihop?: number;
    }>)[0];
    expect(neighbor.ebgp_multihop).toBe(255);
  });

  it('still updates role when preserving the SRv6 ledger', async () => {
    const row = {
      uuid: 'pe-a',
      config_json: LEDGER_JSON,
      srv6BaselineJson: '{"bgp":[]}',
      role: 'CE',
    };
    rows.set('pe-a', row);
    tunnelFind.mockResolvedValue([{ peA: 'pe-a', peB: '', ceA: '', ceB: '' }]);

    const r = await syncVr2ConfigsToPlatform(['pe-a']);
    expect(r.skippedLedger).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(row.role).toBe('SPOKE_PE');
    expect(JSON.parse(String(row.config_json)).bgp[0].neighbor[0].ebgp_multihop).toBe(255);
  });

  it('overwrites config_json when the VR has no SRv6 baseline', async () => {
    const row = { uuid: 'vr-x', config_json: LEDGER_JSON, srv6BaselineJson: null, role: 'PE' };
    rows.set('vr-x', row);

    const r = await syncVr2ConfigsToPlatform(['vr-x']);
    expect(r.updated).toBe(1);
    expect(r.skippedLedger).toBe(0);
    expect(JSON.parse(String(row.config_json)).bgp[0].neighbor[0].ebgp_multihop).toBeUndefined();
  });

  it('overwrites when baseline exists but VR is not referenced by tunnels', async () => {
    const row = {
      uuid: 'idle',
      config_json: LEDGER_JSON,
      srv6BaselineJson: '{"bgp":[]}',
    };
    rows.set('idle', row);
    tunnelFind.mockResolvedValue([{ peA: 'other', peB: '', ceA: '', ceB: '' }]);

    const r = await syncVr2ConfigsToPlatform(['idle']);
    expect(r.updated).toBe(1);
    expect(r.skippedLedger).toBe(0);
    expect(JSON.parse(String(row.config_json)).bgp[0].neighbor[0].ebgp_multihop).toBeUndefined();
  });

  it('creates a row when VR2 exists and platform has none', async () => {
    const r = await syncVr2ConfigsToPlatform(['new-vr']);
    expect(r.updated).toBe(1);
    expect(create).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it('counts noConfig and leaves ledger untouched when VR2 is missing', async () => {
    getVR2.mockResolvedValue({
      config: null,
      csmBizError: { code: 404, msg: 'none' },
      transportError: null,
      csm_http_body_raw: null,
    } as Awaited<ReturnType<typeof getVR2QueryResult>>);
    rows.set('pe-a', { uuid: 'pe-a', config_json: LEDGER_JSON, srv6BaselineJson: '{}' });

    const r = await syncVr2ConfigsToPlatform(['pe-a']);
    expect(r.noConfig).toBe(1);
    expect(save).not.toHaveBeenCalled();
  });
});
