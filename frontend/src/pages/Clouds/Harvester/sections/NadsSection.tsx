/**
 * Harvester - 网络 (NetworkAttachmentDefinition / NAD) 列表 Section
 * 展示 Harvester / Kube-OVN 中的网络附加定义（NAD），支持：
 * - 关键字 / 命名空间 / IPAM 类型过滤
 * - 新建网络（NadCreateModal）
 * - 查看 Harvester 资源详情
 * - 非系统命名空间网络的删除操作
 */
import React, { useMemo, useState } from 'react';
import { Table, Input, Select, Tag, Button, Modal, Tabs, Space, Descriptions, message } from 'antd';
import { ReloadOutlined, EyeOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { fetchHarvesterNadDetail, deleteHarvesterNad } from '../../../../services/harvesterApi';
import { fetchCloudProviderEcs } from '../../../../services/api';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';
import NadCreateModal from '../modals/NadCreateModal';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';

/**
 * 组件入参说明
 * - nads: NAD 列表，可能为 Harvester/K8s 原始对象或平台包装后的对象
 * - loading: 外层传入的加载状态
 * - onRefresh: 刷新回调，支持传入 force=true
 * - cloudId: 当前云 ID，用于调用删除等 API
 */
type Props = {
  nads: any[];
  loading: boolean;
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  cloudId?: string;
};

const NadsSection: React.FC<Props> = ({ nads = [], loading, onRefresh, cloudId }) => {
  // 过滤条件：关键字 / 命名空间 / IPAM 类型
  const [keyword, setKeyword] = useState<string>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [ipamFilter, setIpamFilter] = useState<string>('');
  const [tableColumns, setTableColumns] = useState<any[]>([]);

  // 详情抽屉状态
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  // 创建网络弹窗状态
  const [createVisible, setCreateVisible] = useState(false);

  /**
   * 打开 HarvesterResourceDrawer，查看 NAD 详情
   * kind 固定为 NetworkAttachmentDefinition 以兼容事件等功能
   */
  const handleOpenDrawer = async (record: any, tab: string = 'detail') => {
    setDetailRecord({ ...record, kind: 'NetworkAttachmentDefinition' });
    setDetailActiveTab(tab);
    setDetailVisible(true);
  };

  /**
   * 删除单个网络
   * - 系统命名空间会在操作列中被禁用删除按钮
   */
  const handleDelete = async (record: any) => {
    // Pre-check占用情况，供确认框内展示并禁用删除按钮
    let usingVms: string[] = [];
    try {
      const ecsRes = await fetchCloudProviderEcs(cloudId || '', true);
      const vms: any[] = ecsRes?.data || ecsRes || [];
      const targetRef = `${record._namespace}/${record._name}`.toLowerCase();
      usingVms = vms
        .filter((vm: any) => Array.isArray(vm.networks))
        .filter((vm: any) =>
          vm.networks.some((n: string) => {
            const s = String(n || '').toLowerCase();
            const base = s.includes('@') ? s.split('@')[0] : s;
            return base === targetRef || base.endsWith(`/${record._name.toLowerCase()}`);
          }),
        )
        .map(
          (vm: any) =>
            vm?.metadata?.annotations?.['tower.io/alias'] ||
            vm.InstanceName ||
            vm.name ||
            vm.metadata?.name,
        )
        .filter(Boolean);
    } catch (e) {
      // 忽略占用检查错误，不影响确认框展示
    }

    const blocked = usingVms.length > 0;
    Modal.confirm({
      title: '确认删除',
      content: (
        <>
          <div>{`确定要删除网络 ${record._name} 吗？此操作不可恢复。`}</div>
          {blocked && (
            <div style={{ color: '#ff4d4f', marginTop: 8 }}>
              {`不能删除此虚拟网络，因为正在被虚拟机使用 ${usingVms
                .slice(0, 5)
                .join('，')}${usingVms.length > 5 ? ' 等' : ''}`}
            </div>
          )}
        </>
      ),
      okText: '删除',
      okType: 'danger',
      okButtonProps: { disabled: blocked },
      cancelText: '取消',
      onOk: blocked
        ? undefined
        : async () => {
            try {
              await deleteHarvesterNad(cloudId || '', record._namespace, record._name);
              message.success('删除成功');
              onRefresh && onRefresh(true);
            } catch (e: any) {
              message.error(e.message || '删除失败');
            }
          },
    });
  };

  /**
   * 预处理 NAD 数据
   * - 解析 name / namespace
   * - 解析并 JSON 化 config / ipam / vlan / bridge 等字段
   * - 将结果挂载到以 _ 开头的内部字段上，方便后续渲染与过滤
   */
  const processedData = useMemo(() => {
    return (Array.isArray(nads) ? nads : []).map(item => {
        // Robust extraction of name and namespace
        // Handle both flattened backend response and raw K8s/Harvester object
        const name = item?.metadata?.name || item?.name || '';
        const namespace = item?.metadata?.namespace || item?.namespace || '';

        // Robust extraction of config
        // Check spec.config (K8s standard), item.config (Backend flattened), or direct properties
        let config: any = {};
        let rawConfig = item?.spec?.config || item?.config;

        try {
            if (rawConfig) {
                if (typeof rawConfig === 'string') {
                    config = JSON.parse(rawConfig);
                } else if (typeof rawConfig === 'object') {
                    config = rawConfig;
                }
            }
        } catch (e) {
            console.warn('Failed to parse NAD config for', name, e);
        }

        // Normalize IPAM Type
        let ipamType = config?.ipam?.type;
        if (!ipamType && typeof config?.ipam?.subnet === 'string') {
             ipamType = 'host-local';
        }

        return {
            ...item,
            _config: config,
            _name: name,
            _namespace: namespace,
            _vlan: config?.vlan,
            _ipamType: ipamType,
            _promisc: config?.promiscMode,
            _bridge: config?.bridge,
            _type: config?.type,
            _cniVersion: config?.cniVersion
        };
    });
  }, [nads]);

  /**
   * 过滤逻辑
   * - 关键字匹配名称 / 命名空间
   * - 命名空间精确匹配
   * - IPAM 类型精确匹配
   */
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const ns = nsFilter.trim().toLowerCase();
    const ipt = ipamFilter.trim().toLowerCase();

    return processedData.filter(item => {
      const name = String(item._name || '').toLowerCase();
      const nspace = String(item._namespace || '').toLowerCase();
      const ipam = String(item._ipamType || '').toLowerCase();

      // Keyword Filter
      const matchesKeyword = !kw || name.includes(kw) || nspace.includes(kw);
      if (!matchesKeyword) return false;

      // Namespace Filter
      if (ns && nspace !== ns) return false;

      // IPAM Type Filter
      if (ipt && ipam !== ipt) return false;

      return true;
    });
  }, [processedData, keyword, nsFilter, ipamFilter]);

  // 命名空间过滤下拉选项
  const nsOptions = useMemo(() => 
    Array.from(new Set(processedData.map(r => r._namespace).filter(Boolean))).sort(),
  [processedData]);

  // IPAM 类型过滤下拉选项
  const ipamOptions = useMemo(() => 
    Array.from(new Set(processedData.map(r => r._ipamType).filter(Boolean))).sort(),
  [processedData]);

  /**
   * 表格列定义
   * - 名称列可点击打开详情
   * - IPAM 类型列用 std-badge 不同颜色区分 dhcp/static/host-local
   * - 操作列会根据是否系统命名空间禁用删除按钮
   */
  const allColumns = useMemo(() => [
    { 
      title: '网络名称', 
      key: 'name', 
      render: (_: any, r: any) => (
        <span className="cell-link" onClick={() => handleOpenDrawer(r, 'detail')}>
          {r._name || '-'}
        </span>
      )
    },
    { 
      title: '命名空间', 
      key: 'ns', 
      render: (_: any, r: any) => r._namespace || '-' 
    },
    { 
      title: 'VLAN', 
      key: 'vlan', 
      render: (_: any, r: any) => r._vlan ? <span className="std-badge std-badge-info">{r._vlan}</span> : '-' 
    },
    { 
      title: 'IPAM类型', 
      key: 'ipamType', 
      render: (_: any, r: any) => {
          const t = String(r._ipamType || '').toLowerCase();
          if (!t) return <span className="std-badge std-badge-default">未配置</span>;
          
          let badgeClass = 'std-badge-default';
          if (t === 'dhcp') badgeClass = 'std-badge-success';
          else if (t === 'static') badgeClass = 'std-badge-info';
          else if (t === 'host-local') badgeClass = 'std-badge-warning';
          
          return <span className={`std-badge ${badgeClass}`}>{t}</span>;
      }
    },
    { 
      title: '混杂模式', 
      key: 'promisc', 
      render: (_: any, r: any) => r._promisc ? <span className="std-badge std-badge-warning">开启</span> : '-' 
    },
    { 
      title: '网桥信息', 
      key: 'bridgeInfo', 
      render: (_: any, r: any) => {
          const br = r._bridge || '-';
          const tp = r._type || '-';
          return <span>{br} <span>({tp})</span></span>;
      }
    },
    { 
      title: 'CNI版本', 
      key: 'cni', 
      render: (_: any, r: any) => r._cniVersion || '-' 
    },
    { 
      title: 'UID', 
      key: 'uid', 
      render: (_: any, r: any) => <span>{r?.metadata?.uid || '-'}</span> 
    },
    { 
      title: '操作', 
      key: 'actions', 
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
          const isSys = isSystemNamespace(r._namespace);
          const items: any[] = [
              { key: 'detail', label: '资源详情', onClick: () => handleOpenDrawer(r, 'detail') },
              { type: 'divider' },
              { 
                key: 'delete', 
                label: '删除', 
                danger: true, 
                disabled: isSys,
                onClick: () => handleDelete(r) 
              }
          ];
          return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      } 
    },
  ], []);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input 
            allowClear 
            placeholder="关键字" 
            value={keyword} 
            onChange={(e) => setKeyword(e.target.value)} 
            className="toolbar-search"
          />
          <Select 
            allowClear 
            placeholder="命名空间" 
            value={nsFilter || undefined} 
            onChange={(v) => setNsFilter(v || '')} 
            className="toolbar-filter"
            options={[{ value: '', label: '全部命名空间' }, ...nsOptions.map(s => ({ value: s.toLowerCase(), label: s }))]} 
          />
          <Select 
            allowClear 
            placeholder="IPAM类型" 
            value={ipamFilter || undefined} 
            onChange={(v) => setIpamFilter(v || '')} 
            className="toolbar-filter"
            options={[{ value: '', label: '全部IPAM' }, ...ipamOptions.map(s => ({ value: s.toLowerCase(), label: s }))]} 
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNsFilter('');
              setIpamFilter('');
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={(
        <>
          <Button type="primary" onClick={() => setCreateVisible(true)}>创建网络</Button>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_nads_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh && onRefresh(true)} loading={loading} />
        </>
      )}
    >
      <Table
        className="std-table"
        bordered
        rowKey={(r: any) => r?.metadata?.uid || `${r?._namespace}/${r?._name}` || Math.random().toString(36).slice(2)}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          size: 'small',
          showQuickJumper: false,
        }}
      />

      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="NetworkAttachmentDefinition"
        record={detailRecord}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
        cloudId={cloudId}
      />

      <NadCreateModal 
        open={createVisible} 
        onCancel={() => setCreateVisible(false)} 
        onSuccess={() => {
          setCreateVisible(false);
          onRefresh && onRefresh(true, true);
        }}
        cloudId={cloudId || ''} 
      />
    </PageDetailSection>
  );
};

export default NadsSection;
