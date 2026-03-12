/**
 * Harvester - GPU 资源列表 Section
 * 负责展示集群内探测到的 GPU/PCI 设备资源，
 * 提供类型（直通 / vGPU / SR-IOV）、状态和关键字过滤，以及元数据查看能力。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Table, Button, Space, Select, Tag, Input, Modal, Tabs } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，仅用于日志展示等场景（目前未直接参与逻辑）
 * - resources: 后端返回的 GPU 资源数组，可能为多种结构的聚合结果
 * - loading: 外层传入的加载状态
 * - onRefresh: 列表刷新回调，支持传入 force=true
 * - raw: 原始接口返回的完整数据，配合 showLog 进行调试展示
 * - showLog: 是否渲染底部的原始 JSON 调试信息
 */
interface Props {
  cloudId: string;
  resources: any[];
  loading?: boolean;
  onRefresh: (force?: boolean) => void | Promise<void>;
  raw?: any;
  showLog?: boolean;
}

const GpuSection: React.FC<Props> = ({ cloudId, resources, loading, onRefresh, raw, showLog }) => {
  // 筛选条件：类型、状态与关键字
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [bindFilter, setBindFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState<string>('');
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // 元数据弹窗状态，支持查看单条记录的 raw JSON
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);

  const handleShowMetadata = useCallback((record: any) => {
    setCurrentMetadata(record);
    setMetadataModalVisible(true);
  }, []);

  /**
   * 统一过滤逻辑
   * 1. 先按类型筛选（直通 / vGPU / SR-IOV / 全部）
   * 2. 再按状态筛选（活跃、非活跃、异常、变更中）
   * 3. 最后按关键字在多个字段（资源名/设备名/节点/IP/描述/厂商ID）中模糊匹配
   */
  const filtered = useMemo(() => {
    const arr = Array.isArray(resources) ? resources : [];
    const byType = typeFilter === 'all' ? arr : arr.filter((x: any) => String(x?.type) === typeFilter);
    const getState = (r: any) => {
      const s = r?.state || r?.metadata?.state || r?.status?.state || r?.raw?.metadata?.state || {};
      const name = String(s?.name || '').toLowerCase();
      const error = !!s?.error;
      const transitioning = !!s?.transitioning;
      return { name, error, transitioning };
    };
    const byStatus = byType.filter((r: any) => {
      if (statusFilter === 'all') return true;
      const s = getState(r);
      if (statusFilter === 'active') return s.name === 'active' && !s.error && !s.transitioning;
      if (statusFilter === 'inactive') return s.name === 'inactive';
      if (statusFilter === 'error') return s.error || s.name === 'error';
      if (statusFilter === 'transitioning') return s.transitioning;
      return true;
    });
    const byBind = byStatus.filter((r: any) => {
      if (bindFilter === 'all') return true;
      if (bindFilter === 'bound') return !!r?.claimed;
      if (bindFilter === 'unbound') return !r?.claimed;
      return true;
    });
    const kw = String(keyword || '').trim().toLowerCase();
    if (!kw) return byBind;
    return byBind.filter((r: any) => {
      const rid = String(r?.resourceName || r?.status?.resourceName || r?.raw?.status?.resourceName || '').toLowerCase();
      const nm = String(r?.name || r?.status?.deviceName || r?.raw?.status?.deviceName || '').toLowerCase();
      const node = String(r?.node || r?.status?.nodeName || r?.raw?.status?.nodeName || '').toLowerCase();
      const desc = String(r?.raw?.status?.description || r?.status?.description || '').toLowerCase();
      const bindTo = String(r?.bindingTo || '').toLowerCase();
      const claimName = String(r?.claimName || '').toLowerCase();
      const claimedBy = String(r?.claimedBy || '').toLowerCase();
      const fieldsArr = (r?.metadata?.fields || r?.fields);
      const fieldsAddr = Array.isArray(fieldsArr) && fieldsArr.length > 1 ? String(fieldsArr[1]).toLowerCase() : '';
      const addr = String(r?.pciAddress || r?.status?.pciAddress || r?.status?.address || r?.raw?.status?.address || r?.spec?.pciAddress || r?.address || fieldsAddr || '').toLowerCase();
      const vendorId = String(r?.raw?.status?.vendorId || r?.status?.vendorId || '').toLowerCase();
      return rid.includes(kw) || nm.includes(kw) || node.includes(kw) || addr.includes(kw) || desc.includes(kw) || vendorId.includes(kw) || bindTo.includes(kw) || claimName.includes(kw) || claimedBy.includes(kw);
    });
  }, [resources, typeFilter, statusFilter, bindFilter, keyword]);

  /**
   * 根据厂商 ID 映射常见 GPU 厂商名称
   * 未知 ID 则直接回显原始值
   */
  const vendorName = useCallback((id?: string) => {
    const v = String(id || '').toLowerCase();
    if (v === '10de') return 'NVIDIA';
    if (v === '1002') return 'AMD';
    if (v === '8086') return 'Intel';
    if (v === '1a03') return 'ASPEED';
    return v || '-';
  }, []);

  /**
   * 推导设备类型：
   * - 已有 type 字段直接使用
   * - Kubernetes PCI 设备推导为 passthrough
   * - 带有 mdevName 视为 vGPU
   */
  const deriveType = useCallback((x: any) => {
    const t = String(x?.type || '').toLowerCase();
    if (t) return t;
    const kind = String(x?.kind || '').toLowerCase();
    if (kind === 'pcidevice') return 'passthrough';
    const hasMdev = !!(x?.mdevName || x?.raw?.mdevName);
    if (hasMdev) return 'vgpu';
    return '';
  }, []);

  /**
   * 按设备类型返回带颜色的 Tag
   */
  const typeTag = useCallback((x: any) => {
    const m = String(deriveType(x) || '').toLowerCase();
    return m === 'passthrough' ? <Tag color="blue">直通</Tag> : m === 'vgpu' ? <Tag color="green">vGPU</Tag> : m === 'sriov' ? <Tag color="purple">SR-IOV</Tag> : <Tag>未知</Tag>;
  }, [deriveType]);

  /**
   * 表格列定义
   * - 针对不同数据源做了较多兜底读取，保证列表对多来源数据具备兼容性
   * - 操作列提供元数据查看与 SourceData 跳转
   */
  const allColumns = useMemo(() => [
    { title: '类型', key: 'type', render: (_: any, r: any) => typeTag(r) },
    { title: '资源名', key: 'resourceName', render: (_: any, r: any) => r?.resourceName || r?.status?.resourceName || r?.spec?.resourceName || r?.raw?.status?.resourceName || '-' },
    { title: '设备名', key: 'name', render: (_: any, r: any) => r?.name || r?.status?.deviceName || r?.spec?.deviceName || r?.metadata?.name || r?.raw?.status?.deviceName || '-' },
    { title: '节点', key: 'node', render: (_: any, r: any) => r?.node || r?.status?.nodeName || r?.spec?.nodeName || r?.raw?.status?.nodeName || '-' },
    { title: '配额', key: 'quota', render: (_: any, r: any) => {
      const q = r?.quota;
      const alloc = q?.allocatable;
      const used = q?.used;
      const free = q?.free;
      if (typeof alloc === 'number' && typeof free === 'number') return `${free}/${alloc}`;
      if (typeof alloc === 'number') return `${alloc}`;
      if (typeof free === 'number') return `${free}`;
      return '-';
    } },
    { title: '绑定到', key: 'binding', render: (_: any, r: any) => {
      if (!r?.claimed) return <Tag>未绑定</Tag>;
      const txt = r?.bindingTo || r?.claimedBy || r?.claimName || '已绑定';
      return <span style={{ wordBreak: 'break-word' }}>{String(txt)}</span>;
    } },
    { title: 'PCI地址', key: 'pci', render: (_: any, r: any) => {
      const fieldsArr = (r?.metadata?.fields || r?.fields);
      const fieldsAddr = Array.isArray(fieldsArr) && fieldsArr.length > 1 ? fieldsArr[1] : '';
      return r?.pciAddress || r?.status?.pciAddress || r?.status?.address || r?.spec?.pciAddress || r?.address || r?.raw?.status?.address || fieldsAddr || '-';
    } },
    { title: '厂商', key: 'vendor', render: (_: any, r: any) => vendorName(r?.raw?.status?.vendorId || r?.status?.vendorId) },
    { title: '设备ID', key: 'deviceId', render: (_: any, r: any) => r?.raw?.status?.deviceId || r?.status?.deviceId || '-' },
    { title: 'ClassID', key: 'classId', render: (_: any, r: any) => r?.raw?.status?.classId || r?.status?.classId || '-' },
    { title: '驱动', key: 'driver', render: (_: any, r: any) => r?.raw?.status?.kernelDriverInUse || r?.status?.kernelDriverInUse || '-' },
    { title: 'IOMMU组', key: 'iommu', render: (_: any, r: any) => r?.raw?.status?.iommuGroup || r?.status?.iommuGroup || '-' },
    { title: '描述', key: 'desc', render: (_: any, r: any) => r?.raw?.status?.description || r?.status?.description || '-' },
    { title: '状态', key: 'state', render: (_: any, r: any) => {
      const s = r?.state?.name || r?.metadata?.state?.name || r?.status?.state?.name || r?.raw?.metadata?.state?.name || '';
      if (!s) return '-';
      const lower = String(s).toLowerCase();
      const color = lower === 'active' ? 'green' : lower === 'inactive' ? 'default' : 'blue';
      return <Tag color={color}>{s}</Tag>;
    } },
    {
      title: '操作', key: 'actions', width: 80, align: 'left' as const, fixed: 'right' as const, render: (_: any, r: any) => {
        const items = [
          { key: 'metadata', label: '查看 MetaData', onClick: () => handleShowMetadata(r) },
          ...(r?.claimRaw ? [{ key: 'binding', label: '查看绑定', onClick: () => handleShowMetadata(r.claimRaw) }] : []),
          ...(r?.links?.view ? [{ key: 'view', label: '查看 SourceData', onClick: () => window.open(r.links.view, '_blank') }] : []),
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      }
    }
  ], [handleShowMetadata, typeTag, vendorName]);

  const [tableColumns, setTableColumns] = useState<any[]>(() => allColumns);



  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={(
          <>
            <Input allowClear placeholder="关键字" suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} className="toolbar-search" value={keyword} onChange={(e)=> setKeyword(e.target.value)} />
            <Select
              value={typeFilter}
              className="toolbar-filter-sm"
              options={[
                { value: 'all', label: '全部' },
                { value: 'passthrough', label: '直通 GPU' },
                { value: 'vgpu', label: 'vGPU' },
                { value: 'sriov', label: 'SR-IOV GPU' }
              ]}
              onChange={(v) => setTypeFilter(v)}
            />
            <Select
              value={statusFilter}
              className="toolbar-filter-sm"
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'active', label: '活跃' },
                { value: 'inactive', label: '非活跃' },
                { value: 'transitioning', label: '变更中' },
                { value: 'error', label: '异常/错误' }
              ]}
              onChange={(v) => setStatusFilter(v)}
            />
            <Select
              value={bindFilter}
              className="toolbar-filter-sm"
              options={[
                { value: 'all', label: '全部绑定' },
                { value: 'bound', label: '已绑定' },
                { value: 'unbound', label: '未绑定' },
              ]}
              onChange={(v) => setBindFilter(v)}
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setTypeFilter('all');
                setStatusFilter('all');
                setBindFilter('all');
              }}
            >
              重置
            </button>
          </>
        )}
        toolbarRight={(
          <>
            <TableColumnSettings 
              columns={allColumns} 
              onChange={setTableColumns}
              settingsKey="harvester_gpus_table"
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => onRefresh(true)}
              loading={loading}
            />
          </>
        )}
      >
        <Table
          className="std-table"
          bordered={false}
          loading={loading || refreshing}
          pagination={{
            size: 'small',
            showQuickJumper: false,
          }}
          rowKey={(r: any) => {
            const rid = r?.resourceName || r?.status?.resourceName || r?.spec?.resourceName || r?.metadata?.name || '';
            const fieldsArr = (r?.metadata?.fields || r?.fields);
            const fieldsAddr = Array.isArray(fieldsArr) && fieldsArr.length > 1 ? fieldsArr[1] : '';
            const addr = r?.pciAddress || r?.status?.pciAddress || r?.status?.address || r?.spec?.pciAddress || r?.address || fieldsAddr || '';
            const node = r?.node || r?.status?.nodeName || r?.spec?.nodeName || '';
            return `${rid}-${addr}-${node}`;
          }}
          dataSource={filtered}
          columns={tableColumns}
          locale={{ emptyText: '暂无数据' }}
        />
      </PageDetailSection>
      {/* Metadata Modal */}
      <Modal
        title="元数据查看"
        open={metadataModalVisible}
        onCancel={() => setMetadataModalVisible(false)}
        footer={null}
        width={800}
      >
        <Tabs items={[
            {
                key: 'json',
                label: 'Raw JSON',
                children: (
                    <Input.TextArea 
                        readOnly 
                        value={currentMetadata ? JSON.stringify(currentMetadata, null, 2) : ''} 
                        autoSize={{ minRows: 10, maxRows: 20 }}
                        className="metadata-viewer"
                    />
                )
            }
        ]} />
      </Modal>
      {showLog && (
        <div>
          <pre>{JSON.stringify(raw, null, 2)}</pre>
        </div>
      )}
    </>
  );
};

export default GpuSection;
