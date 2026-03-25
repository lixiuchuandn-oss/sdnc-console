/**
 * Harvester - IP 地址池 (IPPool) 列表 Section
 * 展示 Harvester/Kube-OVN 中的 IPPool 资源，
 * 支持：
 * - 关键字过滤（名称 / 命名空间）
 * - 单个/批量删除地址池
 * - 打开 HarvesterResourceDrawer 查看原始资源详情
 * - 通过 IPPoolCreateModal 创建新的地址池
 */
import React, { useMemo, useState } from 'react';
import { Table, Button, message, Input, Modal, Select, Space, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined, GlobalOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import IPPoolCreateModal from '../modals/IPPoolCreateModal';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { deleteHarvesterIpPool } from '../../../../services/harvesterApi';
import { isSystemNamespace, isPublicNamespace } from '../../../../utils/harvesterUtils';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，用于调用地址池删除等 API
 * - ippools: 地址池列表，可能为原始对象或带 rawData 的包装对象
 * - loading: 外层传入的加载状态
 * - onRefresh: 刷新回调，支持传入 force=true
 */
interface Props {
  cloudId: string;
  ippools: any[];
  loading: boolean;
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  isTenant?: boolean;
  bordered?: boolean;
}

const IPPoolsSection: React.FC<Props> = ({ cloudId, ippools, loading, onRefresh, isTenant, bordered = true }) => {
  const { user } = useAuth();
  const canCreate = hasPermissionForAction(user?.permissions || [], 'clouds.nads:write');
  const [keyword, setKeyword] = useState<string>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [createVisible, setCreateVisible] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  // 表格行选择（批量删除）
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  /**
   * 将原始 IPPool 对象转换为表格使用的扁平结构
   * - 命名空间从 metadata.namespace / spec.selector.scope 中多种途径解析
   * - IP 范围支持 ranges / cidrs 两种存储方式
   * - selector 列直接序列化为 JSON 字符串，便于调试查看
   */
  const dataSource = useMemo(() => {
    return (ippools || []).map((pool: any) => {
      const raw = pool.rawData || pool;
      
      // 解析命名空间信息
      let namespace = '-';
      if (raw.metadata?.namespace || pool.namespace) {
        namespace = raw.metadata?.namespace || pool.namespace;
      } else if (raw.spec?.selector?.scope && Array.isArray(raw.spec.selector.scope)) {
        // 从 scope 中获取命名空间
        const scopeWithNamespace = raw.spec.selector.scope.find((s: any) => s?.namespace);
        if (scopeWithNamespace?.namespace) {
          namespace = scopeWithNamespace.namespace;
        }
      }
      
      // 解析 IP 范围/CIDR
      let rangesText = '-';
      if (raw.spec?.ranges && Array.isArray(raw.spec.ranges)) {
        const rangeTexts = raw.spec.ranges.map((r: any) => {
          if (r.subnet) {
            return r.subnet;
          } else if (r.rangeStart && r.rangeEnd) {
            return `${r.rangeStart}-${r.rangeEnd}`;
          } else if (r.start && r.end) {
            return `${r.start}-${r.end}`;
          }
          return '';
        }).filter(Boolean);
        rangesText = rangeTexts.join(', ') || '-';
      } else if (raw.spec?.cidrs && Array.isArray(raw.spec.cidrs)) {
        rangesText = raw.spec.cidrs.join(', ') || '-';
      }

      // 解析网络信息（从 selector.network 中提取）
      const network = raw.spec?.selector?.network || '-';

      return {
        key: raw.metadata?.uid || pool.id,
        name: raw.metadata?.name || pool.name,
        namespace: namespace,
        ranges: rangesText,
        network: network,
        selector: raw.spec?.selector ? JSON.stringify(raw.spec.selector) : '-', // 保留原始数据用于详情查看
        creationTimestamp: raw.metadata?.creationTimestamp || pool.createdAt,
        raw,
      };
    });
  }, [ippools]);

  /**
   * 根据关键字、命名空间进行过滤
   * 
   * [权限说明]
   * - 租户可以看到公共命名空间（default、cloud-public、harvester-public）的 IPPool，但不能删除它们
   * - 删除权限控制已在删除函数中实现
   */
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const ns = nsFilter.trim().toLowerCase();

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

      return true;
    });
  }, [dataSource, keyword, nsFilter, isTenant]);

  /**
   * 提取可用的命名空间选项（用于筛选下拉框）
   */
  const namespaceOptions = useMemo(() => {
    const nsSet = new Set<string>();
    dataSource.forEach((item: any) => {
      const ns = item.namespace;
      if (ns && ns !== '-' && !isSystemNamespace(ns)) { // 过滤系统命名空间
        nsSet.add(ns);
      }
    });
    return Array.from(nsSet).sort().map(ns => ({
      label: ns,
      value: ns
    }));
  }, [dataSource]);

  /**
   * 打开 HarvesterResourceDrawer 查看地址池原始对象详情
   */
  const handleOpenOpsinfo = (record: any) => {
    if (record?.raw) {
      setSelectedRecord(record.raw);
      setDrawerTab('detail');
      setDrawerOpen(true);
    }
  };

  /**
   * 删除单个地址池
   * - 针对特定错误信息（仍有已分配 IP）做用户友好的错误提示
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
      content: `确定要删除地址池 ${record.name} 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteHarvesterIpPool(cloudId, record.name);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          const errMsg = e.message || '';
          if (errMsg.includes("can't delete pool before releasing all the allocated IP")) {
            Modal.error({
              title: '删除失败',
              content: (
                <div>
                  <p>无法删除该地址池，因为其中仍有已分配的 IP 地址。</p>
                  <p>请先删除使用该地址池的 LoadBalancer 或其他服务，释放所有 IP 后再试。</p>
                  <div style={{ marginTop: 8, color: '#999', fontSize: 12, wordBreak: 'break-all' }}>
                    原始错误: {errMsg}
                  </div>
                </div>
              ),
            });
          } else {
            message.error(errMsg || '删除失败');
          }
        }
      }
    });
  };

  /**
   * 批量删除选中的地址池
   * - 遍历 selectedRowKeys 从 dataSource 中反查对应对象并执行删除
   * - 对"仍有 IP 被占用"的错误做统一处理
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
      message.warning(`选中的地址池无法删除：${reasons.join('，')}`);
      setSelectedRowKeys([]);
      return;
    }

    Modal.confirm({
      title: '确认批量删除',
      content: (
        <>
          <div>{`确定要删除选中的 ${deletableTargets.length} 个地址池吗？此操作不可恢复。`}</div>
          {systemTargets.length > 0 && (
            <div style={{ color: '#faad14', marginTop: 8 }}>
              {`注意：${systemTargets.length} 个系统命名空间的地址池将被跳过。`}
            </div>
          )}
          {publicTargets.length > 0 && (
            <div style={{ color: '#faad14', marginTop: 8 }}>
              {`注意：${publicTargets.length} 个公共命名空间的地址池将被跳过（租户不能删除公共命名空间的资源）。`}
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
            return deleteHarvesterIpPool(cloudId, item.name);
          });
          
          await Promise.all(promises);
          message.success('批量删除成功');
          setSelectedRowKeys([]);
          onRefresh?.(true);
        } catch (e: any) {
           const errMsg = e.message || '';
           if (errMsg.includes("can't delete pool before releasing all the allocated IP")) {
             Modal.error({
               title: '部分删除失败',
               content: (
                 <div>
                   <p>无法删除部分地址池，因为其中仍有已分配的 IP 地址。</p>
                   <p>请先删除使用该地址池的 LoadBalancer 或其他服务，释放所有 IP 后再试。</p>
                   <div style={{ marginTop: 8, color: '#999', fontSize: 12, wordBreak: 'break-all' }}>
                     原始错误: {errMsg}
                   </div>
                 </div>
               ),
             });
           } else {
             message.error(errMsg || '部分删除失败');
           }
           onRefresh?.(true);
        }
      }
    });
  };

  // 表格多选配置，仅记录选中的行 key
  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    getCheckboxProps: (record: any) => ({
      disabled: isSystemNamespace(record.namespace) || (isTenant && isPublicNamespace(record.namespace)),
    }),
  };

  /**
   * 表格列定义
   * - 名称列可点击打开 Harvester 详情抽屉
   * - 操作列支持单个删除
   */
  const columns = [
    { 
      title: '地址池名称', 
      dataIndex: 'name', 
      key: 'name', 
      render: (t: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <GlobalOutlined style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t}</span>
        </span>
      ) 
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { title: 'IP 范围/CIDR', dataIndex: 'ranges', key: 'ranges', ellipsis: true },
    { 
      title: '网络', 
      dataIndex: 'network', 
      key: 'network',
      render: (network: string) => {
        if (!network || network === '-') {
          return <span className="text-secondary">-</span>;
        }
        return <Tag color="blue">{network}</Tag>;
      }
    },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp' },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const isSys = isSystemNamespace(record.namespace);
        const isPublic = isPublicNamespace(record.namespace);
        const deleteDisabled = isSys || (isTenant && isPublic);
        return (
          <ResourceActionsDropdown 
            items={[
              ...(!isTenant ? [{
                key: 'opsinfo',
                label: '运维信息',
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
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNsFilter('');
            }}
          >
            重置
          </button>
        </Space>
      }
      toolbarRight={
        <>
          {selectedRowKeys.length > 0 && (
            <Button danger onClick={handleBatchDelete}>批量删除</Button>
          )}
          {canCreate && <Button type="primary" onClick={() => setCreateVisible(true)}>创建地址池</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading}></Button>
        </>
      }
    >
      <Table
        className="std-table"
        bordered={false}
        dataSource={filteredData}
        columns={columns}
        rowKey="key"
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowSelection={rowSelection}
      />
      <IPPoolCreateModal
        open={createVisible}
        cloudId={cloudId}
        onClose={() => setCreateVisible(false)}
        onSuccess={() => {
          // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，但后端会优先查询数据库）
          // 静默刷新，不显示提示信息
          onRefresh?.(true, true); // force=true, silent=true
        }}
      />

      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="IPPool"
        record={selectedRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default IPPoolsSection;
