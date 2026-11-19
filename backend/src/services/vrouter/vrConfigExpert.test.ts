import { findSrv6TunnelsReferencingVr } from '../../routes/sdn/srv6.references';
import { captureRolePreSnapshotIfEmpty } from './rolePreSnapshot';
import { vrController } from './vrController';
import {
  assertExpertVrConfigWriteAllowed,
  dispatchExpertVrConfig,
  persistExpertVrConfig,
} from './vrConfigExpert';

jest.mock('../../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

jest.mock('../../routes/sdn/srv6.references', () => ({
  findSrv6TunnelsReferencingVr: jest.fn(),
}));

jest.mock('./rolePreSnapshot', () => ({
  captureRolePreSnapshotIfEmpty: jest.fn(),
  RolePreSnapshotError: class RolePreSnapshotError extends Error {
    statusCode = 503;
  },
}));

jest.mock('./vrController', () => ({
  vrController: {
    updateVRConfig: jest.fn(),
  },
}));

jest.mock('./vrConfigDeploy', () => ({
  assertCsmUpdateSuccess: jest.fn(),
}));

const { AppDataSource } = jest.requireMock('../../config/database') as {
  AppDataSource: { getRepository: jest.Mock };
};

const findRefs = findSrv6TunnelsReferencingVr as jest.MockedFunction<typeof findSrv6TunnelsReferencingVr>;
const capture = captureRolePreSnapshotIfEmpty as jest.MockedFunction<typeof captureRolePreSnapshotIfEmpty>;
const updateVRConfig = vrController.updateVRConfig as jest.MockedFunction<typeof vrController.updateVRConfig>;

describe('assertExpertVrConfigWriteAllowed', () => {
  it('409s when the VR is referenced by tunnels', async () => {
    findRefs.mockResolvedValue([{ tunnelId: 't1', tunnelName: 'tun-a', slot: 'peA' }]);
    await expect(assertExpertVrConfigWriteAllowed('vr-a')).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('tun-a'),
    });
  });

  it('allows write when no tunnels reference the VR', async () => {
    findRefs.mockResolvedValue([]);
    await expect(assertExpertVrConfigWriteAllowed('vr-a')).resolves.toBeUndefined();
  });
});

describe('persistExpertVrConfig / dispatchExpertVrConfig', () => {
  const rows = new Map<string, Record<string, unknown>>();
  const save = jest.fn(async (row: Record<string, unknown>) => {
    rows.set(String(row.uuid), row);
    return row;
  });
  const create = jest.fn((row: Record<string, unknown>) => ({ ...row }));
  const findOne = jest.fn(async ({ where: { uuid } }: { where: { uuid: string } }) => rows.get(uuid) ?? null);

  beforeEach(() => {
    jest.clearAllMocks();
    rows.clear();
    AppDataSource.getRepository.mockReturnValue({ findOne, save, create });
    findRefs.mockResolvedValue([]);
    capture.mockResolvedValue('skipped');
    updateVRConfig.mockResolvedValue({ status: 200, headers: {}, data: { code: 200 } });
  });

  it('writes expert body to config_json when there is no tunnel', async () => {
    rows.set('vr-a', { uuid: 'vr-a', config_json: '{"old":1}' });
    await persistExpertVrConfig('vr-a', { role: 'CE', note: 'x' });
    expect(capture).toHaveBeenCalledWith('vr-a');
    expect(JSON.parse(String(rows.get('vr-a')?.config_json))).toEqual({ role: 'CE', note: 'x' });
  });

  it('refreshes leftover SRv6 baseline when expert writes with no tunnels', async () => {
    rows.set('vr-a', {
      uuid: 'vr-a',
      config_json: '{"old":1}',
      srv6BaselineJson: '{"old":1}',
    });
    await persistExpertVrConfig('vr-a', { role: 'CE', note: 'x' });
    expect(JSON.parse(String(rows.get('vr-a')?.srv6BaselineJson))).toEqual({ role: 'CE', note: 'x' });
  });

  it('does not POST when expert upsert is blocked by tunnels', async () => {
    findRefs.mockResolvedValue([{ tunnelId: 't1', tunnelName: 'tun-a', slot: 'ceA' }]);
    await expect(dispatchExpertVrConfig('vr-a', { bgp: [] })).rejects.toMatchObject({ statusCode: 409 });
    expect(updateVRConfig).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('POSTs after a successful expert persist', async () => {
    await dispatchExpertVrConfig('vr-a', { role: 'CE' });
    expect(updateVRConfig).toHaveBeenCalledTimes(1);
    expect(updateVRConfig.mock.calls[0][0]).toBe('vr-a');
    expect(updateVRConfig.mock.calls[0][1]).toMatchObject({ role: 'CE', uuid: 'vr-a' });
  });
});
