import { pushVRConfig } from './vrConfigDeploy';
import { vrController } from './vrController';

jest.mock('../../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

jest.mock('./vrController', () => ({
  vrController: {
    getVRConfig: jest.fn(),
    updateVRConfig: jest.fn(),
  },
}));

const { AppDataSource } = jest.requireMock('../../config/database') as {
  AppDataSource: { getRepository: jest.Mock };
};

const updateVRConfig = vrController.updateVRConfig as jest.Mock;

describe('pushVRConfig persistPlatform', () => {
  const save = jest.fn(async (row: { config_json: string }) => row);

  beforeEach(() => {
    jest.clearAllMocks();
    save.mockClear();
    AppDataSource.getRepository.mockReturnValue({
      findOne: jest.fn(async () => ({ uuid: 'vr-a', config_json: '{"bgp":[]}' })),
      save,
    });
    updateVRConfig.mockResolvedValue({ status: 200, headers: {}, data: { code: 200 } });
  });

  it('does not write config_json when persistPlatform is false', async () => {
    const merged = { bgp: [{ asn: 1 }], vrrp: [] };
    const result = await pushVRConfig({
      vrId: 'vr-a',
      domain: 'vrrp',
      preMergedConfig: merged,
      skipDriftCheck: true,
      persistPlatform: false,
    });
    expect(updateVRConfig).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(result.mergedConfig).toEqual(merged);
  });

  it('writes config_json after the device accepts by default', async () => {
    await pushVRConfig({
      vrId: 'vr-a',
      domain: 'vrrp',
      preMergedConfig: { bgp: [{ asn: 1 }] },
      skipDriftCheck: true,
    });
    expect(updateVRConfig).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].config_json).toContain('"asn":1');
  });
});
