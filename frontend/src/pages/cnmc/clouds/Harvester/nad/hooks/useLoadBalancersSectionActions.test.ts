import { act, renderHook } from '@testing-library/react';
import { message } from 'antd';
import { deleteHarvesterService } from '../../../../../../services/harvesterApi';
import { runHarvesterSectionRefresh } from '../lib/nadSectionRefresh';
import { useLoadBalancersSectionActions } from './useLoadBalancersSectionActions';
import type { LoadBalancerListRow } from '../lib/loadBalancersSectionUtils';

const mockConfirm = jest.fn();

jest.mock('antd', () => ({
  Modal: {
    confirm: (opts: unknown) => mockConfirm(opts),
  },
  message: {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('../../../../../../services/harvesterApi', () => ({
  deleteHarvesterService: jest.fn(),
}));

jest.mock('../lib/nadSectionRefresh', () => ({
  runHarvesterSectionRefresh: jest.fn(),
}));

const row: LoadBalancerListRow = {
  key: 'uid-1',
  name: 'lb-a',
  namespace: 'proj-1',
  address: '10.0.0.1',
  ipam: 'pool',
  listeners: '80:8080/TCP',
  raw: {},
};

describe('useLoadBalancersSectionActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockReset();
  });

  it('handleDelete warns for tenant public namespace', () => {
    const { result } = renderHook(() =>
      useLoadBalancersSectionActions({
        cloudId: 'cloud-1',
        dataSource: [row],
        isTenant: true,
        isPublicNamespace: () => true,
      }),
    );

    act(() => {
      result.current.handleDelete(row);
    });

    expect(message.warning).toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('handleDelete refreshes after successful delete', async () => {
    const onRefresh = jest.fn();
    (deleteHarvesterService as jest.Mock).mockResolvedValue(undefined);
    mockConfirm.mockImplementation(({ onOk }: { onOk: () => Promise<void> }) => {
      void onOk();
    });

    const { result } = renderHook(() =>
      useLoadBalancersSectionActions({
        cloudId: 'cloud-1',
        dataSource: [row],
        isPublicNamespace: () => false,
        onRefresh,
      }),
    );

    await act(async () => {
      result.current.handleDelete(row);
      await Promise.resolve();
    });

    expect(deleteHarvesterService).toHaveBeenCalledWith('cloud-1', 'proj-1', 'lb-a');
    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onRefresh, { force: true });
  });

  it('handleCreateSuccess triggers silent refresh', () => {
    const onRefresh = jest.fn();
    const { result } = renderHook(() =>
      useLoadBalancersSectionActions({
        cloudId: 'cloud-1',
        dataSource: [row],
        isPublicNamespace: () => false,
        onRefresh,
      }),
    );

    act(() => {
      result.current.handleCreateSuccess();
    });

    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onRefresh, {
      force: true,
      silent: true,
    });
  });
});
