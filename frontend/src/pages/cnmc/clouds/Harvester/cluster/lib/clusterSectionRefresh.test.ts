import { message } from 'antd';
import { clearGetCacheForPath } from 'utils/requestManager';
import {
  createClusterToolbarRefresh,
  reloadHarvesterNamespacesList,
  runClusterSectionRefresh,
} from './clusterSectionRefresh';

jest.mock('antd', () => ({
  message: {
    warning: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('utils/requestManager', () => ({
  clearGetCacheForPath: jest.fn(),
}));

describe('clusterSectionRefresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('warns when onRefresh is missing', () => {
    runClusterSectionRefresh(undefined);
    expect(message.warning).toHaveBeenCalled();
  });

  it('calls onRefresh(true) by default', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    runClusterSectionRefresh(onRefresh);
    await Promise.resolve();
    expect(onRefresh).toHaveBeenCalledWith(true, undefined);
  });

  it('createClusterToolbarRefresh passes silent when set', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    const click = createClusterToolbarRefresh(onRefresh, { silent: true });
    click();
    await Promise.resolve();
    expect(onRefresh).toHaveBeenCalledWith(true, true);
  });

  it('runs before/after hooks', async () => {
    const order: string[] = [];
    const onRefresh = jest.fn().mockImplementation(async () => {
      order.push('refresh');
    });
    const click = createClusterToolbarRefresh(onRefresh, {
      before: () => order.push('before'),
      after: () => order.push('after'),
    });
    click();
    await Promise.resolve();
    expect(order).toEqual(['before', 'refresh', 'after']);
  });

  it('reloadHarvesterNamespacesList clears cache and refreshes silently', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    reloadHarvesterNamespacesList('cloud-1', onRefresh);
    await Promise.resolve();
    expect(clearGetCacheForPath).toHaveBeenCalledWith(
      '/api/clouds/cloud-1/resources/harvester/namespaces',
    );
    expect(onRefresh).toHaveBeenCalledWith(true, true);
  });
});
