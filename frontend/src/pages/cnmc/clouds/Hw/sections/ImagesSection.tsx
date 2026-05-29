import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { FileImageOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { fetchHuaweiImages } from '../../../../../services/huaweiApi';

type Props = {
  cloudId: string;
  images: any[];
  onSetImages: (list: any[]) => void;
};

const imagetypeOptions = [
  { label: '公共镜像', value: 'gold' },
  { label: '私有镜像', value: 'private' },
  { label: '共享镜像', value: 'shared' },
  { label: '市场镜像', value: 'market' },
];
const imagetypeLabel: Record<string, string> = { gold: '公共', private: '私有', shared: '共享', market: '市场' };

const parseImageList = (json: any): any[] => (json?.data?.images) || (json?.images) || [];

const ImagesSection: React.FC<Props> = ({ cloudId, images, onSetImages }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [imagetype, setImagetype] = useState<string>('gold');
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = async (typ?: string) => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchHuaweiImages(cloudId, { imagetype: typ ?? imagetype });
      onSetImages(parseImageList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (cloudId && (!images || images.length === 0)) refresh(); }, [cloudId]);

  const filtered = useMemo(() => {
    const list = Array.isArray(images) ? images : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => !kw || `${r?.name || ''} ${r?.id || ''} ${r?.os_version || ''}`.toLowerCase().includes(kw));
  }, [images, keyword]);

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 260,
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
      title: '操作系统', key: 'os', width: 220,
      render: (_: any, r: any) => {
        const os = r?.os_version || r?.__os_version || r?.platform || '-';
        const bit = r?.__os_bit ? `${r.__os_bit}位` : '';
        return <Typography.Text ellipsis={{ tooltip: `${os} ${bit}` }}>{os}{bit ? ` (${bit})` : ''}</Typography.Text>;
      },
    },
    { title: '类型', key: 'imagetype', width: 100, render: (_: any, r: any) => { const t = r?.__imagetype || ''; return t ? <Tag color={t === 'private' ? 'blue' : 'default'}>{imagetypeLabel[t] || t}</Tag> : '-'; } },
    { title: '最小磁盘', key: 'min_disk', width: 100, render: (_: any, r: any) => (r?.min_disk != null ? `${r.min_disk} GB` : '-') },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (s: string) => s || '-' },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 70,
      render: (_: any, r: any) => (
        <RowActionsButton items={[{ key: 'detail', label: '详情' }]} onClick={({ key }: { key: string }) => { if (key === 'detail') Modal.info({ title: '镜像详情', width: 600, maskClosable: true, content: (<pre style={{ maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 10 }}>{JSON.stringify(r, null, 2)}</pre>) }); }} />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), []);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / 系统" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" value={imagetype} onChange={(v) => { setImagetype(v); refresh(v); }} options={imagetypeOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => setKeyword('')}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={() => refresh()} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table className="std-table" bordered={false} rowKey={(r: any) => r?.id} dataSource={filtered} columns={columns as any} loading={loading} scroll={{ x: true }} pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }} />
    </PageDetailSection>
  );
};

export const Icon = <FileImageOutlined />;
export const Label = '镜像';
export default ImagesSection;
