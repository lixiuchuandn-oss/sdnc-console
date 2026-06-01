import React, { useEffect, useState } from 'react';
import { App, Button, Input, Select, Table, Space, Tabs } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../../components/StdSideDrawer';
import { updateCloudProviderNetworkAclEntries, type AliyunAclEntry } from '../../../../../services/aliyunApi';

type Props = {
  open: boolean;
  cloudId: string;
  acl: any | null;
  onClose: () => void;
  onUpdated?: () => void;
};

const protocolOptions = [
  { label: '全部', value: 'all' },
  { label: 'TCP', value: 'tcp' },
  { label: 'UDP', value: 'udp' },
  { label: 'ICMP', value: 'icmp' },
  { label: 'GRE', value: 'gre' },
];
const policyOptions = [
  { label: '允许', value: 'accept' },
  { label: '拒绝', value: 'drop' },
];

const mapIn = (e: any): AliyunAclEntry => ({
  name: e?.NetworkAclEntryName || e?.name,
  policy: (e?.Policy || e?.policy || 'accept') as any,
  protocol: (e?.Protocol || e?.protocol || 'all') as any,
  port: e?.Port || e?.port || '-1/-1',
  sourceCidrIp: e?.SourceCidrIp || e?.sourceCidrIp || '0.0.0.0/0',
  description: e?.Description || e?.description,
});
const mapEg = (e: any): AliyunAclEntry => ({
  name: e?.NetworkAclEntryName || e?.name,
  policy: (e?.Policy || e?.policy || 'accept') as any,
  protocol: (e?.Protocol || e?.protocol || 'all') as any,
  port: e?.Port || e?.port || '-1/-1',
  destinationCidrIp: e?.DestinationCidrIp || e?.destinationCidrIp || '0.0.0.0/0',
  description: e?.Description || e?.description,
});

const NetworkAclEntryDrawerAliyun: React.FC<Props> = ({ open, cloudId, acl, onClose, onUpdated }) => {
  const { message } = App.useApp();
  const [ingress, setIngress] = useState<AliyunAclEntry[]>([]);
  const [egress, setEgress] = useState<AliyunAclEntry[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !acl) return;
    const inRaw = acl?.IngressAclEntries?.IngressAclEntry || acl?.ingressAclEntries || [];
    const egRaw = acl?.EgressAclEntries?.EgressAclEntry || acl?.egressAclEntries || [];
    setIngress((Array.isArray(inRaw) ? inRaw : []).map(mapIn));
    setEgress((Array.isArray(egRaw) ? egRaw : []).map(mapEg));
  }, [open, acl]);

  const aclId = acl?.NetworkAclId || acl?.id;

  const buildColumns = (dir: 'in' | 'eg', list: AliyunAclEntry[], setList: (v: AliyunAclEntry[]) => void) => {
    const update = (idx: number, patch: Partial<AliyunAclEntry>) => {
      const next = list.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      setList(next);
    };
    const remove = (idx: number) => setList(list.filter((_, i) => i !== idx));
    return [
      { title: '名称', key: 'name', width: 130, render: (_: any, _r: AliyunAclEntry, i: number) => (<Input size="small" value={list[i].name} placeholder="选填" onChange={(e) => update(i, { name: e.target.value })} />) },
      { title: '策略', key: 'policy', width: 90, render: (_: any, _r: AliyunAclEntry, i: number) => (<Select size="small" style={{ width: '100%' }} value={list[i].policy} options={policyOptions} onChange={(v) => update(i, { policy: v })} />) },
      { title: '协议', key: 'protocol', width: 90, render: (_: any, _r: AliyunAclEntry, i: number) => (<Select size="small" style={{ width: '100%' }} value={list[i].protocol} options={protocolOptions} onChange={(v) => update(i, { protocol: v })} />) },
      { title: '端口范围', key: 'port', width: 110, render: (_: any, _r: AliyunAclEntry, i: number) => (<Input size="small" value={list[i].port} placeholder="如 80/80 或 -1/-1" onChange={(e) => update(i, { port: e.target.value })} />) },
      {
        title: dir === 'in' ? '源地址' : '目的地址', key: 'cidr', width: 150,
        render: (_: any, _r: AliyunAclEntry, i: number) => (
          <Input
            size="small"
            value={dir === 'in' ? list[i].sourceCidrIp : list[i].destinationCidrIp}
            placeholder="0.0.0.0/0"
            onChange={(e) => update(i, dir === 'in' ? { sourceCidrIp: e.target.value } : { destinationCidrIp: e.target.value })}
          />
        ),
      },
      { title: '描述', key: 'desc', render: (_: any, _r: AliyunAclEntry, i: number) => (<Input size="small" value={list[i].description} placeholder="选填" onChange={(e) => update(i, { description: e.target.value })} />) },
      { title: '', key: 'op', width: 50, render: (_: any, _r: AliyunAclEntry, i: number) => (<Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(i)} />) },
    ];
  };

  const save = async (dir: 'in' | 'eg') => {
    if (!aclId) return;
    setSaving(true);
    try {
      await updateCloudProviderNetworkAclEntries(cloudId, aclId, dir === 'in' ? { ingress } : { egress });
      message.success('规则已保存');
      if (onUpdated) onUpdated();
    } catch (e: any) {
      message.error(e?.message || '保存规则失败');
    } finally {
      setSaving(false);
    }
  };

  const blankIn: AliyunAclEntry = { policy: 'accept', protocol: 'all', port: '-1/-1', sourceCidrIp: '0.0.0.0/0' };
  const blankEg: AliyunAclEntry = { policy: 'accept', protocol: 'all', port: '-1/-1', destinationCidrIp: '0.0.0.0/0' };

  return (
    <StdSideDrawer
      open={open}
      onClose={onClose}
      width={900}
      title={`管理 ACL 规则 · ${acl?.NetworkAclName || aclId || ''}`}
    >
      <Tabs
        items={[
          {
            key: 'ingress',
            label: `入方向（${ingress.length}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Space>
                  <Button icon={<PlusOutlined />} onClick={() => setIngress([...ingress, { ...blankIn }])}>添加规则</Button>
                  <Button type="primary" loading={saving} onClick={() => save('in')}>保存入方向</Button>
                </Space>
                <Table size="small" className="std-table" bordered={false} rowKey={(_, i) => `in-${i}`} pagination={false} dataSource={ingress} columns={buildColumns('in', ingress, setIngress) as any} scroll={{ x: true }} />
              </Space>
            ),
          },
          {
            key: 'egress',
            label: `出方向（${egress.length}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Space>
                  <Button icon={<PlusOutlined />} onClick={() => setEgress([...egress, { ...blankEg }])}>添加规则</Button>
                  <Button type="primary" loading={saving} onClick={() => save('eg')}>保存出方向</Button>
                </Space>
                <Table size="small" className="std-table" bordered={false} rowKey={(_, i) => `eg-${i}`} pagination={false} dataSource={egress} columns={buildColumns('eg', egress, setEgress) as any} scroll={{ x: true }} />
              </Space>
            ),
          },
        ]}
      />
    </StdSideDrawer>
  );
};

export default NetworkAclEntryDrawerAliyun;
