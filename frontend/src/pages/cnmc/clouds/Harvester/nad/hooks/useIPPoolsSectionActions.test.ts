import { act, renderHook } from '@testing-library/react';
import { deleteHarvesterIpPool } from '../../../../../../services/harvesterApi';
import { runHarvesterSectionRefresh } from '../lib/nadSectionRefresh';
import { useIPPoolsSectionActions } from './useIPPoolsSectionActions';
import type { IPPoolListRow } from '../lib/ippoolsSectionUtils';

const mockConfirm = jest.fn();
const mockError = jest.fn();

jest.mock('antd', () => ({
  Modal: {
    confirm: (opts: unknown) => mockConfirm(opts),
    error: (opts: unknown) => mockError(opts),
  },
  message: {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('../../../../../../services/harvesterApi', () => ({
  deleteHarvesterIpPool: jest.fn(),
}));

jest.mock('../lib/nadSectionRefresh', () => ({
  runHarvesterSectionRefresh: jest.fn(),
}));

const row: IPPoolListRow = {
  key: 'uid-1',
  name: 'pool-a',
  namespace: 'proj-1',
  ranges: '10.0.0.1-10.0.0.10',
  network: 'net-a',
  selector: '-',
  raw: {},
};

describe('useIPPoolsSectionActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockReset();
    mockError.mockReset();
  });

  it('handleDelete shows blocked modal when IP still allocated', async () => {
    (deleteHarvesterIpPool as jest.Mock).mockRejectedValue(
      new Error("can't delete pool before releasing all the allocated IP"),
    );
    mockConfirm.mockImplementation(({ onOk }: { onOk: () => Promise<void> }) => {
      void onOk();
    });

    const { result } = renderHook(() =>
      useIPPoolsSectionActions({
        cloudId: 'cloud-1',
        dataSource: [row],
        isPublicNamespace: () => false,
      }),
    );

    await act(async () => {
      result.current.handleDelete(row);
      await Promise.resolve();
    });

    expect(mockError).toHaveBeenCalled();
    expect(runHarvesterSectionRefresh).not.toHaveBeenCalled();
  });

  it('handleCreateSuccess triggers silent refresh', () => {
    const onRefresh = jest.fn();
    const { result } = renderHook(() =>
      useIPPoolsSectionActions({
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
