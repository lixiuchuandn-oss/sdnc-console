import { act, renderHook } from '@testing-library/react';
import { fetchKubeOvnSubnets } from '../../../../../../services/harvesterApi';
import { useNadsOvnSubnets } from './useNadsOvnSubnets';

jest.mock('../../../../../../services/harvesterApi', () => ({
  fetchKubeOvnSubnets: jest.fn(),
}));

describe('useNadsOvnSubnets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips fetch without cloudId', async () => {
    const { result } = renderHook(() => useNadsOvnSubnets(undefined));

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchKubeOvnSubnets).not.toHaveBeenCalled();
    expect(result.current.ovnSubnets).toEqual([]);
    expect(result.current.subnetByNameLc.size).toBe(0);
  });

  it('loads subnets on mount and builds subnetByNameLc', async () => {
    (fetchKubeOvnSubnets as jest.Mock).mockResolvedValue({
      data: { items: [{ metadata: { name: 'net-a' } }, { metadata: { name: 'net-b' } }] },
    });

    const { result } = renderHook(() => useNadsOvnSubnets('cloud-1'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchKubeOvnSubnets).toHaveBeenCalledWith('cloud-1', false);
    expect(result.current.ovnSubnets).toHaveLength(2);
    expect(result.current.subnetByNameLc.get('net-a')).toBeDefined();
    expect(result.current.ovnSubnetsLoading).toBe(false);
  });

  it('loadOvnSubnets(true) passes force flag', async () => {
    (fetchKubeOvnSubnets as jest.Mock).mockResolvedValue({ items: [] });

    const { result } = renderHook(() => useNadsOvnSubnets('cloud-1'));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.loadOvnSubnets(true);
    });

    expect(fetchKubeOvnSubnets).toHaveBeenLastCalledWith('cloud-1', true);
  });

  it('clears subnets when fetch fails', async () => {
    (fetchKubeOvnSubnets as jest.Mock).mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useNadsOvnSubnets('cloud-1'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.ovnSubnets).toEqual([]);
    expect(result.current.ovnSubnetsLoading).toBe(false);
  });
});
