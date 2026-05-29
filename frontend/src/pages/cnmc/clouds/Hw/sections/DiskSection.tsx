import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Space, Table, Tooltip, Typography } from 'antd';
import { HddOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderDisks } from '../../../../../services/api';
import { statusTag, tagsToText } from '../components/Common';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';

type DiskSectionProps = {
  cloudId: string;
  disks: any[];
  onSetDisks: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const parseDiskList = (json: any): any[] => (json?.data?.volumes) || (json?.volumes) || [];

const DiskSection: React.FC<DiskSectionProps> = ({ cloudId, disks, onSetDisks, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderDisks(cloudId);
      onSetDisks(parseDiskList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(disks) ? disks : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.name || ''} ${r?.id || ''} ${r?.volume_type || ''} ${r?.size || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [disks, keyword, statusFilter]);

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.name || '-';
        const id = r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '容量/类型', key: 'size_type', width: 160,
      sorter: (a: any, b: any) => Number(a?.size || 0) - Number(b?.size || 0),
      render: (_: any, r: any) => {
        const size = r?.size; const tp = r?.volume_type;
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{(size != null && size !== '') ? `${size} GB` : '-'}</Typography.Text>
            {tp && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tp}</Typography.Text>}
          </Space>
        );
      },
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: (s: string) => statusTag(s) },
    {
      title: '挂载实例/设备', key: 'attach', ellipsis: true,
      render: (_: any, r: any): React.ReactNode => {
        const atts: any[] = Array.isArray(r?.attachments) ? r?.attachments : [];
        const list = atts.map((a: any) => `${a?.server_id || a?.instance_id || '-'}（${a?.device || '-'}）`).filter(Boolean);
        return list.length ? <Typography.Text ellipsis={{ tooltip: list.join('；') }}>{list.join('；')}</Typography.Text> : <Typography.Text type="secondary">未挂载</Typography.Text>;
      },
    },
    {
      title: '可用区/加密', key: 'az_enc', width: 160,
      render: (_: any, r: any): React.ReactNode => {
        const az = r?.availability_zone || r?.zone || r?.ZoneId || '-';
        const enc = r?.encrypted === true ? '是' : r?.encrypted === false ? '否' : '-';
        return `${az}；加密 ${enc}`;
      },
    },
    { title: '标签', key: 'tags', width: 160, ellipsis: true, render: (_: any, r: any) => tagsToText(r?.tags) || '-' },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[{ key: 'detail', label: '详情' }]}
          onClick={async ({ key }) => { if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || '-'; onOpenDetail('disk', `云盘 ${name}（${id}）`, r); } }}
        />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [onOpenDetail]);

  const statusOptions = useMemo(() => Array.from(new Set((disks || []).map((r: any) => String(r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [disks]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / 类型" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="状态" allowClear value={statusFilter} onChange={setStatusFilter} options={statusOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setStatusFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.id}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />
    </PageDetailSection>
  );
};

export const Icon = <HddOutlined />;
export const Label = '云盘';
export default DiskSection;
