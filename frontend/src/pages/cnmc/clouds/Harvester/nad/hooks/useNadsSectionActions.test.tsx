import { act, renderHook } from '@testing-library/react';
import { deleteHarvesterNad } from '../../../../../../services/harvesterApi';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import { runHarvesterSectionRefresh } from '../lib/nadSectionRefresh';
import { useNadsSectionActions } from './useNadsSectionActions';
import type { ProcessedNadRecord } from '../lib/nadsSectionUtils';

jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('../../shared/lib/highRiskConfirm', () => ({
  confirmHighRiskDelete: (opts: { onConfirm: () => void | Promise<void> }) =>
    Promise.resolve().then(() => opts.onConfirm()),
  confirmHighRiskOperation: (opts: { onConfirm: () => void | Promise<void> }) =>
    Promise.resolve().then(() => opts.onConfirm()),
  DELETE_NETWORK_RISK_ITEMS: [],
}));

jest.mock('../../../../../../services/harvesterApi', () => ({
  deleteHarvesterNad: jest.fn(),
}));

jest.mock('../../../../../../services/api', () => ({
  fetchCloudProviderEcs: jest.fn(),
}));

jest.mock('../lib/nadSectionRefresh', () => ({
  runHarvesterSectionRefresh: jest.fn(),
}));

const record = {
  _name: 'net-a',
  _namespace: 'proj-1',
  metadata: { uid: 'uid-1' },
} as ProcessedNadRecord;

describe('useNadsSectionActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchCloudProviderEcs as jest.Mock).mockResolvedValue({ data: [] });
  });

  it('handleDelete respects ensureNadsWrite', async () => {
    const { result } = renderHook(() =>
      useNadsSectionActions({
        cloudId: 'cloud-1',
        hasNadsWrite: false,
        ensureNadsWrite: () => false,
        isPublicNamespace: () => false,
        loadOvnSubnets: async () => [],
        filteredData: [record],
      }),
    );

    await act(async () => {
      await result.current.handleDelete(record);
    });

  });

  it('handleDelete refreshes after successful delete', async () => {
    const onRefresh = jest.fn();
    (deleteHarvesterNad as jest.Mock).mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useNadsSectionActions({
        cloudId: 'cloud-1',
        hasNadsWrite: true,
        ensureNadsWrite: () => true,
        isPublicNamespace: () => false,
        loadOvnSubnets: async () => [],
        filteredData: [record],
        onRefresh,
      }),
    );

    await act(async () => {
      await result.current.handleDelete(record);
      await Promise.resolve();
    });

    expect(deleteHarvesterNad).toHaveBeenCalledWith('cloud-1', 'proj-1', 'net-a');
    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onRefresh, { force: true });
  });

  it('openNadYamlDrawer sets view link', () => {
    const { result } = renderHook(() =>
      useNadsSectionActions({
        cloudId: 'cloud-1',
        hasNadsWrite: true,
        ensureNadsWrite: () => true,
        isPublicNamespace: () => false,
        loadOvnSubnets: async () => [],
        filteredData: [record],
      }),
    );

    act(() => {
      result.current.openNadYamlDrawer(record);
    });

    expect(result.current.nadYamlDrawerOpen).toBe(true);
    expect(result.current.nadYamlViewLink).toContain('network-attachment-definitions/net-a');
  });

  it('handleCreateSuccess closes modal and silent refresh', () => {
    const onRefresh = jest.fn();
    const { result } = renderHook(() =>
      useNadsSectionActions({
        cloudId: 'cloud-1',
        hasNadsWrite: true,
        ensureNadsWrite: () => true,
        isPublicNamespace: () => false,
        loadOvnSubnets: async () => [],
        filteredData: [record],
        onRefresh,
      }),
    );

    act(() => {
      result.current.setCreateVisible(true);
      result.current.handleCreateSuccess();
    });

    expect(result.current.createVisible).toBe(false);
    expect(runHarvesterSectionRefresh).toHaveBeenCalledWith(onRefresh, {
      force: true,
      silent: true,
    });
  });
});
