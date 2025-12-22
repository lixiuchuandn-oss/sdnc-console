import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Space, Table, Modal, Input, Select, Tag, Badge, Typography, Tooltip } from 'antd';
import { ReloadOutlined, HddOutlined, SearchOutlined, CopyOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../components/PageDetailSection';
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

const DiskSectionAliyun: React.FC<Props> = ({ cloudId, instance, disks, onSetDisks, onRefreshAll }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState<boolean>(false);
  const [local, setLocal] = useState<any[]>(Array.isArray(disks) ? disks : []);
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [payTypeFilter, setPayTypeFilter] = useState<string | undefined>(undefined);

  useEffect(() => { setLocal(Array.isArray(disks) ? disks : []); }, [disks]);

  const load = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json: any = await fetchCloudProviderDisks(cloudId);
      const list: any[] = json?.data?.Disks?.Disk || json?.disks || [];
      if (onSetDisks) onSetDisks(Array.isArray(list) ? list : []);
      else setLocal(Array.isArray(list) ? list : []);
      message.success('云硬盘已刷新');
    } catch (e: any) { message.error(e?.message || '查询云硬盘失败'); }
    finally { setLoading(false); }
  };

  const iid = String(instance?.InstanceId || instance?.id || '');
  
  const myDisks = useMemo(() => {
    const list = Array.isArray(disks) ? disks : local;
    let targetList = list || [];
    
    // 如果指定了实例，先过滤出属于该实例的磁盘
    if (iid || instance) {
      targetList = targetList.filter((d: any) => {
        const atts1: any[] = Array.isArray(d?.Attachments?.Attachment) ? d.Attachments.Attachment : [];
        const atts2: any[] = Array.isArray(d?.attachments) ? d.attachments : [];
        const matchAtt = [...atts1, ...atts2].some((a: any) => {
          const rid = a?.InstanceId || a?.server_id || a?.instance_id;
          return String(rid || '') === iid;
        });
        const rid = d?.InstanceId || d?.instance_id || '';
        return matchAtt || (String(rid || '') === iid);
      });
    }

    // 应用前端过滤
    return targetList.filter((r: any) => {
      const kw = keyword.trim().toLowerCase();
      const name = String(r?.DiskName || r?.name || r?.Name || '').toLowerCase();
      const id = String(r?.DiskId || r?.id || '').toLowerCase();
      const okKw = !kw || name.includes(kw) || id.includes(kw);

      const st = String(r?.Status || r?.status || '');
      const okSt = !statusFilter || st === statusFilter;

      const cat = String(r?.Category || r?.Type || r?.type || r?.VolumeType || '');
      const okCat = !categoryFilter || cat === categoryFilter;

      const cm = String(r?.InstanceChargeType || r?.charge_type || '');
      const okPay = !payTypeFilter || cm === payTypeFilter;

      return okKw && okSt && okCat && okPay;
    });
  }, [disks, local, iid, instance, keyword, statusFilter, categoryFilter, payTypeFilter]);

  // 提取筛选选项
  const statusOptions = useMemo(() => {
    const all = new Set<string>();
    (Array.isArray(disks) ? disks : local || []).forEach((d: any) => {
      const s = d?.Status || d?.status;
      if (s) all.add(s);
    });
    return Array.from(all).map(s => ({ label: diskStatusMap[s]?.text || s, value: s }));
  }, [disks, local]);

  const categoryOptions = useMemo(() => {
    const all = new Set<string>();
    (Array.isArray(disks) ? disks : local || []).forEach((d: any) => {
      const c = d?.Category || d?.Type || d?.type || d?.VolumeType;
      if (c) all.add(c);
    });
    return Array.from(all).map(c => ({ label: diskCategoryMap[c] || c, value: c }));
  }, [disks, local]);

  const columns = useMemo(() => [
    { 
      title: '磁盘', 
      key: 'info', 
      width: 220,
      render: (_: any, r: any) => {
        const name = r?.DiskName || r?.name || r?.Name || '-';
        const id = r?.DiskId || r?.id || '-';
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
        const s = r?.Status || r?.status || '-';
        const map = diskStatusMap[s] || { status: 'default', text: s };
        return <Badge status={map.status} text={map.text} />;
      } 
    },
    { 
      title: '容量', 
      key: 'size', 
      width: 100,
      render: (_: any, r: any) => {
        const sz = r?.Size != null ? r.Size : r?.size;
        return sz != null ? <span style={{ fontWeight: 500 }}>{sz} GB</span> : '-';
      },
      sorter: (a: any, b: any) => (Number(a?.Size ?? a?.size ?? 0) - Number(b?.Size ?? b?.size ?? 0))
    },
    { 
      title: '类型', 
      key: 'category', 
      width: 180,
      render: (_: any, r: any) => {
        const cat = r?.Category || r?.Type || r?.type || r?.VolumeType;
        const pl = r?.PerformanceLevel; // PL0, PL1, etc.
        const encrypted = r?.Encrypted;
        return (
          <Space direction="vertical" size={2}>
            <span>{diskCategoryMap[cat] || cat || '-'}</span>
            <Space size={4}>
              {pl && <Tag bordered={false} color="blue" style={{ margin: 0 }}>{pl}</Tag>}
              {encrypted && <Tag bordered={false} color="purple" style={{ margin: 0 }}>加密</Tag>}
              {r?.Portable && <Tag bordered={false} style={{ margin: 0 }}>可卸载</Tag>}
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
        const t = r?.InstanceChargeType || r?.charge_type;
        return t === 'PrePaid' ? <Tag color="orange">包年包月</Tag> : <Tag>按量付费</Tag>;
      } 
    },
    { 
      title: '挂载点', 
      key: 'device', 
      render: (_: any, r: any) => {
        const atts1: any[] = Array.isArray(r?.Attachments?.Attachment) ? r.Attachments.Attachment : [];
        const atts2: any[] = Array.isArray(r?.attachments) ? r.attachments : [];
        const allAtts = [...atts1, ...atts2];
        
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
        const t = r?.CreationTime || r?.created_at || r?.createdAt;
        if (!t) return '-';
        try {
          return new Date(t).toLocaleString('zh-CN', { hour12: false }); 
        } catch { return t; }
      },
      sorter: (a: any, b: any) => String(a?.CreationTime || '').localeCompare(String(b?.CreationTime || ''))
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
            options={[{ label: '包年包月', value: 'PrePaid' }, { label: '按量付费', value: 'PostPaid' }]}
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
        loading={loading}
        rowKey={(r: any) => r?.DiskId || r?.id}
        columns={columns as any}
        dataSource={myDisks}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        scroll={{ x: 1000 }}
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
    const myDisks = (list || []).filter((d: any) => {
      const atts1: any[] = Array.isArray(d?.Attachments?.Attachment) ? d.Attachments.Attachment : [];
      const atts2: any[] = Array.isArray(d?.attachments) ? d.attachments : [];
      const rid = d?.InstanceId || d?.instance_id || '';
      const matchAtt = [...atts1, ...atts2].some((a: any) => String(a?.InstanceId || a?.server_id || a?.instance_id || '') === iid);
      return matchAtt || (String(rid || '') === iid);
    });
    return myDisks.length;
  },
};
export default DiskSectionAliyun;
