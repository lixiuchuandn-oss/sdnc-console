import React, { useMemo, useState } from 'react';
import { Table, Button, Space, Select, Tag, Input } from 'antd';
import PageDetailSection from '../../../../components/PageDetailSection';

interface Props {
  cloudId: string;
  resources: any[];
  onRefresh: () => void | Promise<void>;
  raw?: any;
  showLog?: boolean;
}

const GpuSection: React.FC<Props> = ({ cloudId, resources, onRefresh, raw, showLog }) => {
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState<string>('');
  const [refreshing, setRefreshing] = useState<boolean>(false);
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
    const kw = String(keyword || '').trim().toLowerCase();
    if (!kw) return byStatus;
    return byStatus.filter((r: any) => {
      const rid = String(r?.resourceName || r?.status?.resourceName || r?.raw?.status?.resourceName || '').toLowerCase();
      const nm = String(r?.name || r?.status?.deviceName || r?.raw?.status?.deviceName || '').toLowerCase();
      const node = String(r?.node || r?.status?.nodeName || r?.raw?.status?.nodeName || '').toLowerCase();
      const desc = String(r?.raw?.status?.description || r?.status?.description || '').toLowerCase();
      const fieldsArr = (r?.metadata?.fields || r?.fields);
      const fieldsAddr = Array.isArray(fieldsArr) && fieldsArr.length > 1 ? String(fieldsArr[1]).toLowerCase() : '';
      const addr = String(r?.pciAddress || r?.status?.pciAddress || r?.status?.address || r?.raw?.status?.address || r?.spec?.pciAddress || r?.address || fieldsAddr || '').toLowerCase();
      const vendorId = String(r?.raw?.status?.vendorId || r?.status?.vendorId || '').toLowerCase();
      return rid.includes(kw) || nm.includes(kw) || node.includes(kw) || addr.includes(kw) || desc.includes(kw) || vendorId.includes(kw);
    });
  }, [resources, typeFilter, statusFilter, keyword]);

  const vendorName = (id?: string) => {
    const v = String(id || '').toLowerCase();
    if (v === '10de') return 'NVIDIA';
    if (v === '1002') return 'AMD';
    if (v === '8086') return 'Intel';
    if (v === '1a03') return 'ASPEED';
    return v || '-';
  };

  const deriveType = (x: any) => {
    const t = String(x?.type || '').toLowerCase();
    if (t) return t;
    const kind = String(x?.kind || '').toLowerCase();
    if (kind === 'pcidevice') return 'passthrough';
    const hasMdev = !!(x?.mdevName || x?.raw?.mdevName);
    if (hasMdev) return 'vgpu';
    return '';
  };

  const typeTag = (x: any) => {
    const m = String(deriveType(x) || '').toLowerCase();
    return m === 'passthrough' ? <Tag color="blue">直通</Tag> : m === 'vgpu' ? <Tag color="green">vGPU</Tag> : m === 'sriov' ? <Tag color="purple">SR-IOV</Tag> : <Tag>未知</Tag>;
  };

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={(
          <>
            <Input allowClear placeholder="关键字" style={{ width: 240 }} value={keyword} onChange={(e)=> setKeyword(e.target.value)} />
            <Select
              value={typeFilter}
              style={{ width: 200 }}
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
              style={{ width: 200 }}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'active', label: '活跃' },
                { value: 'inactive', label: '非活跃' },
                { value: 'transitioning', label: '变更中' },
                { value: 'error', label: '异常/错误' }
              ]}
              onChange={(v) => setStatusFilter(v)}
            />
          </>
        )}
        toolbarRight={(
          <Button
            size="small"
            loading={refreshing}
            onClick={async () => {
              try { setRefreshing(true); await Promise.resolve(onRefresh()); }
              finally { setRefreshing(false); }
            }}
          >刷新</Button>
        )}
      >
        <Table
          className="kv-section-table"
          bordered
          loading={refreshing}
          pagination={{ pageSize: 10, size: 'default' }}
          rowKey={(r: any) => {
            const rid = r?.resourceName || r?.status?.resourceName || r?.spec?.resourceName || r?.metadata?.name || '';
            const fieldsArr = (r?.metadata?.fields || r?.fields);
            const fieldsAddr = Array.isArray(fieldsArr) && fieldsArr.length > 1 ? fieldsArr[1] : '';
            const addr = r?.pciAddress || r?.status?.pciAddress || r?.status?.address || r?.spec?.pciAddress || r?.address || fieldsAddr || '';
            const node = r?.node || r?.status?.nodeName || r?.spec?.nodeName || '';
            return `${rid}-${addr}-${node}`;
          }}
          dataSource={filtered}
          columns={[
            { title: '类型', key: 'type', render: (_: any, r: any) => typeTag(r) },
            { title: '资源名', key: 'resourceName', render: (_: any, r: any) => r?.resourceName || r?.status?.resourceName || r?.spec?.resourceName || r?.raw?.status?.resourceName || '-' },
            { title: '设备名', key: 'name', render: (_: any, r: any) => r?.name || r?.status?.deviceName || r?.spec?.deviceName || r?.metadata?.name || r?.raw?.status?.deviceName || '-' },
            { title: '节点', key: 'node', render: (_: any, r: any) => r?.node || r?.status?.nodeName || r?.spec?.nodeName || r?.raw?.status?.nodeName || '-' },
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
          ]}
          locale={{ emptyText: '暂无数据' }}
        />
      </PageDetailSection>
      {showLog && (
        <div>
          <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(raw, null, 2)}</pre>
        </div>
      )}
    </>
  );
};

export default GpuSection;
