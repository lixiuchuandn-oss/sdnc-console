import { getVR2QueryResult } from './vrController';
import {
  captureRolePreSnapshotIfEmpty,
  shouldAttemptRolePreSnapshotCapture,
} from './rolePreSnapshot';

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

const okVr2 = (config: unknown) => ({
  config,
  csmBizError: null,
  transportError: null,
  csm_http_body_raw: config,
});

describe('shouldAttemptRolePreSnapshotCapture', () => {
  it('attempts only when snapshot and platform role are both empty', () => {
    expect(shouldAttemptRolePreSnapshotCapture(null)).toBe(true);
    expect(shouldAttemptRolePreSnapshotCapture({ role: null, rolePreSnapshot: null })).toBe(true);
    expect(shouldAttemptRolePreSnapshotCapture({ role: 'CE', rolePreSnapshot: null })).toBe(false);
    expect(
      shouldAttemptRolePreSnapshotCapture({
        role: null,
        rolePreSnapshot: '{"uuid":"x"}',
      }),
    ).toBe(false);
  });
});

describe('captureRolePreSnapshotIfEmpty', () => {
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
  });

  it('stores stripped VR2 when three conditions hold', async () => {
    getVR2.mockResolvedValue(
      okVr2({
        uuid: 'vr-a',
        report_config_status: 'applied',
        createDate: '2026-01-01',
        interfaces: [{ name: 'ge0', ipv4: '10.0.0.1/24', tags: ['device_baseline'] }],
      }) as Awaited<ReturnType<typeof getVR2QueryResult>>,
    );

    const result = await captureRolePreSnapshotIfEmpty('vr-a');
    expect(result).toBe('captured');
    const stored = JSON.parse(String(rows.get('vr-a')?.rolePreSnapshot));
    expect(stored.interfaces[0].name).toBe('ge0');
    expect(stored.role).toBeUndefined();
    expect(stored.report_config_status).toBeUndefined();
    expect(stored.createDate).toBeUndefined();
  });

  it('does not overwrite an existing snapshot on later upsert-shaped captures', async () => {
    rows.set('vr-a', {
      uuid: 'vr-a',
      role: null,
      rolePreSnapshot: '{"interfaces":[{"name":"ge0"}]}',
      config_json: '{}',
    });
    const result = await captureRolePreSnapshotIfEmpty('vr-a');
    expect(result).toBe('skipped');
    expect(getVR2).not.toHaveBeenCalled();
    expect(JSON.parse(String(rows.get('vr-a')?.rolePreSnapshot)).interfaces[0].name).toBe('ge0');
  });

  it('does not backfill when platform role already exists', async () => {
    rows.set('vr-a', { uuid: 'vr-a', role: 'SPOKE_PE', rolePreSnapshot: null, config_json: '{}' });
    const result = await captureRolePreSnapshotIfEmpty('vr-a');
    expect(result).toBe('skipped');
    expect(getVR2).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('does not backfill when VR2 already has a role', async () => {
    getVR2.mockResolvedValue(
      okVr2({ role: 'CE', interfaces: [{ name: 'ge0' }] }) as Awaited<
        ReturnType<typeof getVR2QueryResult>
      >,
    );
    const result = await captureRolePreSnapshotIfEmpty('vr-a');
    expect(result).toBe('skipped');
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects empty VR2 instead of storing {}', async () => {
    getVR2.mockResolvedValue(
      okVr2({ report_config_status: 'applied', createDate: 'x' }) as Awaited<
        ReturnType<typeof getVR2QueryResult>
      >,
    );
    await expect(captureRolePreSnapshotIfEmpty('vr-a')).rejects.toMatchObject({ statusCode: 503 });
    expect(save).not.toHaveBeenCalled();
  });

  it('does not write when GET fails and capture was required', async () => {
    getVR2.mockResolvedValue({
      config: null,
      csmBizError: null,
      transportError: 'ECONNREFUSED',
      csm_http_body_raw: null,
    } as Awaited<ReturnType<typeof getVR2QueryResult>>);
    await expect(captureRolePreSnapshotIfEmpty('vr-a')).rejects.toMatchObject({ statusCode: 503 });
    expect(save).not.toHaveBeenCalled();
  });
});
