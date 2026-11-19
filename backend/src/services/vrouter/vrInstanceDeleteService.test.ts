import fs from 'fs';
import path from 'path';
import { getVR2QueryResult, unregisterVrFromCsm, vrController } from './vrController';
import { listVrInstanceBinders } from './vrInstanceBinders';
import { deleteVrInstance, previewVrInstanceDelete } from './vrInstanceDeleteService';

jest.mock('../../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

jest.mock('./vrInstanceBinders', () => ({
  listVrInstanceBinders: jest.fn(),
}));

jest.mock('./vrController', () => ({
  getVR2QueryResult: jest.fn(),
  unregisterVrFromCsm: jest.fn(),
  vrController: {
    updateVRConfig: jest.fn(),
  },
}));

const { AppDataSource } = jest.requireMock('../../config/database') as {
  AppDataSource: { getRepository: jest.Mock };
};

const listBinders = listVrInstanceBinders as jest.MockedFunction<typeof listVrInstanceBinders>;
const getVR2 = getVR2QueryResult as jest.MockedFunction<typeof getVR2QueryResult>;
const unregister = unregisterVrFromCsm as jest.MockedFunction<typeof unregisterVrFromCsm>;
const updateVRConfig = vrController.updateVRConfig as jest.MockedFunction<typeof vrController.updateVRConfig>;

const SNAPSHOT = { interfaces: [{ name: 'ge0' }] };
const SNAPSHOT_JSON = JSON.stringify(SNAPSHOT);

const okVr2 = (config: unknown) => ({
  config,
  csmBizError: null,
  transportError: null,
  csm_http_body_raw: config,
});

describe('deleteVrInstance', () => {
  const deletes: string[] = [];
  const findOne = jest.fn();
  const del = jest.fn(async () => {
    deletes.push('x');
    return { affected: 1 };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    deletes.length = 0;
    listBinders.mockResolvedValue([]);
    findOne.mockResolvedValue(null);
    AppDataSource.getRepository.mockReturnValue({
      findOne,
      find: jest.fn(async () => []),
      delete: del,
    });
    unregister.mockResolvedValue('ok');
    updateVRConfig.mockResolvedValue({ status: 200, headers: {}, data: { code: 200 } });
  });

  it('409s on binders and does not unregister', async () => {
    listBinders.mockResolvedValue([
      { type: 'srv6', id: 't1', name: 'tun-a', href: '/admin/interconnect/srv6' },
    ]);
    await expect(deleteVrInstance('vr-a')).rejects.toMatchObject({ reason: 'binders', statusCode: 409 });
    expect(unregister).not.toHaveBeenCalled();
    expect(updateVRConfig).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('409s without POST or unregister when there is no snapshot', async () => {
    await expect(deleteVrInstance('vr-a')).rejects.toMatchObject({
      reason: 'no_snapshot',
      statusCode: 409,
    });
    expect(updateVRConfig).not.toHaveBeenCalled();
    expect(unregister).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('does not unregister when CSM unregister throws', async () => {
    findOne.mockResolvedValue({ uuid: 'vr-a', rolePreSnapshot: SNAPSHOT_JSON });
    getVR2.mockResolvedValue(okVr2({ ...SNAPSHOT, report_config_status: 'applied' }) as Awaited<
      ReturnType<typeof getVR2QueryResult>
    >);
    unregister.mockRejectedValue(new Error('csm down'));
    await expect(
      deleteVrInstance('vr-a', { appliedTimeoutMs: 50, pollMs: 1, sleep: async () => undefined }),
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(del).not.toHaveBeenCalled();
  });

  it('still cleans sqlite when CSM already 404', async () => {
    findOne.mockResolvedValue({ uuid: 'vr-a', rolePreSnapshot: SNAPSHOT_JSON });
    getVR2.mockResolvedValue(okVr2({ ...SNAPSHOT, report_config_status: 'applied' }) as Awaited<
      ReturnType<typeof getVR2QueryResult>
    >);
    unregister.mockResolvedValue('already_gone');
    const result = await deleteVrInstance('vr-a', {
      appliedTimeoutMs: 50,
      pollMs: 1,
      sleep: async () => undefined,
    });
    expect(result.alreadyGone).toBe(true);
    expect(del).toHaveBeenCalled();
  });

  it('POST snapshot then waits for applied before unregister', async () => {
    findOne.mockResolvedValue({ uuid: 'vr-a', rolePreSnapshot: SNAPSHOT_JSON, config_json: '{"role":"CE"}' });
    getVR2
      .mockResolvedValueOnce(okVr2({ role: 'CE', vrrp: [{ vrid: 1 }], report_config_status: 'pending' }) as Awaited<
        ReturnType<typeof getVR2QueryResult>
      >)
      .mockResolvedValueOnce(okVr2({ ...SNAPSHOT, report_config_status: 'applied' }) as Awaited<
        ReturnType<typeof getVR2QueryResult>
      >);

    const result = await deleteVrInstance('vr-a', {
      acknowledgeDrift: true,
      appliedTimeoutMs: 50,
      pollMs: 1,
      sleep: async () => undefined,
    });
    expect(updateVRConfig).toHaveBeenCalledTimes(1);
    expect(updateVRConfig.mock.calls[0][1]).toMatchObject(SNAPSHOT);
    expect(JSON.stringify(updateVRConfig.mock.calls[0][1])).not.toContain('srv6Baseline');
    expect((updateVRConfig.mock.calls[0][1] as { report_config_status?: string }).report_config_status).toBeUndefined();
    expect(result.deviceReverted).toBe(true);
    expect(unregister).toHaveBeenCalled();
  });

  it('does not POST again when VR2 already equals snapshot; still waits for applied', async () => {
    findOne.mockResolvedValue({ uuid: 'vr-a', rolePreSnapshot: SNAPSHOT_JSON });
    getVR2
      .mockResolvedValueOnce(okVr2({ ...SNAPSHOT, report_config_status: 'pending' }) as Awaited<
        ReturnType<typeof getVR2QueryResult>
      >)
      .mockResolvedValue(okVr2({ ...SNAPSHOT, report_config_status: 'applied' }) as Awaited<
        ReturnType<typeof getVR2QueryResult>
      >);

    await deleteVrInstance('vr-a', { appliedTimeoutMs: 50, pollMs: 1, sleep: async () => undefined });
    expect(updateVRConfig).not.toHaveBeenCalled();
    expect(unregister).toHaveBeenCalled();
  });

  it('does not treat a stale applied status on the old config as done', async () => {
    findOne.mockResolvedValue({ uuid: 'vr-a', rolePreSnapshot: SNAPSHOT_JSON });
    getVR2
      .mockResolvedValueOnce(
        okVr2({ role: 'CE', report_config_status: 'applied' }) as Awaited<ReturnType<typeof getVR2QueryResult>>,
      )
      .mockResolvedValueOnce(
        okVr2({ role: 'CE', report_config_status: 'applied' }) as Awaited<ReturnType<typeof getVR2QueryResult>>,
      )
      .mockResolvedValue(
        okVr2({ ...SNAPSHOT, report_config_status: 'applied' }) as Awaited<ReturnType<typeof getVR2QueryResult>>,
      );

    const result = await deleteVrInstance('vr-a', {
      acknowledgeDrift: true,
      appliedTimeoutMs: 50,
      pollMs: 1,
      sleep: async () => undefined,
    });
    expect(updateVRConfig).toHaveBeenCalledTimes(1);
    expect(result.deviceReverted).toBe(true);
    expect(getVR2.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('clears device finish after unregister when management IP is known', async () => {
    findOne.mockResolvedValue({
      uuid: 'vr-a',
      rolePreSnapshot: SNAPSHOT_JSON,
      managementIp: '10.1.1.1',
    });
    getVR2.mockResolvedValue(
      okVr2({ ...SNAPSHOT, report_config_status: 'applied' }) as Awaited<ReturnType<typeof getVR2QueryResult>>,
    );
    const clearDeviceRegistration = jest.fn(async () => undefined);
    const result = await deleteVrInstance('vr-a', {
      appliedTimeoutMs: 50,
      pollMs: 1,
      sleep: async () => undefined,
      clearDeviceRegistration,
    });
    expect(clearDeviceRegistration).toHaveBeenCalledWith({ uuid: 'vr-a', managementIp: '10.1.1.1' });
    expect(unregister.mock.invocationCallOrder[0]).toBeLessThan(clearDeviceRegistration.mock.invocationCallOrder[0]);
    expect(result.registrationFinishCleared).toBe(true);
    expect(result.registrationClearError).toBeUndefined();
    expect(del).toHaveBeenCalled();
  });

  it('still deletes the platform row when finish writeback fails', async () => {
    findOne.mockResolvedValue({
      uuid: 'vr-a',
      rolePreSnapshot: SNAPSHOT_JSON,
      managementIp: '10.1.1.1',
    });
    getVR2.mockResolvedValue(
      okVr2({ ...SNAPSHOT, report_config_status: 'applied' }) as Awaited<ReturnType<typeof getVR2QueryResult>>,
    );
    const result = await deleteVrInstance('vr-a', {
      appliedTimeoutMs: 50,
      pollMs: 1,
      sleep: async () => undefined,
      clearDeviceRegistration: async () => {
        throw new Error('device down');
      },
    });
    expect(result.registrationFinishCleared).toBe(false);
    expect(result.registrationClearError).toMatch(/device down/);
    expect(unregister).toHaveBeenCalled();
    expect(del).toHaveBeenCalled();
  });

  it('treats device ok:false as a writeback failure and still deletes the platform row', async () => {
    findOne.mockResolvedValue({
      uuid: 'vr-a',
      rolePreSnapshot: SNAPSHOT_JSON,
      managementIp: '10.1.1.1',
    });
    getVR2.mockResolvedValue(
      okVr2({ ...SNAPSHOT, report_config_status: 'applied' }) as Awaited<ReturnType<typeof getVR2QueryResult>>,
    );
    const result = await deleteVrInstance('vr-a', {
      appliedTimeoutMs: 50,
      pollMs: 1,
      sleep: async () => undefined,
      clearDeviceRegistration: async () => ({ ok: false, error: 'uuid mismatch' }),
    });
    expect(result.registrationFinishCleared).toBe(false);
    expect(result.registrationClearError).toMatch(/uuid mismatch/);
    expect(del).toHaveBeenCalled();
  });

  it('does not unregister when applied never arrives', async () => {
    findOne.mockResolvedValue({ uuid: 'vr-a', rolePreSnapshot: SNAPSHOT_JSON });
    getVR2.mockResolvedValue(okVr2({ ...SNAPSHOT, report_config_status: 'pending' }) as Awaited<
      ReturnType<typeof getVR2QueryResult>
    >);
    await expect(
      deleteVrInstance('vr-a', { appliedTimeoutMs: 5, pollMs: 5, sleep: async () => undefined }),
    ).rejects.toMatchObject({ reason: 'not_applied' });
    expect(unregister).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('409s on drift when not acknowledged and does not POST', async () => {
    findOne.mockResolvedValue({ uuid: 'vr-a', rolePreSnapshot: SNAPSHOT_JSON });
    getVR2.mockResolvedValue(okVr2({ role: 'CE', vrrp: [{ vrid: 9 }] }) as Awaited<
      ReturnType<typeof getVR2QueryResult>
    >);
    await expect(deleteVrInstance('vr-a')).rejects.toMatchObject({ reason: 'drift' });
    expect(updateVRConfig).not.toHaveBeenCalled();
    expect(unregister).not.toHaveBeenCalled();
  });

  it('does not import pushVRConfig', () => {
    const src = fs.readFileSync(path.join(__dirname, 'vrInstanceDeleteService.ts'), 'utf8');
    expect(src).not.toMatch(/pushVRConfig/);
  });

  it('requires ack when VR2 is unreadable instead of posting blindly', async () => {
    findOne.mockResolvedValue({ uuid: 'vr-a', rolePreSnapshot: SNAPSHOT_JSON });
    getVR2.mockResolvedValue(okVr2(null) as Awaited<ReturnType<typeof getVR2QueryResult>>);
    await expect(deleteVrInstance('vr-a')).rejects.toMatchObject({ reason: 'drift' });
    expect(updateVRConfig).not.toHaveBeenCalled();
    expect(unregister).not.toHaveBeenCalled();
  });
});

describe('previewVrInstanceDelete', () => {
  const findOne = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    listBinders.mockResolvedValue([]);
    findOne.mockResolvedValue(null);
    AppDataSource.getRepository.mockReturnValue({ findOne, delete: jest.fn() });
  });

  it('reports vrrp drift against the role-pre snapshot', async () => {
    findOne.mockResolvedValue({ uuid: 'vr-a', rolePreSnapshot: SNAPSHOT_JSON });
    getVR2.mockResolvedValue(
      okVr2({ interfaces: [{ name: 'ge0' }], vrrp: [{ vrid: 9 }] }) as Awaited<
        ReturnType<typeof getVR2QueryResult>
      >,
    );
    const preview = await previewVrInstanceDelete('vr-a');
    expect(preview.hasSnapshot).toBe(true);
    expect(preview.conflicts.length).toBeGreaterThan(0);
    expect(preview.conflicts[0].message).toMatch(/vrrp/i);
  });

  it('reports hasSnapshot false when the ledger has no role-pre snapshot', async () => {
    const preview = await previewVrInstanceDelete('vr-a');
    expect(preview.hasSnapshot).toBe(false);
    expect(preview.binders).toEqual([]);
  });
});
