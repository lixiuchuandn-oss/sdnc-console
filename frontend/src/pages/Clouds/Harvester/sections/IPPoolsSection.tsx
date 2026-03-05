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
import { Table, Button, message, Input, Modal } from 'antd';
import { ReloadOutlined,SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import IPPoolCreateModal from '../modals/IPPoolCreateModal';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { deleteHarvesterIpPool } from '../../../../services/harvesterApi';
import { isPublicNamespace } from '../../../../utils/harvesterUtils';

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
  onRefresh?: (force?: boolean) => void;
  isTenant?: boolean;
}

const IPPoolsSection: React.FC<Props> = ({ cloudId, ippools, loading, onRefresh, isTenant }) => {
  // 工具栏状态：关键字搜索、创建弹窗、详情抽屉
  const [keyword, setKeyword] = useState<string>('');
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

      return {
        key: raw.metadata?.uid || pool.id,
        name: raw.metadata?.name || pool.name,
        namespace: namespace,
        ranges: rangesText,
        selector: raw.spec?.selector ? JSON.stringify(raw.spec.selector) : '-',
        creationTimestamp: raw.metadata?.creationTimestamp || pool.createdAt,
        raw,
      };
    });
  }, [ippools]);

  /**
   * 根据关键字对名称 / 命名空间做包含匹配
   */
  const filteredData = useMemo(() => {
    let d = dataSource;
    if (isTenant) {
      d = d.filter((x: any) => !isPublicNamespace(x.namespace));
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || (x.namespace && x.namespace.toLowerCase().includes(k)));
    }
    return d;
  }, [dataSource, keyword, isTenant]);

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
   * - 对“仍有 IP 被占用”的错误做统一处理
   */
  const handleBatchDelete = () => {
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个地址池吗？此操作不可恢复。`,
      okText: '批量删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const promises = selectedRowKeys.map(key => {
            const item = dataSource.find(d => d.key === key);
            if (item) {
              return deleteHarvesterIpPool(cloudId, item.name);
            }
            return Promise.resolve();
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
  };

  /**
   * 表格列定义
   * - 名称列可点击打开 Harvester 详情抽屉
   * - 操作列支持单个删除
   */
  const columns = [
    { 
      title: '名称', 
      dataIndex: 'name', 
      key: 'name', 
      render: (t: string) => (
        <span style={{ fontWeight: 500 }}>
          {t}
        </span>
      ) 
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { title: 'IP 范围/CIDR', dataIndex: 'ranges', key: 'ranges', ellipsis: true },
    { title: '选择器', dataIndex: 'selector', key: 'selector', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp' },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          items={[
            ...(!isTenant ? [{
              key: 'opsinfo',
              label: '运维信息',
              onClick: () => handleOpenOpsinfo(record)
            }] : []),
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record) }
          ]}
        />
      ),
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <Input
          className="toolbar-search"
          placeholder="关键字"
          suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          allowClear
        />
      }
      toolbarRight={
        <>
          {selectedRowKeys.length > 0 && (
            <Button danger onClick={handleBatchDelete}>批量删除</Button>
          )}
          <Button type="primary" onClick={() => setCreateVisible(true)}>创建</Button>
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading}></Button>
        </>
      }
    >
      <Table
        className={!isTenant ? "std-table" : "std-table no-border"}
        bordered={!isTenant}
        dataSource={filteredData}
        columns={columns}
        rowKey="key"
        loading={loading}
        pagination={{
          size: 'small',
          showQuickJumper: false,
        }}
        rowSelection={rowSelection}
      />
      <IPPoolCreateModal
        open={createVisible}
        cloudId={cloudId}
        onClose={() => setCreateVisible(false)}
        onSuccess={() => onRefresh?.(true)}
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
