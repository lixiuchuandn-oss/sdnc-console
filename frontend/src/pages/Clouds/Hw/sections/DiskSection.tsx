import React, { useMemo, useState } from 'react';
import { App, Button, Dropdown, Input, Select, Space, Table } from 'antd';
import { MoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { HddOutlined } from '@ant-design/icons';
import { fetchCloudProviderDisks } from '../../../../services/api';
import { statusTag, tagsToText } from '../components/Common';
import SharedToolbar from '../../../../components/SharedToolbar';

type DiskSectionProps = {
  cloudId: string;
  disks: any[];
  onSetDisks: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const DiskSection: React.FC<DiskSectionProps> = ({ cloudId, disks, onSetDisks, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

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
    { title: '名称', dataIndex: 'name', key: 'name', render: (t: string) => t || '-', sorter: (a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')) },
    { title: 'ID', dataIndex: 'id', key: 'id', render: (t: string) => t || '-', sorter: (a: any, b: any) => String(a?.id || '').localeCompare(String(b?.id || '')) },
    { title: '容量/类型', key: 'size_type', render: (_: any, r: any): React.ReactNode => { const size = r?.size; const tp = r?.volume_type; const sTxt = (size != null && size !== '') ? `${size}GB` : '-'; const tTxt = tp || '-'; return `${sTxt}（${tTxt}）`; }, sorter: (a: any, b: any) => Number(a?.size || 0) - Number(b?.size || 0) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => statusTag(s), sorter: (a: any, b: any) => String(a?.status || '').localeCompare(String(b?.status || '')) },
    { title: '挂载实例/设备', key: 'attach', ellipsis: true, render: (_: any, r: any): React.ReactNode => { const atts: any[] = Array.isArray(r?.attachments) ? r?.attachments : []; const list = atts.map((a: any) => `${a?.server_id || a?.instance_id || '-'}（${a?.device || '-'}）`).filter(Boolean); return list.length ? list.join('；') : '-'; } },
    { title: '可用区/加密', key: 'az_enc', render: (_: any, r: any): React.ReactNode => { const az = r?.availability_zone || r?.zone || r?.ZoneId || '-'; const enc = r?.encrypted === true ? '是' : r?.encrypted === false ? '否' : '-'; return `${az}；加密: ${enc}`; } },
    { title: '标签', key: 'tags', ellipsis: true, render: (_: any, r: any) => tagsToText(r?.tags) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [{ key: 'detail', label: '详情' }];
      return (
        <Dropdown
          menu={{ items, onClick: async ({ key }) => {
            if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || '-'; onOpenDetail('disk', `云盘 ${name}（${id}）`, r); }
          } }}
        >
          <Button type="link" icon={<MoreOutlined />} />
        </Dropdown>
      );
    } },
  ]), [onOpenDetail]);

  return (
    <>
      <SharedToolbar
        left={(
          <>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
            <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((disks || []).map((r: any) => String(r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
          </>
        )}
        right={(
          <>
            <Dropdown
              menu={{
                items: [{ key: 'refresh', label: '刷新' }],
                onClick: async ({ key }) => {
                  if (key === 'refresh') {
                    try {
                      const json = await fetchCloudProviderDisks(cloudId).catch(() => null);
                      const list: any[] = (json?.data?.volumes) || (json?.volumes) || [];
                      onSetDisks(Array.isArray(list) ? list : []);
                    } catch (e: any) { message.error(e?.message || '刷新失败'); }
                  }
                }
              }}
            >
              <Button icon={<MoreOutlined style={{ transform: 'rotate(90deg)' }} />}>更多</Button>
            </Dropdown>
          </>
        )}
      />
      <Table bordered rowKey={(r: any) => r.id} dataSource={filtered} columns={columns as any} pagination={{ pageSize: 10 }} />
    </>
  );
};


export const Icon = <HddOutlined />;
export const Label = '云盘';
export default DiskSection;
