/**
 * 云资源池列表页状态与副作用（视图：`sections/PoolsListWorkspace.tsx`）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  Badge,
  Button,
  Dropdown,
  Form,
  Input,
  MenuProps,
  message,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EllipsisOutlined } from '@ant-design/icons';

import { useAuth } from '../../../../contexts/AuthContext';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import {
  apiDelete,
  apiPost,
  apiRequest,
  fetchCloudProviderVpcs,
  fetchClouds as fetchCloudsApi,
} from '../../../../services/api';
import { fetchKubeOvnVpcs } from '../../../../services/harvesterApi';
import { getSystemSetting, updateSystemSetting } from '../../../../services/systemApi';
import type { AdminLayoutOutletContext } from '../../../../layouts/admin/adminLayoutOutletContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import { filterMenuItemsForReadOnly } from '../../../../utils/rbacUi';
import { isMustChangePasswordApiError } from '../../../../utils/errorHandler';

import {
  CLOUD_STATUS_MAP,
  CLOUD_TYPE_MAP,
  resolvePoolTypeLabel,
  type Cloud,
  type CloudProvider,
  cloudProviders,
  getProviderLogo,
  getProviderName,
  isCsmCloud,
} from '../lib/poolProviders';
import { CloudsFilterFormValues, matchesPoolVendor, readCloudApiErr } from '../lib/poolsListUtils';
import { navigateToPoolDetail } from '../lib/poolDetailNav';

const { Text } = Typography;

export function usePoolsListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const perms = user && Array.isArray(user.permissions) ? user.permissions : [];
  const canWriteClouds = hasPermissionForAction(perms, 'clouds.resource-pools:write');
  const canSetDefaultPool = canWriteClouds;

  const [filterForm] = Form.useForm();
  const [clouds, setClouds] = useState<Cloud[]>([]);
  const [wizardVisible, setWizardVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingCloud, setEditingCloud] = useState<Cloud | null>(null);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [vmStats, setVmStats] = useState<{ total: number; online: number; offline: number }>({
    total: 0,
    online: 0,
    offline: 0,
  });
  const [vpcStats, setVpcStats] = useState<{ total: number; online: number; offline: number }>({
    total: 0,
    online: 0,
    offline: 0,
  });

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[] | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string[] | undefined>(undefined);
  const [vendorFilter, setVendorFilter] = useState<string | undefined>(undefined);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [favoriteCloudId, setFavoriteCloudId] = useState<string>('');

  const skipNextCloudsFetchCacheRef = useRef(false);

  const reloadSummaryClouds =
    (useOutletContext<Partial<AdminLayoutOutletContext>>() || {}).reloadSummaryClouds;

  const fetchClouds = useCallback(async (skipCache: boolean = false) => {
    try {
      const response = skipCache
        ? await apiRequest('/api/clouds', { skipCache: true })
        : await fetchCloudsApi();
      setClouds(Array.isArray(response) ? response : response?.data || []);
    } catch (error: unknown) {
      if (isMustChangePasswordApiError(error)) {
        skipNextCloudsFetchCacheRef.current = true;
        return;
      }
      const e = error as { responseData?: { message?: string }; message?: string };
      message.error('获取云资源列表失败：' + (e?.responseData?.message || e?.message || '未知错误'));
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    if (user.mustChangePassword) {
      skipNextCloudsFetchCacheRef.current = true;
      return;
    }
    const skipCache = skipNextCloudsFetchCacheRef.current;
    skipNextCloudsFetchCacheRef.current = false;
    void fetchClouds(skipCache);
  }, [fetchClouds, user?.id, user?.mustChangePassword]);

  useEffect(() => {
    void (async () => {
      try {
        const fav = await getSystemSetting('favorite.cloudId');
        setFavoriteCloudId(String(fav?.value || '').trim());
      } catch {
        setFavoriteCloudId('');
      }
    })();
  }, []);

  useEffect(() => {
    let total = 0;
    let online = 0;
    (clouds || [])
      .filter((c: Cloud) => !isCsmCloud(c))
      .forEach((c: Cloud & { vmCount?: number; runningVmCount?: number }) => {
        total += Number(c.vmCount || 0);
        online += Number(c.runningVmCount || 0);
      });
    setVmStats({ total, online, offline: Math.max(0, total - online) });
  }, [clouds]);

  useEffect(() => {
    const loadVpcStats = async () => {
      try {
        const ids = (clouds || []).filter((c) => !isCsmCloud(c)).map((c) => c.id);
        const results = await Promise.allSettled(
          ids.map(async (id) => {
            try {
              const prov = String(clouds.find((c) => c.id === id)?.config?.provider || '').toLowerCase();
              if (prov === 'harvester' || prov.startsWith('cloudmap')) {
                const json: unknown = await fetchKubeOvnVpcs(id);
                const j = json as { data?: { items?: unknown[] }; items?: unknown[] };
                const list: unknown[] = Array.isArray(j?.data?.items)
                  ? j.data!.items!
                  : Array.isArray(j?.items)
                    ? j.items!
                    : [];
                return Array.isArray(list) ? list : [];
              }
              const json: unknown = await fetchCloudProviderVpcs(id);
              const j = json as { data?: { Vpcs?: { Vpc?: unknown[] }; vpcs?: unknown[] }; vpcs?: unknown[] };
              const list: unknown[] = j?.data?.Vpcs?.Vpc || j?.data?.vpcs || j?.vpcs || [];
              return Array.isArray(list) ? list : [];
            } catch (e) {
              console.warn(`Failed to load VPC stats for cloud ${id}:`, e);
              return [];
            }
          }),
        );
        const flat = results
          .filter((r): r is PromiseFulfilledResult<unknown[]> => r.status === 'fulfilled')
          .flatMap((r) => r.value);
        const total = flat.length;
        const online = flat.filter((r) => {
          const row = r as { Status?: unknown; status?: unknown };
          const s = row?.Status ?? row?.status;
          if (s && typeof s === 'object') return true;
          const str = String(s || '').toLowerCase();
          return ['available', 'active', 'ok', 'running', 'enabled', 'ready'].includes(str);
        }).length;
        setVpcStats({ total, online, offline: Math.max(0, total - online) });
      } catch {
        setVpcStats({ total: 0, online: 0, offline: 0 });
      }
    };
    if (clouds.length > 0) void loadVpcStats();
  }, [clouds]);

  const testConnection = useCallback(
    async (cloudId: string) => {
      if (!canWriteClouds) {
        message.error('权限不足：需要资源池写入权限（clouds.resource-pools:write 或 clouds:write）');
        return;
      }
      setTestingConnection(cloudId);
      try {
        const response = await apiPost(`/api/clouds/${cloudId}/test`, {});
        message.success((response as { message?: string }).message || '连接测试成功');
        await fetchClouds(true);
        reloadSummaryClouds?.();
      } catch (error: unknown) {
        message.error('连接测试失败：' + readCloudApiErr(error));
      } finally {
        setTestingConnection(null);
      }
    },
    [canWriteClouds, fetchClouds, reloadSummaryClouds],
  );

  const getStatusText = (status: string) => CLOUD_STATUS_MAP[status] || '未知';
  const getTypeText = (type: string) => resolvePoolTypeLabel(type);

  const handleEdit = useCallback(
    (cloud: Cloud) => {
      if (!canWriteClouds) {
        message.error('权限不足：需要资源池写入权限（clouds.resource-pools:write 或 clouds:write）');
        return;
      }
      setEditingCloud(cloud);
      setEditModalVisible(true);
    },
    [canWriteClouds],
  );

  const handleDelete = useCallback(
    (cloudId: string) => {
      if (!canWriteClouds) {
        message.error('权限不足：需要资源池写入权限（clouds.resource-pools:write 或 clouds:write）');
        return;
      }

      Modal.confirm({
        title: '确认删除',
        content: '确定要删除这个云资源吗？如果有关联的计算资源，将无法删除。',
        okText: '确定',
        cancelText: '取消',
        onOk: async () => {
          try {
            await apiDelete(`/api/clouds/${cloudId}`);
            message.success('云资源删除成功');
            await fetchClouds(true);
            reloadSummaryClouds?.();
          } catch (error: unknown) {
            message.error('删除失败：' + readCloudApiErr(error));
          }
        },
      });
    },
    [canWriteClouds, fetchClouds, reloadSummaryClouds],
  );

  const tableColumns: ColumnsType<Cloud> = useMemo(
    () => [
      {
        title: '云平台',
        dataIndex: 'name',
        key: 'name',
        width: 220,
        fixed: 'left',
        render: (_text: string, record: Cloud) => (
          <Space size={6}>
            <Button
              type="link"
              onClick={() => navigateToPoolDetail(navigate, record as unknown as Record<string, any>)}
              style={{ padding: 0, height: 'auto' }}
            >
              {record.name}
            </Button>
            {favoriteCloudId && String(record.id) === String(favoriteCloudId) && (
              <Tag bordered={false} color="gold" style={{ marginInlineEnd: 0 }}>
                默认
              </Tag>
            )}
          </Space>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        render: (status: string) => (
          <Badge
            status={status === 'online' ? 'success' : status === 'offline' ? 'error' : 'warning'}
            text={getStatusText(status)}
          />
        ),
      },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        render: (type: string) => <Tag color="blue">{getTypeText(type)}</Tag>,
      },
      {
        title: '厂商',
        dataIndex: 'config',
        key: 'provider',
        render: (config: Cloud['config'] | undefined, record: Cloud) => {
          const providerName = getProviderName(config?.provider);
          const logo = getProviderLogo(config?.provider, record.type);
          return (
            <Space>
              <span style={{ fontSize: 16, display: 'flex', alignItems: 'center' }}>{logo}</span>
              <Text>{providerName}</Text>
            </Space>
          );
        },
      },
      {
        title: '地域',
        dataIndex: 'region',
        key: 'region',
        render: (region: string) => <Text>{region || '-'}</Text>,
      },
      {
        title: '端点',
        dataIndex: 'endpoint',
        key: 'endpoint',
        render: (endpoint: string) => <Text type="secondary">{endpoint || '-'}</Text>,
      },
      {
        title: '操作',
        key: 'actions',
        width: 80,
        fixed: 'right',
        align: 'center',
        render: (_: unknown, record: Cloud) => {
          const isFavorite = !!favoriteCloudId && String(record.id) === String(favoriteCloudId);
          const items = filterMenuItemsForReadOnly(
            [
              { key: 'detail', label: '资源详情' },
              { key: 'edit', label: '编辑信息' },
              {
                key: 'test',
                label: '连接测试',
                disabled: testingConnection === record.id,
              },
              ...(canSetDefaultPool
                ? [
                    {
                      key: 'setFavorite',
                      label: '设为默认资源池',
                      disabled: isFavorite,
                    },
                    {
                      key: 'unsetFavorite',
                      label: '取消默认资源池',
                      disabled: !isFavorite,
                    },
                  ]
                : []),
              { type: 'divider' as const },
              { key: 'del', label: '删除', danger: true },
            ],
            canWriteClouds,
          );
          const onMenuClick = ({ key }: { key: string }) => {
            if (key === 'test') return void testConnection(record.id);
            if (key === 'detail') return void navigateToPoolDetail(navigate, record as unknown as Record<string, any>);
            if (key === 'edit') return void handleEdit(record);
            if (key === 'setFavorite') {
              void (async () => {
                try {
                  await updateSystemSetting('favorite.cloudId', record.id);
                  setFavoriteCloudId(String(record.id));
                  message.success('已设为默认资源池');
                } catch {
                  message.error('设置失败');
                }
              })();
              return;
            }
            if (key === 'unsetFavorite') {
              void (async () => {
                try {
                  await updateSystemSetting('favorite.cloudId', '');
                  setFavoriteCloudId('');
                  message.success('已取消默认资源池');
                } catch {
                  message.error('取消失败');
                }
              })();
              return;
            }
            if (key === 'del') return void handleDelete(record.id);
          };
          return (
            <Dropdown menu={{ items, onClick: onMenuClick }} trigger={['click']}>
              <Button type="text" icon={<EllipsisOutlined />} className="row-actions-trigger" />
            </Dropdown>
          );
        },
      },
    ],
    [
      navigate,
      canWriteClouds,
      canSetDefaultPool,
      favoriteCloudId,
      testingConnection,
      testConnection,
      handleEdit,
      handleDelete,
    ],
  );

  const { displayColumns: activeColumns } = useTableColumnSettings(tableColumns, 'clouds-list');

  const filteredClouds = useMemo(() => {
    const filtered = (clouds || []).filter((c) => {
      if (isCsmCloud(c)) return false;
      if (keyword && !c.name.toLowerCase().includes(keyword.toLowerCase())) return false;
      if (statusFilter?.length && !statusFilter.includes(c.status)) return false;
      if (typeFilter?.length && !typeFilter.includes(c.type)) return false;
      if (vendorFilter) {
        if (!matchesPoolVendor(c.config?.provider as string | undefined, vendorFilter)) return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      const ta = Date.parse(String(a.createdAt || '')) || 0;
      const tb = Date.parse(String(b.createdAt || '')) || 0;
      return tb - ta;
    });
  }, [clouds, keyword, statusFilter, typeFilter, vendorFilter]);

  const { totalCnt, onlineCnt, offlineCnt, containerCounts, vmCounts, vpcCounts } = useMemo(() => {
    const cnmcClouds = (clouds || []).filter((c) => !isCsmCloud(c));
    const total = cnmcClouds.length;
    const online = cnmcClouds.filter((c) => c.status === 'online').length;
    const offline = total - online;
    const all = cnmcClouds.flatMap((c) => c.computeResources || []);
    const containerList = all.filter((r) => r.type === 'container');
    const cTotal = containerList.length;
    const cOnline = containerList.filter((r) => String(r?.status || '').toLowerCase() === 'running').length;
    return {
      totalCnt: total,
      onlineCnt: online,
      offlineCnt: offline,
      containerCounts: {
        total: cTotal,
        online: cOnline,
        offline: Math.max(0, cTotal - cOnline),
      },
      vmCounts: vmStats,
      vpcCounts: vpcStats,
    };
  }, [clouds, vmStats, vpcStats]);

  const handleFilterChange = (_changed: Partial<CloudsFilterFormValues>, all: CloudsFilterFormValues) => {
    setKeyword(all.keyword || '');
    setStatusFilter(all.status ? [all.status] : undefined);
    setTypeFilter(all.category ? [all.category] : undefined);
    setVendorFilter(all.vendor || undefined);
  };

  const resetToolbarFilters = useCallback(() => {
    filterForm.resetFields();
    setKeyword('');
    setStatusFilter(undefined);
    setTypeFilter(undefined);
    setVendorFilter(undefined);
  }, [filterForm]);

  const handleBulkDelete = useCallback(async () => {
    if (!canWriteClouds) {
      message.error('权限不足：需要资源池写入权限（clouds.resource-pools:write 或 clouds:write）');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `将删除选中的 ${selectedRowKeys.length} 个资源池，操作不可恢复。`,
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        let ok = 0;
        let fail = 0;
        const failures: string[] = [];
        for (const id of selectedRowKeys) {
          try {
            await apiDelete(`/api/clouds/${id}`);
            ok++;
          } catch (e: unknown) {
            fail++;
            const name = clouds.find((c) => c.id === id)?.name || id;
            failures.push(`${name}：${readCloudApiErr(e)}`);
          }
        }
        setSelectedRowKeys([]);
        await fetchClouds(true);
        reloadSummaryClouds?.();

        if (ok > 0 && fail === 0) {
          message.success(`已删除 ${ok} 个资源池`);
          return;
        }
        if (ok > 0 && fail > 0) {
          message.warning(`已删除 ${ok} 个资源池；${fail} 个未能删除`);
        }
        if (fail > 0) {
          Modal.error({
            title: ok === 0 ? '批量删除失败' : '部分删除失败',
            width: 560,
            content: (
              <div style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                {failures.join('\n')}
              </div>
            ),
          });
        }
      },
    });
  }, [canWriteClouds, selectedRowKeys, fetchClouds, clouds, reloadSummaryClouds]);

  const bulkActionsMenu: MenuProps = {
    items: filterMenuItemsForReadOnly(
      [
        {
          key: 'bulkDelete',
          label: '批量删除',
          danger: true,
          disabled: selectedRowKeys.length === 0,
          onClick: handleBulkDelete,
        },
      ],
      canWriteClouds,
    ),
  };

  const refreshList = useCallback(() => {
    void fetchClouds(true);
    reloadSummaryClouds?.();
  }, [fetchClouds, reloadSummaryClouds]);

  return {
    canWriteClouds,
    filterForm,
    handleFilterChange,
    resetToolbarFilters,
    bulkActionsMenu,
    fetchClouds,
    reloadSummaryClouds,
    refreshList,
    totalCnt,
    onlineCnt,
    offlineCnt,
    containerCounts,
    vmCounts,
    vpcCounts,
    wizardVisible,
    setWizardVisible,
    editModalVisible,
    setEditModalVisible,
    editingCloud,
    setEditingCloud,
    activeColumns,
    filteredClouds,
    selectedRowKeys,
    setSelectedRowKeys,
    tableColumns,
    CLOUD_STATUS_MAP,
    CLOUD_TYPE_MAP,
    cloudProviders,
  };
}
