import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Table, List, Modal, Form, Input, Select, message, Tag, Space, Alert, Tooltip, Badge, Segmented } from 'antd';
import { ReloadOutlined, LayoutTwoTone, SearchOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import dayjs from 'dayjs';
import {
  createKubeOvnProviderNetwork,
  deleteKubeOvnProviderNetwork,
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
  fetchHarvesterNodes,
  fetchHarvesterClusterNetworks,
} from '../../../../../../services/harvesterApi';
import { clearCache } from '../../../../../../utils/requestManager';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { CLOUD_PROVIDER_NETWORKS_READ, CLOUD_PROVIDER_NETWORKS_WRITE } from '../../../../../../constants/cloudPermissions';
import ProviderNetworkVlanPlanDrawer from '../drawers/provider-network-vlan-plan-drawer';
import ProviderNetworkDetailDrawer from '../drawers/provider-network-detail-drawer';
import ResourceLinkYamlDrawer from '../../shared/components/ResourceLinkYamlDrawer';
import { TOWER_IO_ALIES_ANNOTATION, generateKubeOvnTwelveCharName } from '../../../../../../utils/towerKubeOvnNames';
import { SUBNET_TYPE_ANNOTATION_KEY, TOWER_ALIAS_ANNOTATION } from '../lib/kubeOvnSubnetConstants';

const { Option } = Select;

function resolveProviderNetworkViewLink(record: any): string {
  const raw = record?.raw || record?.rawData || record;
  const explicit = raw?.links?.view;
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  const name = String(record?.name || raw?.metadata?.name || '').trim();
  if (!name || name === '-') return '';
  return `/apis/kubeovn.io/v1/provider-networks/${encodeURIComponent(name)}`;
}

type Props = {
  cloudId: string;
  /**
   * 详情页「集群」Tab 托管：列表由父级 loadTabResource 拉取，与切换 Tab 行为一致；不传则组件内自行请求（兼容其它入口）
   */
  parentNetworks?: any[];
  parentVlans?: any[];
  parentLoading?: boolean;
  onParentRefresh?: (force?: boolean, skipSync?: boolean) => void | Promise<void>;
};

const ProviderNetworksSection: React.FC<Props> = ({
  cloudId,
  parentNetworks,
  parentVlans,
  parentLoading,
  onParentRefresh,
}) => {
  const isParentManaged = typeof onParentRefresh === 'function';
  const { user } = useAuth();
  const perms = user?.permissions || [];
  const canReadProviderNetwork = hasPermissionForAction(perms, CLOUD_PROVIDER_NETWORKS_READ);
  const canWriteProviderNetwork = hasPermissionForAction(perms, CLOUD_PROVIDER_NETWORKS_WRITE);
  const [createMode, setCreateMode] = useState<'centralized' | 'node_specific'>('centralized');
  const [data, setData] = useState<any[]>([]);
  const [vlans, setVlans] = useState<any[]>([]);
  const [subnets, setSubnets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [nodeInterfaces, setNodeInterfaces] = useState<string[]>([]);
  const [nodeInterfaceMap, setNodeInterfaceMap] = useState<Record<string, string[]>>({});
  const [nodes, setNodes] = useState<any[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [interfaceMap, setInterfaceMap] = useState<Record<string, string>>({});
  const [targetNodes, setTargetNodes] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [readyFilter, setReadyFilter] = useState<string>('');
  const [vlanFilter, setVlanFilter] = useState<string>('');
  const [customFilter, setCustomFilter] = useState<string>('');
  const [pnDetailOpen, setPnDetailOpen] = useState(false);
  const [pnDetailLockProvider, setPnDetailLockProvider] = useState<string | null>(null);
  const [vlanPlanOpen, setVlanPlanOpen] = useState(false);
  const [vlanPlanLockProvider, setVlanPlanLockProvider] = useState<string | null>(null);
  const [pnYamlOpen, setPnYamlOpen] = useState(false);
  const [pnYamlViewLink, setPnYamlViewLink] = useState<string | undefined>();

  const openPnYamlDrawer = useCallback((record: any) => {
    const link = resolveProviderNetworkViewLink(record);
    if (!link) {
      message.warning('无法解析 ProviderNetwork 的集群查看路径');
      return;
    }
    setPnYamlViewLink(link);
    setPnYamlOpen(true);
  }, []);

  const closePnYamlDrawer = useCallback(() => {
    setPnYamlOpen(false);
    setPnYamlViewLink(undefined);
  }, []);

  const openDetailForProvider = useCallback((pnName: string) => {
    setPnDetailLockProvider(pnName);
    setPnDetailOpen(true);
  }, []);

  const closeDetailDrawer = useCallback(() => {
    setPnDetailOpen(false);
    setPnDetailLockProvider(null);
  }, []);

  const openVlanPlanForProvider = useCallback((pnName: string) => {
    setVlanPlanLockProvider(pnName);
    setVlanPlanOpen(true);
  }, []);

  const closeVlanPlanDrawer = useCallback(() => {
    setVlanPlanOpen(false);
    setVlanPlanLockProvider(null);
  }, []);

  const vlanListForAlias = isParentManaged ? (parentVlans || []) : vlans;

  const vlanAliasMap = useMemo(() => {
    const map = new Map<string, { display: string; alias: string }>();
    (vlanListForAlias || []).forEach((v: any) => {
      const name = String(v?.metadata?.name ?? '').trim();
      if (!name) return;
      const ann = v?.metadata?.annotations || {};
      const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
      map.set(name, { display: alias || name, alias });
    });
    return map;
  }, [vlanListForAlias]);

  const fetchData = async (force = false, skipSync = false) => {
    try {
      const subnetRes = await fetchKubeOvnSubnets(cloudId, force, skipSync).catch(() => ({ data: { items: [] } }));
      setSubnets(Array.isArray(subnetRes?.data?.items) ? subnetRes.data.items : []);
    } catch {
      setSubnets([]);
    }
    if (isParentManaged && onParentRefresh) {
      await onParentRefresh(force, skipSync);
      return;
    }
    setLoading(true);
    try {
      const [pnRes, vlanRes] = await Promise.all([
        fetchKubeOvnProviderNetworks(cloudId, force, skipSync),
        fetchKubeOvnVlans(cloudId, force, skipSync).catch(() => ({ data: { items: [] } })),
      ]);
      setData(Array.isArray(pnRes?.data?.items) ? pnRes.data.items : []);
      setVlans(Array.isArray(vlanRes?.data?.items) ? vlanRes.data.items : []);
      if (force && cloudId) {
        clearCache(`/api/clouds/${cloudId}/resources/provider-networks`, 'GET');
        clearCache(`/api/clouds/${cloudId}/resources/vlans`, 'GET');
      }
    } catch (error: any) {
      message.error(`获取物理网络列表失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchNodesAndInterfaces = async () => {
    setNodesLoading(true);
    try {
      const [nodesRes, clusterNetworksRes] = await Promise.all([
        fetchHarvesterNodes(cloudId, true),
        fetchHarvesterClusterNetworks(cloudId, true).catch(() => ({ data: { items: [] } })),
      ]);

      const items = nodesRes?.data?.items || [];
      setNodes(items);

      const clusterNetworkNics = new Set<string>();
      const clusterNetworks = clusterNetworksRes?.data?.items || [];
      clusterNetworks.forEach((cn: any) => {
        const uplinks = cn.uplinks || cn.rawData?.uplinks;
        if (uplinks?.nics && Array.isArray(uplinks.nics)) {
          uplinks.nics.forEach((nic: string) => nic && clusterNetworkNics.add(nic.trim()));
        }
      });

      const allInterfaces = new Set<string>();
      const nodeIfMap: Record<string, string[]> = {};

      items.forEach((node: any) => {
        const nodeName = String(node?.metadata?.name || '');
        if (!nodeName) return;
        /**
         * 这里不再用 physicalInterfaces/interfaceStatusMap 等“推断逻辑”：
         * HMS 接口本身就是为了输出「物理节点可用的物理网卡」。
         * 因此以 node.nics 为权威数据源，仅做最小过滤：
         * - usedByHarvester=false：未被集群网络占用
         * - state=up：链路可用（瞬时）
         * - 额外兜底：如果该网卡同时出现在 clusterNetwork uplinks.nics 中，也排除
         */
        const nodeNics: any[] = Array.isArray(node?.nics) ? node.nics : [];
        const filtered = nodeNics
          .map((n: any) => ({
            device: String(n?.device || '').trim(),
            state: String(n?.state || '').trim().toLowerCase(),
            usedByHarvester: Boolean(n?.usedByHarvester),
          }))
          .filter((x) => Boolean(x.device))
          .filter((x) => !x.usedByHarvester)
          .filter((x) => (x.state ? x.state === 'up' : true))
          .filter((x) => !clusterNetworkNics.has(x.device))
          .map((x) => x.device);

        const uniq = Array.from(new Set(filtered)).sort();
        nodeIfMap[nodeName] = uniq;
        uniq.forEach((iface) => allInterfaces.add(iface));
      });

      const ifaces = Array.from(allInterfaces).sort();

      setNodeInterfaceMap(nodeIfMap);
      setNodeInterfaces(ifaces);
    } catch {
      message.warning('获取节点网卡失败');
    } finally {
      setNodesLoading(false);
    }
  };

  const onDefaultInterfaceChange = (value: string) => {
    const newMap = { ...interfaceMap };
    const applyNodes = createMode === 'node_specific'
      ? nodes.filter(node => targetNodes.includes(node.metadata.name))
      : nodes;
    applyNodes.forEach(node => {
      newMap[node.metadata.name] = value;
    });
    setInterfaceMap(newMap);
  };

  const handleInterfaceChange = (nodeName: string, value: string) => {
    setInterfaceMap(prev => ({ ...prev, [nodeName]: value }));
  };

  useEffect(() => {
    if (!cloudId || isParentManaged) return;
    fetchData();
  }, [cloudId, isParentManaged]);

  useEffect(() => {
    if (!isModalVisible) return;
    fetchNodesAndInterfaces();
    setCreateMode('centralized');
    setTargetNodes([]);
    setInterfaceMap({});
    form.resetFields();
  }, [isModalVisible, cloudId]);

  const handleCreate = async (values: any) => {
    if (!canWriteProviderNetwork) {
      message.error('当前账号没有物理网络管理权限');
      return;
    }
    try {
      let defaultIf = String(values.defaultInterface || '').trim();
      const selectedNodesFromForm: string[] = Array.isArray(values.targetNodes) ? values.targetNodes : targetNodes;

      if (createMode === 'node_specific') {
        if (!selectedNodesFromForm.length) {
          message.warning('请至少选择一台物理机');
          return;
        }
        const selectedMappings = selectedNodesFromForm
          .map((nodeName) => ({ nodeName, iface: String(interfaceMap[nodeName] || '').trim() }))
          .filter((item) => !!item.iface);
        if (!selectedMappings.length) {
          message.warning('请至少为一台物理机选择网卡');
          return;
        }
        if (!defaultIf) defaultIf = selectedMappings[0].iface;
      }

      if (!defaultIf && createMode === 'centralized') {
        message.warning('请选择默认网卡');
        return;
      }

      const nodeNamesForSpec: string[] =
        createMode === 'node_specific'
          ? selectedNodesFromForm.filter((n) => String(n || '').trim())
          : nodes.map((n: any) => String(n?.metadata?.name || '').trim()).filter(Boolean);

      /** 按网卡聚合节点：批量模式下同为默认网卡也写入 customInterfaces；多网卡时每项 nodes 为该网卡的全部节点名 */
      const ifaceBuckets: Record<string, Set<string>> = {};
      for (const nodeName of nodeNamesForSpec) {
        let iface = '';
        if (createMode === 'node_specific') {
          iface = String(interfaceMap[nodeName] || '').trim();
          if (!iface) {
            message.warning(`请为节点「${nodeName}」选择网卡`);
            return;
          }
        } else {
          iface = String(interfaceMap[nodeName] ?? defaultIf ?? '').trim();
          if (!iface) {
            message.warning('请选择默认网卡');
            return;
          }
        }
        if (!ifaceBuckets[iface]) ifaceBuckets[iface] = new Set();
        ifaceBuckets[iface].add(nodeName);
      }

      if (!Object.keys(ifaceBuckets).length) {
        message.warning('没有可下发的节点—网卡映射');
        return;
      }

      const customInterfaces = Object.keys(ifaceBuckets)
        .sort()
        .map((iface) => ({
          interface: iface,
          nodes: Array.from(ifaceBuckets[iface]).sort(),
        }));

      const towerAlies = String(values.towerAlies ?? '').trim();
      if (!towerAlies) {
        message.warning('请输入物理网络名称');
        return;
      }

      const resourceName = generateKubeOvnTwelveCharName();
      const payload = {
        name: resourceName,
        annotations: { [TOWER_IO_ALIES_ANNOTATION]: towerAlies },
        spec: {
          defaultInterface: defaultIf,
          customInterfaces,
          exchangeLinkName: false,
        },
      };

      await createKubeOvnProviderNetwork(cloudId, payload);
      message.success('创建物理网络成功');
      setIsModalVisible(false);
      fetchData(true, true);
    } catch (error: any) {
      message.error(`创建失败: ${error?.message || '未知错误'}`);
    }
  };

  const handleDelete = (record: any) => {
    if (!canWriteProviderNetwork) {
      message.error('当前账号没有物理网络管理权限');
      return;
    }
    const raw = record?.raw || record?.rawData || record;
    const name = String(
      record?.name ||
        raw?.metadata?.name ||
        record?.metadata?.name ||
        '',
    ).trim();
    const ann = raw?.metadata?.annotations || {};
    const alias = String(record?.displayAlias || ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
    const label = alias || name;
    if (!name || name === '-') {
      message.error('删除失败：无效的物理网络名称');
      return;
    }
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除物理网络「${label}」吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        // 校验 VLAN 占用
        try {
          const res = await fetchKubeOvnVlans(cloudId, true);
          const items = Array.isArray(res?.data?.items) ? res.data.items : [];
          const boundVlans = items
            .filter((v: any) => (v?.spec?.provider || v?.provider) === name)
            .map((v: any) => {
              const vAnn = v?.metadata?.annotations || {};
              const alias = String(vAnn[TOWER_IO_ALIES_ANNOTATION] || '').trim();
              return alias || v?.metadata?.name || v?.name;
            })
            .filter(Boolean);
          if (boundVlans.length > 0) {
            message.error(`物理网络正在被以下 VLAN 使用，无法删除：${boundVlans.join('、')}`);
            return;
          }
        } catch (e) {
          console.warn('[DeleteProvider] VLAN usage check failed:', e);
        }

        try {
          await deleteKubeOvnProviderNetwork(cloudId, name);
          message.success('删除成功');
          fetchData(true, true);
        } catch (e: any) {
          message.error(e?.message || '删除失败');
        }
      },
    });
  };

  /** 创建弹窗内「节点网卡映射」列表：物理接口列 */
  const renderModalNodeInterfaceCell = (record: any) => {
    const nodeName = String(record?.metadata?.name || '');
    const currentVal = interfaceMap[nodeName];
    const defaultVal = form.getFieldValue('defaultInterface');
    const isCustom = currentVal && currentVal !== defaultVal;
    const nodeOptions = nodeInterfaceMap[nodeName] || [];
    let options = nodeOptions.length > 0 ? nodeOptions : nodeInterfaces;
    let isInvalid = false;
    if (currentVal) {
      if (!options.includes(currentVal)) isInvalid = true;
      if (!options.includes(currentVal)) options = [...options, currentVal];
    }
    if (createMode === 'centralized') {
      return (
        <Space>
          <Input
            style={{ width: 200 }}
            value={currentVal || defaultVal || ''}
            placeholder="未配置"
            disabled
          />
          {!currentVal && !defaultVal && <Tag color="red">未配置</Tag>}
          {isInvalid && (
            <Tooltip title={`警告: 网卡 "${currentVal}" 在节点 "${nodeName}" 上似乎不存在。`}>
              <Tag color="error" style={{ cursor: 'help' }}>无效接口</Tag>
            </Tooltip>
          )}
        </Space>
      );
    }
    return (
      <Space>
        <Select
          style={{ width: 200 }}
          value={currentVal}
          onChange={(val) => handleInterfaceChange(nodeName, val)}
          placeholder="选择接口"
          status={isInvalid ? 'error' : ''}
        >
          {options.map((iface: string) => (
            <Option key={iface} value={iface}>{iface}</Option>
          ))}
        </Select>
        {isCustom && <Tag color="orange">自定义</Tag>}
        {!currentVal && <Tag color="red">未配置</Tag>}
        {isInvalid && (
          <Tooltip title={`警告: 网卡 "${currentVal}" 在节点 "${nodeName}" 上似乎不存在。`}>
            <Tag color="error" style={{ cursor: 'help' }}>无效接口</Tag>
          </Tooltip>
        )}
      </Space>
    );
  };

  const modalNodesList =
    createMode === 'node_specific' ? nodes.filter((n) => targetNodes.includes(n.metadata.name)) : nodes;

  const allColumns = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'displayAlias',
      key: 'displayAlias',
      ellipsis: true,
      fixed: 'left' as const,
      render: (text: string, record: any) => {
        const s = String(text || '').trim();
        if (!s) return <span style={{ color: '#ccc' }}>—</span>;
        const pnName = String(record?.name || '').trim();
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <LayoutTwoTone style={{ color: '#1890ff', flexShrink: 0 }} />
            {pnName ? (
              <span
                className="cell-link"
                onClick={(e) => {
                  e.stopPropagation();
                  openDetailForProvider(pnName);
                }}
              >
                {s}
              </span>
            ) : (
              <span>{s}</span>
            )}
          </span>
        );
      },
    },
    {
      title: 'ID',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (text: string) => <span>{text ?? '—'}</span>,
    },
    { title: '默认接口', dataIndex: 'defaultInterface', key: 'defaultInterface', render: (text: string) => <Tag>{text}</Tag> },
  
    {
      title: '关联 VLAN',
      dataIndex: 'vlans',
      key: 'vlans',
      render: (vlanNames: string[]) => {
        if (!vlanNames?.length) return <span style={{ color: '#ccc' }}>无</span>;
        return (
          <Space size={[4, 4]} wrap>
            {vlanNames.map((vlan) => {
              const name = String(vlan ?? '').trim();
              if (!name) return null;
              const hit = vlanAliasMap.get(name);
              const alias = hit?.alias || '';
              const display = hit?.display || name;
              return alias && alias !== name ? (
                <Tooltip key={name} title={`资源名: ${name}`}>
                  <Tag color="blue">{display}</Tag>
                </Tooltip>
              ) : (
                <Tag key={name} color="blue">{display}</Tag>
              );
            })}
          </Space>
        );
      },
    },
    {
      title: '就绪节点',
      dataIndex: 'readyNodes',
      key: 'readyNodes',
      render: (nodes: string[]) => {
        if (!nodes?.length) return <span style={{ color: '#ccc' }}>0</span>;
        return (
          <Tooltip title={nodes.join(', ')}>
            <span>{nodes.length}</span>
          </Tooltip>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, record: any) => {
        const ready = !!record?.ready;
        return ready
          ? <Badge status="success" text="已就绪" />
          : <Badge status="warning" text="未就绪" />;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      render: (t: string) => t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '操作',
      key: 'action',
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items: any[] = [];
        const pn = String(record.name || '').trim();
        if (!pn) {
          return <span style={{ color: '#bfbfbf' }}>—</span>;
        }
        if (canReadProviderNetwork) {
          items.push({
            key: 'detail',
            label: '查看详情',
            onClick: () => openDetailForProvider(pn),
          });
          items.push({
            key: 'view-yaml',
            label: '查看 YAML',
            onClick: () => openPnYamlDrawer(record),
          });
          items.push({
            key: 'vlan-plan',
            label: '网络规划',
            onClick: () => openVlanPlanForProvider(pn),
          });
        }
        if (canWriteProviderNetwork) {
          if (items.length > 0) {
            items.push({ type: 'divider' });
          }
          items.push({
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => handleDelete(record),
          });
        }
        if (items.length === 0) {
          return <span style={{ color: '#bfbfbf' }}>—</span>;
        }
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], [
    handleDelete,
    canReadProviderNetwork,
    canWriteProviderNetwork,
    openDetailForProvider,
    openVlanPlanForProvider,
    openPnYamlDrawer,
    vlanAliasMap,
    subnets,
  ]);

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_provider_networks_table');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="toolbar-container">
          <Input
            allowClear
            placeholder="名称"
            value={keyword}
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select
            allowClear
            placeholder="就绪状态"
            value={readyFilter || undefined}
            onChange={(v) => setReadyFilter(String(v || ''))}
            className="toolbar-filter-sm"
            options={[
              { label: '已就绪', value: 'ready' },
              { label: '未就绪', value: 'not_ready' },
            ]}
          />
          <Select
            allowClear
            placeholder="VLAN 关联"
            value={vlanFilter || undefined}
            onChange={(v) => setVlanFilter(String(v || ''))}
            className="toolbar-filter-sm"
            options={[
              { label: '已关联 VLAN', value: 'has_vlans' },
              { label: '无关联 VLAN', value: 'no_vlans' },
            ]}
          />
          <a className="toolbar-reset-btn" onClick={() => { setKeyword(''); setReadyFilter(''); setVlanFilter(''); setCustomFilter(''); fetchData(); }}>重置</a>
        </div>
        <div className="toolbar-actions">
          {canWriteProviderNetwork ? (
            <Button type="primary" onClick={() => setIsModalVisible(true)}>
              创建物理网络
            </Button>
          ) : null}
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey="harvester_provider_networks_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchData(true, false)} loading={loading} title="从集群重新同步" />
        </div>
      </div>

      <Table
        className="std-table"
        bordered={false}
        rowKey={(r) => r.key || r.name}
        loading={isParentManaged ? !!parentLoading : loading}
        dataSource={((isParentManaged ? parentNetworks : data) || [])
          .map((item: any) => {
            const rawBase = item?.rawData || item;
            const mergedLinks = {
              ...(rawBase?.links || {}),
              ...(item?.links || {}),
            };
            const raw = {
              ...rawBase,
              ...(Object.keys(mergedLinks).length ? { links: mergedLinks } : {}),
            };
            const ann = raw?.metadata?.annotations || {};
            const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
            const providerVlans = new Set(
              (Array.isArray(raw?.status?.vlans) ? raw.status.vlans : [])
                .map((v: unknown) => String(v ?? '').trim())
                .filter(Boolean),
            );
            const relatedSubnets = (subnets || [])
              .filter((sn: any) => {
                const snVlan = String(sn?.spec?.vlan ?? '').trim();
                return !!snVlan && providerVlans.has(snVlan);
              })
              .map((sn: any) => {
                const snAnn = sn?.metadata?.annotations || {};
                return {
                  name: String(sn?.metadata?.name || '-'),
                  alias: String(snAnn[TOWER_ALIAS_ANNOTATION] || '').trim(),
                  vlan: String(sn?.spec?.vlan || '-'),
                  cidr: String(sn?.spec?.cidrBlock || sn?.spec?.cidr || '-'),
                  type: String(snAnn[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase(),
                };
              });
            const flatSubnets = relatedSubnets.filter((sn) => sn.type === 'flat');
            const publicSubnets = relatedSubnets.filter((sn) => sn.type === 'public');
            return {
              key: raw?.metadata?.uid || raw?.metadata?.name,
              name: raw?.metadata?.name || '-',
              displayAlias,
              defaultInterface: raw?.spec?.defaultInterface || '-',
              customInterfaces: raw?.spec?.customInterfaces || [],
              status: raw?.status,
              ready: !!raw?.status?.ready,
              readyNodes: Array.isArray(raw?.status?.readyNodes) ? raw.status.readyNodes : [],
              vlans: Array.isArray(raw?.status?.vlans) ? raw.status.vlans : [],
              flatSubnets,
              publicSubnets,
              creationTimestamp: raw?.metadata?.creationTimestamp,
              raw,
            };
          })
          .filter((d: any) => {
            const matchKeyword =
              !keyword ||
              String(d.name || '').includes(keyword) ||
              String(d.displayAlias || '').includes(keyword);
            if (!matchKeyword) return false;
            if (readyFilter === 'ready' && !d.ready) return false;
            if (readyFilter === 'not_ready' && d.ready) return false;
            if (vlanFilter === 'has_vlans' && (d.vlans || []).length === 0) return false;
            if (vlanFilter === 'no_vlans' && (d.vlans || []).length > 0) return false;
            if (customFilter === 'has_custom' && (d.customInterfaces || []).length === 0) return false;
            if (customFilter === 'no_custom' && (d.customInterfaces || []).length > 0) return false;
            return true;
          })}
        scroll={{ x: true }}
        columns={tableColumns}
        pagination={{ showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal
        title="创建物理网络"
        open={isModalVisible}
        centered
        onOk={form.submit}
        onCancel={() => setIsModalVisible(false)}
        width={700}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} className="std-form">
          <Form.Item
            name="towerAlies"
            label="网络名称"
            rules={[{ required: true, message: '请输入物理网络名称' }]}
          >
            <Input placeholder="请输入物理网络名称" allowClear />
          </Form.Item>

          <Form.Item label="网卡选择方式">
            <Segmented
              value={createMode}
              onChange={(val) => {
                const mode = val as 'centralized' | 'node_specific';
                setCreateMode(mode);
                setInterfaceMap({});
                setTargetNodes([]);
                form.setFieldsValue({ defaultInterface: undefined, targetNodes: [] });
              }}
              options={[
                { label: '批量选择', value: 'centralized' },
                { label: '指定网卡', value: 'node_specific' },
              ]}
            />
          </Form.Item>

          {createMode === 'node_specific' && (
            <Form.Item name="targetNodes" label="指定物理机" rules={[{ required: true, message: '请选择至少一台物理机' }]}>
              <Select
                mode="multiple"
                placeholder="选择一台或多台物理机"
                loading={nodesLoading}
                value={targetNodes}
                onChange={(vals) => {
                  const next = vals as string[];
                  setTargetNodes(next);
                  form.setFieldsValue({ targetNodes: next });
                }}
                allowClear
              >
                {nodes.map((node) => (
                  <Option key={node.metadata.name} value={node.metadata.name}>{node.metadata.name}</Option>
                ))}
              </Select>
            </Form.Item>
          )}

          {createMode === 'centralized' && (
            <Form.Item
              name="defaultInterface"
              label="选择物理网卡（所有节点）"
              rules={[{ required: true }]}
            >
              <Select placeholder="选择物理网卡 (e.g. eth0)" loading={nodesLoading} showSearch allowClear onChange={onDefaultInterfaceChange}>
                {nodeInterfaces.map(iface => <Option key={iface} value={iface}>{iface}</Option>)}
              </Select>
            </Form.Item>
          )}

          <Form.Item label="各节点网卡" style={{ marginBottom: 0 }}>
            <div
              style={
                modalNodesList.length > 6
                  ? { maxHeight: 240, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }
                  : { border: '1px solid #f0f0f0', borderRadius: 6 }
              }
            >
              <List
                size="small"
                split
                dataSource={modalNodesList}
                renderItem={(record) => (
                  <List.Item key={record.metadata?.name} style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, width: '100%' }}>
                      <span style={{ minWidth: 200, flexShrink: 0, wordBreak: 'break-all' }}>
                        {record?.metadata?.name ?? '—'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>{renderModalNodeInterfaceCell(record)}</div>
                    </div>
                  </List.Item>
                )}
              />
            </div>
          </Form.Item>
        </Form>
      </Modal>

      <ProviderNetworkDetailDrawer
        open={pnDetailOpen}
        onClose={closeDetailDrawer}
        cloudId={cloudId}
        lockProviderName={pnDetailLockProvider}
        onSuccess={() => fetchData(true, true)}
      />
      <ProviderNetworkVlanPlanDrawer
        open={vlanPlanOpen}
        onClose={closeVlanPlanDrawer}
        cloudId={cloudId}
        lockProviderName={vlanPlanLockProvider}
        onSuccess={() => fetchData(true, true)}
      />
      <ResourceLinkYamlDrawer
        open={pnYamlOpen}
        onClose={closePnYamlDrawer}
        cloudId={cloudId}
        viewLink={pnYamlViewLink}
        title="查看 YAML"
      />
    </div>
  );
};

export default ProviderNetworksSection;
