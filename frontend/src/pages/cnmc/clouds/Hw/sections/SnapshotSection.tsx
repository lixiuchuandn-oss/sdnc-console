import React, { useMemo, useState } from 'react';
import { App, Input, Select, Table } from 'antd';
import { CameraOutlined } from '@ant-design/icons';
import { fetchCloudProviderSnapshots } from '../../../../../services/api';
import { statusTag } from '../components/Common';
import SharedToolbar from '../../../../../components/SharedToolbar';
import { RowActionsButton } from '../../../../../components/PageDetailSection';

type SnapshotSectionProps = {
  cloudId: string;
  snapshots: any[];
  onSetSnapshots: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const SnapshotSection: React.FC<SnapshotSectionProps> = ({ cloudId, snapshots, onSetSnapshots, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const filtered = useMemo(() => {
    const list = Array.isArray(snapshots) ? snapshots : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.name || ''} ${r?.id || ''} ${r?.volume_id || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [snapshots, keyword, statusFilter]);

  const columns = useMemo(() => ([
    { title: '名称', dataIndex: 'name', key: 'name', render: (t: string) => t || '-', sorter: (a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')) },
    { title: 'ID', dataIndex: 'id', key: 'id', render: (t: string) => t || '-', sorter: (a: any, b: any) => String(a?.id || '').localeCompare(String(b?.id || '')) },
    { title: '源磁盘', dataIndex: 'volume_id', key: 'src', render: (t: string) => t || '-', sorter: (a: any, b: any) => String(a?.volume_id || '').localeCompare(String(b?.volume_id || '')) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => statusTag(s), sorter: (a: any, b: any) => String(a?.status || '').localeCompare(String(b?.status || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [{ key: 'detail', label: '详情' }];
      return (
        <RowActionsButton
          items={items}
          onClick={async ({ key }: { key: string }) => {
            if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || '-'; onOpenDetail('snapshot', `快照 ${name}（${id}）`, r); }
          }}
        />
      );
    } },
  ]), [onOpenDetail]);

  return (
    <>
      <SharedToolbar
        left={(
          <>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
            <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((snapshots || []).map((r: any) => String(r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
          </>
        )}
        right={(
          <>
            <RowActionsButton
              items={[{ key: 'refresh', label: '刷新' }]}
              onClick={async ({ key }: { key: string }) => {
                if (key === 'refresh') {
                  try {
                    const json = await fetchCloudProviderSnapshots(cloudId).catch(() => null);
                    const list: any[] = (json?.data?.snapshots) || (json?.snapshots) || [];
                    onSetSnapshots(Array.isArray(list) ? list : []);
                  } catch (e: any) { message.error(e?.message || '刷新失败'); }
                }
              }}
              buttonProps={{ children: '更多' }}
            />
          </>
        )}
      />
      <Table bordered rowKey={(r: any) => r.id} dataSource={filtered} columns={columns as any} pagination={{ pageSize: 10 }} />
    </>
  );
};


export const Icon = <CameraOutlined />;
export const Label = '快照';
export default SnapshotSection;
