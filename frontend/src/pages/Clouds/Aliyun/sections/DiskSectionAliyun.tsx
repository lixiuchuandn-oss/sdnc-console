import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Space, Table } from 'antd';
import { ReloadOutlined, HddOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import { fetchCloudProviderDisks } from '../../../../services/api';

type Props = {
  cloudId: string;
  instance: any;
  disks?: any[];
  onSetDisks?: (list: any[]) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const DiskSectionAliyun: React.FC<Props> = ({ cloudId, instance, disks, onSetDisks, onRefreshAll }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState<boolean>(false);
  const [local, setLocal] = useState<any[]>(Array.isArray(disks) ? disks : []);
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
    if (!iid && !instance) return list;
    return (list || []).filter((d: any) => {
      const atts1: any[] = Array.isArray(d?.Attachments?.Attachment) ? d.Attachments.Attachment : [];
      const atts2: any[] = Array.isArray(d?.attachments) ? d.attachments : [];
      const matchAtt = [...atts1, ...atts2].some((a: any) => {
        const rid = a?.InstanceId || a?.server_id || a?.instance_id;
        return String(rid || '') === iid;
      });
      const rid = d?.InstanceId || d?.instance_id || '';
      return matchAtt || (String(rid || '') === iid);
    });
  }, [disks, local, iid, instance]);

  return (
    <PageDetailSection
      toolbarLeft={(
        <Space>
          <Button icon={<ReloadOutlined />} onClick={async () => { await load(); if (onRefreshAll) await onRefreshAll(); }} />
        </Space>
      )}
    >
      <Table
        loading={loading}
        rowKey={(r: any) => r?.DiskId || r?.id}
        columns={[
          { title: '名称', dataIndex: 'DiskName', key: 'name', render: (_: any, r: any) => r?.DiskName || r?.name || r?.Name || '-' },
          { title: 'ID', dataIndex: 'DiskId', key: 'id', render: (_: any, r: any) => r?.DiskId || r?.id || '-' },
          { title: '容量', key: 'size', render: (_: any, r: any) => (r?.Size != null ? `${r.Size}GB` : (r?.size != null ? `${r.size}GB` : '-')) },
          { title: '类型', key: 'type', render: (_: any, r: any) => r?.Type || r?.type || r?.VolumeType || '-' },
          { title: '挂载点', key: 'device', render: (_: any, r: any) => {
            const atts1: any[] = Array.isArray(r?.Attachments?.Attachment) ? r.Attachments.Attachment : [];
            const atts2: any[] = Array.isArray(r?.attachments) ? r.attachments : [];
            const att = [...atts1, ...atts2].find((a: any) => !iid || String(a?.InstanceId || a?.server_id || a?.instance_id || '') === iid);
            return att?.Device || att?.device || '-';
          } },
          { title: '状态', dataIndex: 'Status', key: 'status', render: (_: any, r: any) => r?.Status || r?.status || '-' },
        ] as any}
        dataSource={myDisks}
        pagination={{ pageSize: 10 }}
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
