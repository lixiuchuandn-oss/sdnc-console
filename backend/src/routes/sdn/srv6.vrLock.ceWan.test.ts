import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { assertSrv6VrConfigUpsertAllowed, ceWanNameFromConfig } from './srv6.vrLock';

jest.mock('../../config/database', () => ({
  AppDataSource: { getRepository: jest.fn() },
}));
jest.mock('./srv6.references', () => ({
  findSrv6TunnelsReferencingVr: jest.fn(),
}));

const { AppDataSource } = jest.requireMock('../../config/database') as {
  AppDataSource: { getRepository: jest.Mock };
};
const { findSrv6TunnelsReferencingVr } = jest.requireMock('./srv6.references') as {
  findSrv6TunnelsReferencingVr: jest.Mock;
};

const ceCfg = (wanName: string) => ({
  role: 'CE',
  ce: { publicConfig: { wanName, wanIpv4: '23.1.1.3/24' }, lanConfig: [] },
});

const setup = (savedWan: string) => {
  findSrv6TunnelsReferencingVr.mockResolvedValue([
    { tunnelId: 't1', tunnelName: 'test-20261113-1', slot: 'ceA' },
  ]);
  AppDataSource.getRepository.mockImplementation((entity: unknown) => {
    if (entity === SRv6Tunnel) return { findOne: jest.fn().mockResolvedValue({ id: 't1', name: 'test-20261113-1' }) };
    if (entity === VRConfig) {
      return {
        findOne: jest.fn().mockResolvedValue({ uuid: 'ce-1', role: 'CE', config_json: JSON.stringify(ceCfg(savedWan)) }),
      };
    }
    return { findOne: jest.fn().mockResolvedValue(null) };
  });
};

const errMsg = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return String((e as Error).message);
  }
};

describe('srv6.vrLock · CE WAN 口拦截', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ceWanNameFromConfig 读取 publicConfig.wanName / wanDev / ce.wanDev', () => {
    expect(ceWanNameFromConfig(ceCfg(' ge0 '))).toBe('ge0');
    expect(ceWanNameFromConfig({ ce: { publicConfig: { wanDev: 'ge1' } } })).toBe('ge1');
    expect(ceWanNameFromConfig({ ce: { wanDev: 'ge2' } })).toBe('ge2');
    expect(ceWanNameFromConfig(null)).toBe('');
  });

  it('被引用 CE 改 WAN 口 → 409 且提示 WAN 接口不可修改', async () => {
    setup('GigabitEthernet 0/7/0');
    const p = assertSrv6VrConfigUpsertAllowed('ce-1', JSON.stringify(ceCfg('GigabitEthernet 0/9/0')));
    await expect(p).rejects.toMatchObject({ statusCode: 409 });
    const msg = await errMsg(
      assertSrv6VrConfigUpsertAllowed('ce-1', JSON.stringify(ceCfg('GigabitEthernet 0/9/0'))),
    );
    expect(msg).toContain('CE WAN 接口不可修改');
    expect(msg).toContain('GigabitEthernet 0/7/0 → GigabitEthernet 0/9/0');
  });

  it('被引用 CE 清空 WAN 口也拦', async () => {
    setup('GigabitEthernet 0/7/0');
    const msg = await errMsg(assertSrv6VrConfigUpsertAllowed('ce-1', JSON.stringify(ceCfg(''))));
    expect(msg).toContain('CE WAN 接口不可修改');
  });

  it('口名仅空格差异不算修改', async () => {
    setup('GigabitEthernet 0/7/0');
    const msg = await errMsg(assertSrv6VrConfigUpsertAllowed('ce-1', JSON.stringify(ceCfg('GigabitEthernet0/7/0'))));
    expect(msg).not.toContain('CE WAN 接口不可修改');
  });

  it('未被隧道引用不拦', async () => {
    findSrv6TunnelsReferencingVr.mockResolvedValue([]);
    await expect(
      assertSrv6VrConfigUpsertAllowed('ce-1', JSON.stringify(ceCfg('GigabitEthernet 0/9/0'))),
    ).resolves.toBeUndefined();
  });
});
