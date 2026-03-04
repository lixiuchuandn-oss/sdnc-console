/**
 * Harvester - Service 列表 Section
 * 展示集群中的 Service 资源（包括 ClusterIP / NodePort / LoadBalancer 等），
 * 支持：
 * - 按名称/命名空间关键字过滤
 * - 按 Service 类型过滤
 * - 打开 HarvesterResourceDrawer 查看 Service 详情
 */
import React, { useMemo, useState } from 'react';
import { Table, Button, Input, Select } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，用于在详情抽屉中进一步读取事件等信息
 * - services: Service 列表，可能为原生对象或带 rawData 的包装对象
 * - loading: 外层传入的加载状态
 * - onRefresh: 手动刷新回调，支持 force=true
 */
interface Props {
  cloudId: string;
  services: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const ServicesSection: React.FC<Props> = ({ cloudId, services, loading, onRefresh }) => {
  // 工具栏过滤及详情抽屉状态
  const [keyword, setKeyword] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');
  
  /**
   * 将后端返回的 Service 数据统一转换为表格行
   * - 端口字段拼接为 "port:targetPort/protocol"
   * - 外部 IP 从 status.loadBalancer.ingress 提取
   */
  const dataSource = useMemo(() => {
    return (services || []).map((s: any, index: number) => {
      const raw = s.rawData || s;
      const ports = (raw.spec?.ports || []).map((p: any) => `${p.port}:${p.targetPort}/${p.protocol}`).join(', ');
      const externalIPs = (raw.status?.loadBalancer?.ingress || []).map((i: any) => i.ip || i.hostname).join(', ');
      const name = raw.metadata?.name || s.name;
      const namespace = raw.metadata?.namespace || s.namespace;
      const uid = raw.metadata?.uid || s.id;
      const stableId = uid || ((namespace || name) ? `${namespace || ''}/${name || ''}` : '');

      return {
        key: stableId || `service_${index}`,
        name,
        namespace,
        type: raw.spec?.type || '-',
        clusterIP: raw.spec?.clusterIP || '-',
        externalIPs: externalIPs || '-',
        ports: ports || '-',
        creationTimestamp: raw.metadata?.creationTimestamp || s.createdAt,
        raw,
        originalRecord: s, // 保留原始数据库记录
      };
    });
  }, [services]);

  /**
   * 前端过滤逻辑
   * - 关键字：匹配名称/命名空间
   * - 类型：匹配 Service.spec.type
   */
  const filteredData = useMemo(() => {
    let d = dataSource;
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    if (typeFilter && typeFilter !== 'All') {
      d = d.filter((x: any) => x.type === typeFilter);
    }
    return d;
  }, [dataSource, keyword, typeFilter]);

  // 根据当前数据自动生成类型过滤选项（包含 All）
  const serviceTypes = useMemo(() => {
    const types = new Set(dataSource.map((d: any) => d.type).filter((t: string) => t !== '-'));
    return ['All', ...Array.from(types)];
  }, [dataSource]);

  /**
   * 表格列定义
   * - 名称列可点击打开 Service 详情抽屉
   * - 类型列通过 std-badge 区分不同类型
   */
  const allColumns = useMemo(() => [
    { 
      title: '名称', 
      dataIndex: 'name', 
      key: 'name',
      render: (text: string, record: any) => (
        <span
          className="cell-link"
          onClick={() => {
            setSelectedRecord(record);
            setDrawerActiveTab('detail');
            setDrawerOpen(true);
          }}
        >
          {text}
        </span>
      )
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { 
      title: '类型', 
      dataIndex: 'type', 
      key: 'type', 
      render: (t: string) => {
        let badgeClass = 'std-badge-default';
        if (t === 'LoadBalancer') badgeClass = 'std-badge-success';
        else if (t === 'NodePort') badgeClass = 'std-badge-warning';
        else if (t === 'ClusterIP') badgeClass = 'std-badge-info';
        
        return (
          <span className={`std-badge ${badgeClass}`}>
            {t}
          </span>
        );
      } 
    },
    { title: 'Cluster IP', dataIndex: 'clusterIP', key: 'clusterIP' },
    { title: '外部 IP', dataIndex: 'externalIPs', key: 'externalIPs' },
    { title: '端口', dataIndex: 'ports', key: 'ports', ellipsis: true },
    { 
      title: '创建时间', 
      dataIndex: 'creationTimestamp', 
      key: 'creationTimestamp',
      render: (t: string) => <span className="std-time">{t}</span>
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          items={[
            { key: 'detail', label: '资源详情', onClick: () => {
              setSelectedRecord(record);
              setDrawerActiveTab('detail');
              setDrawerOpen(true);
            }}
          ]}
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ),
    },
  ], []);

  const [tableColumns, setTableColumns] = useState<any[]>(allColumns);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input 
            allowClear 
            placeholder="搜索名称或命名空间" 
            value={keyword}
            onChange={e => { setKeyword(e.target.value); setPagination(p=>({...p, current:1})); }}
            className="toolbar-search" 
          />
          <Select
            value={typeFilter}
            onChange={v => { setTypeFilter(v); setPagination(p=>({...p, current:1})); }}
            options={serviceTypes.map(t => ({ label: t === 'All' ? '所有类型' : t, value: t }))}
            className="toolbar-filter-sm"
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => { setKeyword(''); setTypeFilter('All'); setPagination(p=>({...p, current:1})); }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <div className="toolbar-actions">
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_services_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </div>
      }
    >
      <Table
        className="std-table"
        bordered
        dataSource={filteredData}
        columns={tableColumns}
        rowKey={(r) => r?.key || `${r?.namespace || ''}/${r?.name || ''}`}
        loading={loading}
        pagination={{
          size: 'small',
          showQuickJumper: false,
        }}

      />
      
      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="Service"
        record={selectedRecord ? { ...selectedRecord.originalRecord, kind: 'Service' } : null}
        cloudId={cloudId}
        activeTab={drawerActiveTab}
        onTabChange={setDrawerActiveTab}
      />
    </PageDetailSection>
  );
};

export default ServicesSection;
