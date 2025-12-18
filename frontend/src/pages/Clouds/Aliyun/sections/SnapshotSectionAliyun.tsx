import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Table } from 'antd';
import { MoreOutlined, CameraOutlined } from '@ant-design/icons';
import { fetchCloudProviderSnapshots } from '../../../../services/api';
import { statusTag } from '../../Hw/components/Common';
import PageDetailSection, { RowActionsButton } from '../../../../components/PageDetailSection';

type SnapshotSectionAliyunProps = {
  cloudId: string;
  snapshots: any[];
  onSetSnapshots: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const SnapshotSectionAliyun: React.FC<SnapshotSectionAliyunProps> = ({ cloudId, snapshots, onSetSnapshots, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const filtered = useMemo(() => {
    const list = Array.isArray(snapshots) ? snapshots : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      // Aliyun: SnapshotId, SnapshotName, SourceDiskId
      const text = `${r?.SnapshotName || r?.name || ''} ${r?.SnapshotId || r?.id || ''} ${r?.SourceDiskId || r?.volume_id || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.Status || r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [snapshots, keyword, statusFilter]);

  const columns = useMemo(() => ([
    { title: '名称', key: 'name', render: (_: any, r: any) => r?.SnapshotName || r?.name || '-', sorter: (a: any, b: any) => String(a?.SnapshotName || a?.name || '').localeCompare(String(b?.SnapshotName || b?.name || '')) },
    { title: 'ID', key: 'id', render: (_: any, r: any) => r?.SnapshotId || r?.id || '-', sorter: (a: any, b: any) => String(a?.SnapshotId || a?.id || '').localeCompare(String(b?.SnapshotId || b?.id || '')) },
    { title: '源磁盘', key: 'src', render: (_: any, r: any) => r?.SourceDiskId || r?.volume_id || '-', sorter: (a: any, b: any) => String(a?.SourceDiskId || a?.volume_id || '').localeCompare(String(b?.SourceDiskId || b?.volume_id || '')) },
    { title: '状态', key: 'status', render: (_: any, r: any) => statusTag(r?.Status || r?.status), sorter: (a: any, b: any) => String(a?.Status || a?.status || '').localeCompare(String(b?.Status || b?.status || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [{ key: 'detail', label: '详情' }];
      return (
        <RowActionsButton
          items={items}
          onClick={async ({ key }: { key: string }) => {
            if (key === 'detail') { const name = r?.SnapshotName || r?.name || '-'; const id = r?.SnapshotId || r?.id || '-'; onOpenDetail('snapshot', `快照 ${name}（${id}）`, r); }
          }}
        />
      );
    } },
  ]), [onOpenDetail]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
          <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((snapshots || []).map((r: any) => String(r?.Status || r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
        </>
      )}
      toolbarRight={(
        <RowActionsButton
          items={[{ key: 'refresh', label: '刷新' }]}
          onClick={async ({ key }) => {
            if (key === 'refresh') {
              try {
                const json = await fetchCloudProviderSnapshots(cloudId).catch(() => null);
                const list: any[] = (json?.Snapshots?.Snapshot) || (json?.data?.snapshots) || (json?.snapshots) || [];
                onSetSnapshots(Array.isArray(list) ? list : []);
              } catch (e: any) { message.error(e?.message || '刷新失败'); }
            }
          }}
          buttonProps={{
            type: 'default',
            icon: <MoreOutlined style={{ transform: 'rotate(90deg)' }} />,
            children: '更多'
          }}
        />
      )}
      asCard={false}
    >
      <Table rowKey={(r: any) => r?.SnapshotId || r?.id} dataSource={filtered} columns={columns as any} pagination={{ pageSize: 10 }} />
    </PageDetailSection>
  );
};

export const Icon = <CameraOutlined />;
export const Label = '快照';
export default SnapshotSectionAliyun;
