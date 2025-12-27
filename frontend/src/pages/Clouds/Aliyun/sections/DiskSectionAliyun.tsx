import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { App, Button, Space, Table, Modal, Input, Select, Tag, Badge, Typography } from 'antd';
import { ReloadOutlined, HddOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { fetchCloudProviderDisks } from '../../../../services/api';

type Props = {
  cloudId: string;
  instance: any;
  disks?: any[];
  onSetDisks?: (list: any[]) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const diskStatusMap: Record<string, { status: 'success' | 'processing' | 'error' | 'default' | 'warning', text: string }> = {
  In_use: { status: 'success', text: '使用中' },
  Available: { status: 'processing', text: '待挂载' },
  Attaching: { status: 'warning', text: '挂载中' },
  Detaching: { status: 'warning', text: '卸载中' },
  Creating: { status: 'processing', text: '创建中' },
  ReIniting: { status: 'processing', text: '初始化中' },
};

const diskCategoryMap: Record<string, string> = {
  cloud: '普通云盘',
  cloud_efficiency: '高效云盘',
  cloud_ssd: 'SSD云盘',
  cloud_essd: 'ESSD云盘',
  cloud_auto: 'ESSD AutoPL',
  ephemeral_ssd: '本地SSD',
  ephemeral: '本地磁盘',
};

const chargeTypeLabelMap: Record<string, string> = {
  PrePaid: '包年包月',
  PostPaid: '按量付费',
};

const ensureArray = <T,>(v: T | T[] | undefined | null): T[] => {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
};

const isTrue = (v: any) => v === true || v === 'true' || v === 1 || v === '1';

const getDiskId = (r: any) => r?.DiskId || r?.id || '';
const getDiskName = (r: any) => r?.DiskName || r?.name || r?.Name || '';
const getDiskStatus = (r: any) => r?.Status || r?.status || '';
const getDiskCategory = (r: any) => r?.Category || r?.VolumeType || r?.volumeType || '';
const getDiskChargeType = (r: any) => r?.InstanceChargeType || r?.charge_type || '';
const getDiskSize = (r: any) => (r?.Size != null ? r.Size : r?.size);
const getDiskZone = (r: any) => r?.ZoneId || r?.zone || '';
const getDiskCreationTime = (r: any) => r?.CreationTime || r?.created_at || r?.createdAt || '';
const getDiskAttachments = (r: any): any[] => {
  const atts1 = ensureArray<any>(r?.Attachments?.Attachment);
  const atts2 = ensureArray<any>(r?.attachments);
  return [...atts1, ...atts2].filter(Boolean);
};

const getAliyunDiskTypeLabel = (r: any) => {
  const t = String(r?.Type || r?.type || '').toLowerCase();
  if (t === 'system') return '系统盘';
  if (t === 'data') return '数据盘';
  return '';
};

const filterDisksForInstance = (list: any[], instanceId: string) => {
  if (!instanceId) return Array.isArray(list) ? list : [];
  const iid = String(instanceId || '');
  return (Array.isArray(list) ? list : []).filter((d: any) => {
    const allAtts = getDiskAttachments(d);
    const matchAtt = allAtts.some((a: any) => {
      const rid = a?.InstanceId || a?.server_id || a?.instance_id;
      return String(rid || '') === iid;
    });
    const rid = d?.InstanceId || d?.instance_id || '';
    return matchAtt || (String(rid || '') === iid);
  });
};

const DiskSectionAliyun: React.FC<Props> = ({ cloudId, instance, disks, onSetDisks, onRefreshAll }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState<boolean>(false);
  const [local, setLocal] = useState<any[]>(Array.isArray(disks) ? disks : []);
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [payTypeFilter, setPayTypeFilter] = useState<string | undefined>(undefined);

  useEffect(() => { setLocal(Array.isArray(disks) ? disks : []); }, [disks]);

  const load = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json: any = await fetchCloudProviderDisks(cloudId);
      const raw = json?.data?.Disks?.Disk ?? json?.disks;
      const list: any[] = ensureArray<any>(raw);
      if (onSetDisks) onSetDisks(Array.isArray(list) ? list : []);
      else setLocal(Array.isArray(list) ? list : []);
      message.success('云硬盘已刷新');
    } catch (e: any) { message.error(e?.message || '查询云硬盘失败'); }
    finally { setLoading(false); }
  }, [cloudId, message, onSetDisks]);

  const iid = String(instance?.InstanceId || instance?.id || '');

  const sourceList = useMemo(() => (Array.isArray(disks) ? disks : (local || [])), [disks, local]);
  const instanceDisks = useMemo(() => filterDisksForInstance(sourceList, iid), [sourceList, iid]);

  const deferredKeyword = useDeferredValue(keyword);

  const myDisks = useMemo(() => {
    const kw = deferredKeyword.trim().toLowerCase();
    return instanceDisks.filter((r: any) => {
      const name = String(getDiskName(r) || '').toLowerCase();
      const id = String(getDiskId(r) || '').toLowerCase();
      const okKw = !kw || name.includes(kw) || id.includes(kw);

      const st = String(getDiskStatus(r) || '');
      const okSt = !statusFilter || st === statusFilter;

      const cat = String(getDiskCategory(r) || '');
      const okCat = !categoryFilter || cat === categoryFilter;

      const cm = String(getDiskChargeType(r) || '');
      const okPay = !payTypeFilter || cm === payTypeFilter;

      return okKw && okSt && okCat && okPay;
    });
  }, [instanceDisks, deferredKeyword, statusFilter, categoryFilter, payTypeFilter]);

  // 提取筛选选项
  const statusOptions = useMemo(() => {
    const all = new Set<string>();
    instanceDisks.forEach((d: any) => {
      const s = getDiskStatus(d);
      if (s) all.add(s);
    });
    return Array.from(all).map(s => ({ label: diskStatusMap[s]?.text || s, value: s }));
  }, [instanceDisks]);

  const categoryOptions = useMemo(() => {
    const all = new Set<string>();
    instanceDisks.forEach((d: any) => {
      const c = getDiskCategory(d);
      if (c) all.add(c);
    });
    return Array.from(all).map(c => ({ label: diskCategoryMap[c] || c, value: c }));
  }, [instanceDisks]);

  const payTypeOptions = useMemo(() => {
    const all = new Set<string>();
    instanceDisks.forEach((d: any) => {
      const c = getDiskChargeType(d);
      if (c) all.add(c);
    });
    const list = Array.from(all).map(v => ({ label: chargeTypeLabelMap[v] || v, value: v }));
    const order = ['PrePaid', 'PostPaid'];
    list.sort((a, b) => {
      const ai = order.indexOf(a.value);
      const bi = order.indexOf(b.value);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return String(a.label).localeCompare(String(b.label));
    });
    return list;
  }, [instanceDisks]);

  const columns = useMemo(() => [
    { 
      title: '磁盘', 
      key: 'info', 
      width: 220,
      render: (_: any, r: any) => {
        const name = getDiskName(r) || '-';
        const id = getDiskId(r) || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: id }}>
              {id}
            </Typography.Text>
          </Space>
        );
      } 
    },
    { 
      title: '状态', 
      dataIndex: 'Status', 
      key: 'status', 
      width: 100,
      render: (_: any, r: any) => {
        const s = getDiskStatus(r) || '-';
        const map = diskStatusMap[s] || { status: 'default', text: s };
        return <Badge status={map.status} text={map.text} />;
      } 
    },
    { 
      title: '容量', 
      key: 'size', 
      width: 100,
      render: (_: any, r: any) => {
        const sz = getDiskSize(r);
        return sz != null ? <span style={{ fontWeight: 500 }}>{sz} GB</span> : '-';
      },
      sorter: (a: any, b: any) => (Number(getDiskSize(a) ?? 0) - Number(getDiskSize(b) ?? 0))
    },
    { 
      title: '类型', 
      key: 'category', 
      width: 180,
      render: (_: any, r: any) => {
        const cat = getDiskCategory(r);
        const pl = r?.PerformanceLevel; // PL0, PL1, etc.
        const encrypted = isTrue(r?.Encrypted) || isTrue(r?.encrypted);
        const diskTypeLabel = getAliyunDiskTypeLabel(r);
        return (
          <Space direction="vertical" size={2}>
            <span>{diskCategoryMap[cat] || cat || '-'}</span>
            <Space size={4}>
              {diskTypeLabel && <Tag bordered={false} style={{ margin: 0 }}>{diskTypeLabel}</Tag>}
              {pl && <Tag bordered={false} color="blue" style={{ margin: 0 }}>{pl}</Tag>}
              {encrypted && <Tag bordered={false} color="purple" style={{ margin: 0 }}>加密</Tag>}
              {(isTrue(r?.Portable) || isTrue(r?.portable)) && <Tag bordered={false} style={{ margin: 0 }}>可卸载</Tag>}
            </Space>
          </Space>
        );
      } 
    },
    { 
      title: '付费模式', 
      key: 'charge', 
      width: 100,
      render: (_: any, r: any) => {
        const t = getDiskChargeType(r);
        if (!t) return '-';
        if (t === 'PrePaid') return <Tag color="orange">{chargeTypeLabelMap[t] || t}</Tag>;
        return <Tag>{chargeTypeLabelMap[t] || t}</Tag>;
      } 
    },
    { 
      title: '可用区', 
      key: 'zone', 
      width: 120,
      render: (_: any, r: any) => {
        const z = getDiskZone(r);
        return z || '-';
      },
      sorter: (a: any, b: any) => String(getDiskZone(a) || '').localeCompare(String(getDiskZone(b) || '')),
    },
    { 
      title: '挂载点', 
      key: 'device', 
      render: (_: any, r: any) => {
        const allAtts = getDiskAttachments(r);
        
        if (allAtts.length === 0) return <Typography.Text type="secondary">未挂载</Typography.Text>;

        // 如果是实例详情视图，只显示当前实例的挂载点
        if (iid) {
          const att = allAtts.find((a: any) => String(a?.InstanceId || a?.server_id || a?.instance_id || '') === iid);
          return att ? <Tag>{att?.Device || att?.device || '-'}</Tag> : <Typography.Text type="secondary">未挂载</Typography.Text>;
        }
        
        // 否则显示所有挂载点
        return (
          <Space direction="vertical" size={2}>
            {allAtts.map((a: any, idx: number) => (
              <div key={idx} style={{ fontSize: 12 }}>
                <Typography.Text type="secondary">{a?.InstanceId || a?.instance_id}: </Typography.Text>
                <Tag style={{ margin: 0 }}>{a?.Device || a?.device || '-'}</Tag>
              </div>
            ))}
          </Space>
        );
      } 
    },
    { 
      title: '创建时间', 
      key: 'time', 
      width: 160,
      render: (_: any, r: any) => {
        const t = getDiskCreationTime(r);
        if (!t) return '-';
        try {
          return new Date(t).toLocaleString('zh-CN', { hour12: false }); 
        } catch { return t; }
      },
      sorter: (a: any, b: any) => {
        const at = getDiskCreationTime(a);
        const bt = getDiskCreationTime(b);
        const an = Date.parse(String(at || ''));
        const bn = Date.parse(String(bt || ''));
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
        return String(at || '').localeCompare(String(bt || ''));
      }
    },
    { 
      title: '操作', 
      key: 'actions', 
      fixed: 'right',
      width: 80,
      render: (_: any, r: any) => {
        const items = [
          { key: 'detail', label: '详情' },
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }) => {
              if (key === 'detail') {
                Modal.info({
                  title: '磁盘详情',
                  width: 600,
                  content: (
                    <pre style={{ maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 10, borderRadius: 4 }}>
                      {JSON.stringify(r, null, 2)}
                    </pre>
                  ),
                  maskClosable: true,
                });
              }
            }}
          />
        );
      } 
    },
  ], [iid]);

  return (
    <PageDetailSection
      toolbarLeft={(
        <Space wrap>
          <Input 
            prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.25)' }} />} 
            placeholder="搜索名称/ID" 
            allowClear 
            value={keyword} 
            onChange={e => setKeyword(e.target.value)} 
            style={{ width: 200 }} 
          />
          <Select 
            placeholder="状态" 
            allowClear 
            value={statusFilter} 
            onChange={setStatusFilter} 
            options={statusOptions} 
            style={{ width: 120 }} 
            dropdownMatchSelectWidth={false}
          />
          <Select 
            placeholder="磁盘类型" 
            allowClear 
            value={categoryFilter} 
            onChange={setCategoryFilter} 
            options={categoryOptions} 
            style={{ width: 140 }} 
            dropdownMatchSelectWidth={false}
          />
          <Select
            placeholder="付费类型"
            allowClear
            value={payTypeFilter}
            onChange={setPayTypeFilter}
            options={payTypeOptions}
            style={{ width: 120 }}
          />
        </Space>
      )}
      toolbarRight={(
        <Space>
          <Button icon={<ReloadOutlined />} onClick={async () => { await load(); if (onRefreshAll) await onRefreshAll(); }} />
        </Space>
      )}
    >
      <Table
        bordered={false}
        tableLayout="auto"
        loading={loading}
        rowKey={(r: any, idx: number | undefined) => String(getDiskId(r) || idx || 0)}
        columns={columns as any}
        dataSource={myDisks}
        pagination={{ pageSize: 10, size: 'default', showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        scroll={{ x: 1100 }}
      />
    </PageDetailSection>
  );
};

export const Icon = <HddOutlined />;
export const Label = '云硬盘';
;(DiskSectionAliyun as any).tabMeta = {
  key: 'disks',
  title: Label,
  icon: <HddOutlined style={{ color: '#1677FF' }} />,
  countOf: (p: any) => {
    const iid = String(p?.instance?.InstanceId || p?.instance?.id || '');
    const list: any[] = Array.isArray(p?.disks) ? p.disks : [];
    if (!iid) return list.length;
    return filterDisksForInstance(list || [], iid).length;
  },
};
export default DiskSectionAliyun;
