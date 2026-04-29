/**
 * Harvester - 负载均衡 (LoadBalancer Service) 列表 Section
 * 展示基于 Harvester/Kubernetes Service 的负载均衡资源，
 * 支持：
 * - 关键字过滤（名称 / 命名空间）
 * - 创建负载均衡
 * - 单个/批量删除
 * - 打开 HarvesterResourceDrawer 查看 Service 详情
 */
import React, { useMemo, useState } from 'react';
import { Table, Button, message, Tag, Input, Space, Modal, Select } from 'antd';
import { ReloadOutlined, SearchOutlined, ShareAltOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import CreateLoadBalancerModal from '../../nad/modals/CreateLoadBalancerModal';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { deleteHarvesterService } from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import { useCloudmapOpsViewWrite } from '../../hooks/useCloudmapOpsViewWrite';

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，用于调用删除 Service 的 API
 * - loadBalancers: 负载均衡 Service 列表
 * - namespaces: 命名空间列表，供创建弹窗选择
 * - loading: 外层传入的加载状态
 * - onRefresh: 刷新回调，支持传入 force=true
 */
interface Props {
  cloudId: string;
  loadBalancers: any[];
  namespaces?: any[];
  loading: boolean;
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  isTenant?: boolean;
  bordered?: boolean;
}

const LoadBalancersSection: React.FC<Props> = ({ cloudId, loadBalancers, namespaces = [], loading, onRefresh, isTenant, bordered = true }) => {
  const hasOpsView = useCloudmapOpsViewWrite();
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const isStandardView = !hasOpsView;
  // 工具栏与弹窗状态
  const [keyword, setKeyword] = useState<string>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [ipamFilter, setIpamFilter] = useState<string>('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  /**
   * 将 Service 对象转换为表格可直接展示的数据结构
   * - listeners 字段将监听端口列表拼接为 "port:backendPort/protocol" 格式
   */
  const dataSource = useMemo(() => {
    return (loadBalancers || []).map((raw: any) => {
      const listeners = (raw.spec?.listeners || []).map((l: any) => `${l.port}:${l.backendPort}/${l.protocol}`).join(', ');

      return {
        key: raw.metadata?.uid,
        name: raw.metadata?.name,
        namespace: raw.metadata?.namespace,
        address: raw.status?.address || '-',
        ipam: raw.spec?.ipam || '-',
        listeners: listeners || '-',
        creationTimestamp: raw.metadata?.creationTimestamp,
        raw,
      };
    });
  }, [loadBalancers]);

  /**
   * 根据关键字、命名空间、IP分配模式进行过滤
   * 
   * [权限说明]
   * - 租户可以看到公共命名空间（default、cloud-public、harvester-public）的 LoadBalancer，但不能删除它们
   * - 删除权限控制已在删除函数中实现
   */
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const ns = nsFilter.trim().toLowerCase();
    const ipam = ipamFilter.trim().toLowerCase();

    return dataSource.filter((x: any) => {
      // 关键字过滤：匹配名称或命名空间
      if (kw) {
        const name = String(x.name || '').toLowerCase();
        const namespace = String(x.namespace || '').toLowerCase();
        if (!name.includes(kw) && !namespace.includes(kw)) return false;
      }

      // 命名空间过滤：精确匹配
      if (ns) {
        const namespace = String(x.namespace || '').toLowerCase();
        if (namespace !== ns) return false;
      }

      // IP分配模式过滤：精确匹配
      if (ipam) {
        const ipamType = String(x.ipam || '').toLowerCase();
        if (ipamType !== ipam) return false;
      }

      return true;
    });
  }, [dataSource, keyword, nsFilter, ipamFilter, isTenant]);

  /**
   * 提取可用的命名空间选项（用于筛选下拉框）
   */
  const namespaceOptions = useMemo(() => {
    const nsSet = new Set<string>();
    dataSource.forEach((item: any) => {
      if (item.namespace) {
        nsSet.add(item.namespace);
      }
    });
    return Array.from(nsSet).sort().map(ns => ({
      label: ns,
      value: ns
    }));
  }, [dataSource]);

  /**
   * 提取可用的IP分配模式选项（用于筛选下拉框）
   */
  const ipamOptions = useMemo(() => {
    const ipamSet = new Set<string>();
    dataSource.forEach((item: any) => {
      if (item.ipam && item.ipam !== '-') {
        ipamSet.add(item.ipam);
      }
    });
    return Array.from(ipamSet).sort().map(ipam => ({
      label: ipam,
      value: ipam
    }));
  }, [dataSource]);

  /**
   * 打开 HarvesterResourceDrawer 展示 Service 详情
   */
  const handleOpenOpsinfo = (record: any) => {
    if (record?.raw) {
      setSelectedRecord(record.raw);
      setDrawerTab('detail');
      setDrawerOpen(true);
    }
  };

  /**
   * 删除单个负载均衡 Service
   */
  const handleDelete = (record: any) => {
    // 租户不能删除公共命名空间的资源
    const isPublic = isPublicNamespace(record.namespace);
    if (isTenant && isPublic) {
      message.warning('租户不能删除公共命名空间的资源');
      return;
    }

    Modal.confirm({
      title: '确认删除',
      content: `确定要删除负载均衡 ${record.name} 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteHarvesterService(cloudId, record.namespace, record.name);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '删除失败');
        }
      }
    });
  };

  /**
   * 批量删除选中的负载均衡
   */
  const handleBatchDelete = () => {
    // 过滤掉系统命名空间和公共命名空间的资源（如果是租户）
    const targets = selectedRowKeys.map(key => dataSource.find(d => d.key === key)).filter(Boolean);
    const deletableTargets = targets.filter((item: any) => {
      if (isSystemNamespace(item.namespace)) return false;
      if (isTenant && isPublicNamespace(item.namespace)) return false;
      return true;
    });
    const systemTargets = targets.filter((item: any) => isSystemNamespace(item.namespace));
    const publicTargets = isTenant ? targets.filter((item: any) => isPublicNamespace(item.namespace)) : [];

    if (deletableTargets.length === 0) {
      const reasons: string[] = [];
      if (systemTargets.length > 0) reasons.push(`${systemTargets.length} 个系统命名空间`);
      if (publicTargets.length > 0) reasons.push(`${publicTargets.length} 个公共命名空间`);
      message.warning(`选中的负载均衡无法删除：${reasons.join('，')}`);
      setSelectedRowKeys([]);
      return;
    }

    Modal.confirm({
      title: '确认批量删除',
      content: (
        <>
          <div>{`确定要删除选中的 ${deletableTargets.length} 个负载均衡吗？此操作不可恢复。`}</div>
          {systemTargets.length > 0 && (
            <div style={{ color: '#faad14', marginTop: 8 }}>
              {`注意：${systemTargets.length} 个系统命名空间的负载均衡将被跳过。`}
            </div>
          )}
          {publicTargets.length > 0 && (
            <div style={{ color: '#faad14', marginTop: 8 }}>
              {`注意：${publicTargets.length} 个公共命名空间的负载均衡将被跳过（租户不能删除公共命名空间的资源）。`}
            </div>
          )}
        </>
      ),
      okText: '批量删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const promises = deletableTargets.map((item: any) => {
            return deleteHarvesterService(cloudId, item.namespace, item.name);
          });
          
          await Promise.all(promises);
          message.success('批量删除成功');
          setSelectedRowKeys([]);
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '部分删除失败');
          onRefresh?.(true);
        }
      }
    });
  };

  // 表格多选配置
  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    getCheckboxProps: (record: any) => ({
      disabled: isSystemNamespace(record.namespace) || (isTenant && isPublicNamespace(record.namespace)),
    }),
  };

  /**
   * 表格列定义
   * - 名称列可点击打开详情抽屉
   * - IPAM 列使用 Tag 高亮展示地址分配模式
   */
  const columns = [
    {
      fixed: 'left' as const,
      title: 'SLB名称', 
      dataIndex: 'name', 
      key: 'name', 
      render: (t: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <ShareAltOutlined style={{ color: '#1677ff' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t}</span>
        </span>
      ) 
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { title: '地址', dataIndex: 'address', key: 'address' },
    { title: '地址分配模式', dataIndex: 'ipam', key: 'ipam', render: (t: string) => <Tag>{t}</Tag> },
    { title: '监听器', dataIndex: 'listeners', key: 'listeners', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp' },
    {
      title: '操作',
      key: 'action',
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const isSys = isSystemNamespace(record.namespace);
        const isPublic = isPublicNamespace(record.namespace);
        const deleteDisabled = isSys || (isTenant && isPublic);
        return (
          <ResourceActionsDropdown 
            buttonProps={{ className: 'row-actions-trigger' }}
            items={[
              ...(!isTenant && !isStandardView ? [{
                key: 'opsinfo',
                label: '查看YAML',
                onClick: () => handleOpenOpsinfo(record)
              }] : []),
              { type: 'divider' },
              { 
                key: 'delete', 
                label: '删除', 
                danger: true, 
                disabled: deleteDisabled,
                onClick: () => handleDelete(record) 
              }
            ]}
          />
        );
      },
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <Space>
          <Input
            className="toolbar-search"
            placeholder="名称/ID"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            allowClear
            style={{ width: 200 }}
          />
          <Select
            placeholder="命名空间"
            value={nsFilter || undefined}
            onChange={(v) => setNsFilter(v || '')}
            allowClear
            className="toolbar-filter-sm"
            style={{ width: 150 }}
            options={namespaceOptions}
          />
          <Select
            placeholder="IP分配模式"
            value={ipamFilter || undefined}
            onChange={(v) => setIpamFilter(v || '')}
            allowClear
            className="toolbar-filter-sm"
            style={{ width: 150 }}
            options={ipamOptions}
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
        </Space>
      }
      toolbarRight={
        <Space>
            {selectedRowKeys.length > 0 && (
              <Button danger onClick={handleBatchDelete}>批量删除</Button>
            )}
            <Button type="primary" onClick={() => setCreateModalOpen(true)}>创建负载均衡</Button>
            <Button icon={<ReloadOutlined />} onClick={() => onRefresh && onRefresh(true)} loading={loading}></Button>
        </Space>
      }
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        dataSource={filteredData}
        columns={columns}
        rowKey="key"
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowSelection={rowSelection}
      />
      
      <CreateLoadBalancerModal
        open={createModalOpen}
        cloudId={cloudId}
        namespaces={namespaces}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={() => {
          // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，但后端会优先查询数据库）
          // 静默刷新，不显示提示信息
          onRefresh && onRefresh(true, true); // force=true, silent=true
        }}
      />

      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="LoadBalancer"
        record={selectedRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default LoadBalancersSection;
