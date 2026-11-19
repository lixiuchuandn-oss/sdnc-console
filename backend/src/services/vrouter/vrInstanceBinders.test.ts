import { IbrHaGroup } from '../../entities/vRouter/IbrHaGroup';
import { IbrHaGroupMember } from '../../entities/vRouter/IbrHaGroupMember';
import { IPsecVPN } from '../../entities/vRouter/IPsecVPN';
import { findSrv6TunnelsReferencingVr } from '../../routes/sdn/srv6.references';
import { listVrInstanceBinders } from './vrInstanceBinders';

jest.mock('../../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

jest.mock('../../routes/sdn/srv6.references', () => ({
  findSrv6TunnelsReferencingVr: jest.fn(),
}));

const { AppDataSource } = jest.requireMock('../../config/database') as {
  AppDataSource: { getRepository: jest.Mock };
};

const findRefs = findSrv6TunnelsReferencingVr as jest.MockedFunction<typeof findSrv6TunnelsReferencingVr>;

describe('listVrInstanceBinders', () => {
  const memberFind = jest.fn();
  const groupFindOne = jest.fn();
  const ipsecFind = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    findRefs.mockResolvedValue([]);
    memberFind.mockResolvedValue([]);
    groupFindOne.mockResolvedValue(null);
    ipsecFind.mockResolvedValue([]);
    AppDataSource.getRepository.mockImplementation((entity: unknown) => {
      if (entity === IbrHaGroupMember) return { find: memberFind };
      if (entity === IbrHaGroup) return { findOne: groupFindOne };
      if (entity === IPsecVPN) return { find: ipsecFind };
      return {};
    });
  });

  it('lists SRv6 endpoint hits with tunnel names', async () => {
    findRefs.mockResolvedValue([{ tunnelId: 't1', tunnelName: 'hub-spoke', slot: 'peA' }]);
    const binders = await listVrInstanceBinders('vr-a');
    expect(binders).toEqual([
      expect.objectContaining({ type: 'srv6', id: 't1', name: 'hub-spoke', href: '/admin/interconnect/srv6' }),
    ]);
  });

  it('lists HA membership with group name', async () => {
    memberFind.mockResolvedValue([{ groupId: 'g1', role: 'primary', vrUuid: 'vr-a' }]);
    groupFindOne.mockResolvedValue({ id: 'g1', name: 'ce-ha' });
    const binders = await listVrInstanceBinders('vr-a');
    expect(binders).toEqual([
      expect.objectContaining({ type: 'ha', id: 'g1', name: 'ce-ha', href: '/admin/interconnect/ha-groups' }),
    ]);
  });

  it('lists IPsec local and peer endpoints', async () => {
    ipsecFind.mockResolvedValue([
      { id: 'i1', name: 'vpn-local', localVrId: 'vr-a', peerVrId: 'other' },
      { id: 'i2', name: 'vpn-peer', localVrId: 'other', peerVrId: 'vr-a' },
      { id: 'i3', name: 'vpn-skip', localVrId: 'x', peerVrId: 'y' },
    ]);
    const binders = await listVrInstanceBinders('vr-a');
    expect(binders.map((b) => b.name).sort()).toEqual(['vpn-local', 'vpn-peer']);
    expect(binders.every((b) => b.href.includes('/admin/interconnect/ipsec/'))).toBe(true);
  });

  it('returns empty when nothing binds the VR', async () => {
    await expect(listVrInstanceBinders('vr-a')).resolves.toEqual([]);
  });
});
