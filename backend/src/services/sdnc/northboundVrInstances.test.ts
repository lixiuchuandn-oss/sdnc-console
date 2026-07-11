import { listVrInstancesByTenant } from '../../services/sdnc/northboundVrInstances';

jest.mock('../../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

jest.mock('../vrouter/vrController', () => ({
  vrController: {
    getVRList: jest.fn().mockResolvedValue({ page: [] }),
  },
}));

const { AppDataSource } = jest.requireMock('../../config/database') as {
  AppDataSource: { getRepository: jest.Mock };
};

describe('northboundVrInstances', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('listVrInstancesByTenant returns empty when tenantId missing', async () => {
    await expect(listVrInstancesByTenant({ tenantId: '' })).resolves.toEqual([]);
  });

  it('listVrInstancesByTenant maps vr_config rows', async () => {
    const find = jest.fn().mockResolvedValue([
      {
        uuid: 'vr-1',
        name: 'pe-01',
        tenantId: 't1',
        organizationId: 'o1',
        role: 'PE',
        bindStatus: 'bound',
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-02'),
      },
    ]);
    AppDataSource.getRepository.mockImplementation((entity: { name?: string }) => {
      if (entity?.name === 'vr_config' || String(entity).includes('VRConfig')) {
        return { find };
      }
      return { find: jest.fn().mockResolvedValue([]) };
    });

    const list = await listVrInstancesByTenant({ tenantId: 't1' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      uuid: 'vr-1',
      name: 'pe-01',
      tenant_id: 't1',
      organization_id: 'o1',
      role: 'PE',
      bind_status: 'bound',
    });
  });
});
