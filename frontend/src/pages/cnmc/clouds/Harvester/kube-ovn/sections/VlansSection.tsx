import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Select, Table, Tag, Tooltip, message } from 'antd';
import { ReloadOutlined, TagTwoTone, SearchOutlined } from '@ant-design/icons';
import { deleteKubeOvnVlan,
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
} from '../../../../../../services/harvesterApi';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { clearCache } from '../../../../../../utils/requestManager';
import ProviderNetworkVlanPlanDrawer from '../drawers/provider-network-vlan-plan-drawer';
import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../../utils/towerKubeOvnNames';
import { useCloudmapOpsViewWrite } from '../../hooks/useCloudmapOpsViewWrite';

const { Option } = Select;

type Props = {
  cloudId: string;
  /** 父级注入时与 loadTabResource 对齐，不再在子组件内首发 GET */
  vlans?: any[];
  /** 父级已拉取的物理网络（provider-networks），用于筛选下拉；传入后不再单独请求 */
  providerNetworks?: any[];
  loading?: boolean;
  onRefresh?: (force?: boolean, skipSync?: boolean) => void | Promise<void>;
};

const VlansSection: React.FC<Props> = ({ cloudId, vlans, providerNetworks, loading: loadingProp, onRefresh }) => {
  const hasOpsView = useCloudmapOpsViewWrite();
  const { user } = useAuth();
  const canWriteVlan = hasPermissionForAction(user?.permissions || [], 'clouds.vlans:write');
  const isStandardView = !hasOpsView;
  const isControlled = typeof onRefresh === 'function';
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [vlanPlanOpen, setVlanPlanOpen] = useState(false);
  const [providers, setProviders] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [providerFilter, setProviderFilter] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState('detail');

  const listData = isControlled ? (vlans ?? []) : data;
  const tableLoading = isControlled ? (loadingProp ?? false) : loading;

  const fetchDataInternal = useCallback(
    async (force = false, skipSync = false) => {
      setLoading(true);
      try {
        const res = await fetchKubeOvnVlans(cloudId, force, skipSync);
        setData(Array.isArray(res?.data?.items) ? res.data.items : []);
        if (force && cloudId) {
          clearCache(`/api/clouds/${cloudId}/resources/vlans`, 'GET');
        }
      } catch (error: any) {
        message.error(`获取 VLAN 列表失败: ${error.message}`);
      } finally {
        setLoading(false);
      }
    },
    [cloudId],
  );

  const fetchData = useCallback(
    async (force = false, skipSync = false) => {
      if (isControlled && onRefresh) {
        await onRefresh(force, skipSync);
        return;
      }
      await fetchDataInternal(force, skipSync);
    },
    [isControlled, onRefresh, fetchDataInternal],
  );

  const fetchProviderOptions = async () => {
    try {
      const res = await fetchKubeOvnProviderNetworks(cloudId);
      setProviders(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch {}
  };

  const providerAliasMap = useMemo(() => {
    const map = new Map<string, { display: string; alias: string }>();
    (providers || []).forEach((p: any) => {
      const name = String(p?.metadata?.name ?? '').trim();
      if (!name) return;
      const ann = p?.metadata?.annotations || {};
      const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
      map.set(name, { display: alias || name, alias });
    });
    return map;
  }, [providers]);

  const providerFilterOptions = useMemo(
    () =>
      (providers || [])
        .map((p: any) => {
          const name = String(p?.metadata?.name ?? '').trim();
          if (!name) return null;
          const hit = providerAliasMap.get(name);
          return { name, display: hit?.display || name };
        })
        .filter(Boolean) as { name: string; display: string }[],
    [providers, providerAliasMap],
  );

  useEffect(() => {
    if (providerNetworks !== undefined) {
      setProviders(Array.isArray(providerNetworks) ? providerNetworks : []);
    }
  }, [providerNetworks]);

  useEffect(() => {
    if (!cloudId) return;
    if (!isControlled) {
      void fetchDataInternal(false, false);
    }
    if (providerNetworks === undefined) {
      void fetchProviderOptions();
    }
  }, [cloudId, isControlled, fetchDataInternal, providerNetworks]);

  const openDrawer = useCallback((record: any) => {
    const raw = record?.rawData || record;
    const name = String(raw?.metadata?.name || '').trim();
    if (!name) return;
    const viewLink = `/apis/kubeovn.io/v1/vlans/${encodeURIComponent(name)}`;
    setDrawerRecord({
      ...raw,
      kind: raw?.kind || 'Vlan',
      links: {
        ...(raw?.links || {}),
        view: viewLink,
      },
    });
    setDrawerTab('detail');
    setDrawerOpen(true);
  }, []);

  const handleDelete = useCallback(
    (record: any) => {
      const raw = record?.rawData || record;
      const name = String(raw?.metadata?.name || '').trim();
      if (!name) {
        message.error('删除失败：无效的 VLAN 名称');
        return;
      }
      const ann = raw?.metadata?.annotations || {};
      const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
      const label = displayAlias || name;

      Modal.confirm({
        title: '确认删除',
        content: `确定要删除 VLAN「${label}」吗？若仍有子网引用，集群可能拒绝删除。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          // 校验子网占用
          try {
            const res = await fetchKubeOvnSubnets(cloudId, true);
            const items = Array.isArray(res?.data?.items) ? res.data.items : [];
            const boundSubnets = items
              .filter((s: any) => String(s?.spec?.vlan || '').trim() === name)
              .map((s: any) => {
                const snAnn = s?.metadata?.annotations || {};
                const alias = String(snAnn[TOWER_IO_ALIES_ANNOTATION] || '').trim();
                return alias || s?.metadata?.name || s?.name;
              })
              .filter(Boolean);
            if (boundSubnets.length > 0) {
              message.error(`VLAN 正在被以下子网绑定，无法删除：${boundSubnets.join('、')}`);
              return;
            }
          } catch (e) {
            console.warn('[DeleteVlan] Subnet usage check failed:', e);
          }

          try {
            await deleteKubeOvnVlan(cloudId, name);
            message.success('删除成功');
            await fetchData(true, true);
          } catch (e: any) {
            message.error(e?.message || '删除失败');
          }
        },
      });
    },
    [cloudId, fetchData],
  );

  const filtered = useMemo(
    () =>
      listData.filter((d) => {
        const ann = d?.metadata?.annotations || {};
        const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
        const metaName = String(d?.metadata?.name || '');
        const matchKeyword =
          !keyword ||
          metaName.includes(keyword) ||
          displayAlias.includes(keyword) ||
          String(d?.spec?.id ?? '').includes(keyword);
        const matchProvider = !providerFilter || d?.spec?.provider === providerFilter;
        return matchKeyword && matchProvider;
      }),
    [listData, keyword, providerFilter],
  );

  const tableRows = useMemo(
    () =>
      filtered.map((raw) => {
        const ann = raw?.metadata?.annotations || {};
        const metadataName = String(raw?.metadata?.name || '').trim();
        const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim() || metadataName;
        return {
          key: raw?.metadata?.uid || raw?.metadata?.name,
          displayAlias,
          metadataName,
          rawData: raw,
        };
      }),
    [filtered],
  );

  const allColumns = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'displayAlias',
        key: 'displayAlias',
        ellipsis: true,
        fixed: 'left' as const,
        render: (text: string) => {
          const s = String(text || '').trim() || '—';
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <TagTwoTone/>
              <span>{s}</span>
            </span>
          );
        },
      },
      {
        title: 'ID',
        dataIndex: 'metadataName',
        key: 'metadataName',
        ellipsis: true,
        render: (text: string) => (
          <Tooltip title="Kubernetes 中 Vlan 对象的 metadata.name，创建后不可改">
            <span>{text ?? '—'}</span>
          </Tooltip>
        ),
      },
      {
        title: 'VLAN 标签',
        key: 'vlanTag',
        render: (_: unknown, row: any) => {
          const raw = row?.rawData;
          const id = raw?.spec?.id;
          return (
            <Tooltip title="802.1Q VLAN ID，打在物理链路上的标签号">
              <span>{id !== undefined && id !== null ? String(id) : '—'}</span>
            </Tooltip>
          );
        },
      },
      {
        title: '物理网络',
        key: 'provider',
        ellipsis: true,
        render: (_: unknown, row: any) => {
          const raw = row?.rawData;
          const provider = raw?.spec?.provider;
          const p = String(provider ?? '').trim();
          if (!p) return <span>—</span>;
          const hit = providerAliasMap.get(p);
          const alias = hit?.alias || '';
          const display = hit?.display || p;
          return alias && alias !== p ? (
            <Tooltip title={`资源名: ${p}`}>
              <Tag color="geekblue">{display}</Tag>
            </Tooltip>
          ) : (
            <Tag color="geekblue">{display}</Tag>
          );
        },
      },
      {
        title: '创建时间',
        key: 'created',
        render: (_: unknown, row: any) => {
          const raw = row?.rawData;
          const text = raw?.metadata?.creationTimestamp;
          return (
            <span className="std-time">{text ? new Date(text).toLocaleString() : '—'}</span>
          );
        },
      },
      ...(!isStandardView && canWriteVlan
        ? [
            {
              title: '操作',
              key: 'action',
              align: 'left' as const,
              fixed: 'right' as const,
              render: (_: unknown, record: any) => (
                <ResourceActionsDropdown
                  buttonProps={{ className: 'row-actions-trigger' }}
                  items={[
                    {
                      key: 'ops',
                      label: '查看YAML',
                      onClick: () => openDrawer(record),
                    },
                    { type: 'divider' as const },
                    {
                      key: 'delete',
                      label: '删除',
                      danger: true,
                      onClick: () => handleDelete(record),
                    },
                  ]}
                />
              ),
            },
          ]
        : !isStandardView
          ? [
            {
              title: '操作',
              key: 'action',
              align: 'left' as const,
              fixed: 'right' as const,
              render: (_: unknown, record: any) => (
                <ResourceActionsDropdown
                  buttonProps={{ className: 'row-actions-trigger' }}
                  items={[
                    {
                      key: 'ops',
                      label: '查看YAML',
                      onClick: () => openDrawer(record),
                    },
                  ]}
                />
              ),
            },
          ]
          : []),
    ],
    [canWriteVlan, isStandardView, openDrawer, handleDelete, providerAliasMap],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_vlans_table');

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            allowClear
            placeholder="名称 / ID / VLAN tag"
            value={keyword}
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select
            allowClear
            placeholder="筛选物理网络"
            className="toolbar-filter-sm"
            value={providerFilter}
            onChange={setProviderFilter}
          >
            {providerFilterOptions.map((p) => (
              <Option key={p.name} value={p.name}>
                {p.display}
              </Option>
            ))}
          </Select>
          <a
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setProviderFilter(undefined);
              void fetchData(false, false);
            }}
          >
            重置
          </a>
        </div>
        <div className="toolbar-actions">
          {canWriteVlan && (
            <Button type="primary" onClick={() => setVlanPlanOpen(true)}>
              网络规划
            </Button>
          )}
          <TableColumnSettingsButton allColumns={allColumns} settingsKey="harvester_vlans_table" />
          <Button icon={<ReloadOutlined />} onClick={() => void fetchData(true, false)} loading={tableLoading} title="从集群重新同步" />
        </div>
      </div>

      <Table
        className="std-table"
        bordered={false}
        columns={tableColumns}
        dataSource={tableRows}
        rowKey={(r) => r.key}
        loading={tableLoading}
        scroll={{ x: true }}
        pagination={{ showTotal: (total) => `共 ${total} 条` }}
      />

      <ProviderNetworkVlanPlanDrawer
        open={vlanPlanOpen}
        onClose={() => setVlanPlanOpen(false)}
        cloudId={cloudId}
        onSuccess={() => fetchData(true, true)}
      />

      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerRecord(null);
        }}
        resourceType="网络规划 (Kube-OVN)"
        record={drawerRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />
    </div>
  );
};

export default VlansSection;
