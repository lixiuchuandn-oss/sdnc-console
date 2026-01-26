import React, { useMemo, useState } from 'react';
import { App, Button, Input, Popover, Select, Space, Table } from 'antd';
import { ReloadOutlined, GlobalOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import { associateAliyunEip, unassociateAliyunEip } from '../../../../services/aliyunApi';

type Props = {
  cloudId: string;
  instance: any;
  eips?: any[];
  enis?: any[];
  onRefreshAll?: () => Promise<void> | void;
};

const EipAddressSectionAliyun: React.FC<Props> = ({ cloudId, instance, eips, enis, onRefreshAll }) => {
  const { message } = App.useApp();
  const iid = String(instance?.InstanceId || instance?.id || '');
  const ports: string[] = Array.isArray((instance as any)?.network_interfaces) ? (instance as any)!.network_interfaces.map((ni: any) => ni?.port_id).filter(Boolean) : [];
  const eniList: any[] = useMemo(() => {
    const fromApi: any[] = Array.isArray(enis) ? enis : [];
    if (fromApi && fromApi.length) return fromApi;
    const fromInst1: any[] = Array.isArray((instance as any)?.NetworkInterfaces?.NetworkInterface) ? (instance as any)!.NetworkInterfaces!.NetworkInterface : [];
    const fromInst2: any[] = Array.isArray((instance as any)?.network_interfaces) ? (instance as any)!.network_interfaces : [];
    if (fromInst1 && fromInst1.length) return fromInst1;
    if (fromInst2 && fromInst2.length) return fromInst2;
    return [];
  }, [enis, instance]);
  const eipList: any[] = useMemo(() => {
    const fromApi: any[] = Array.isArray(eips) ? eips : [];
    if (fromApi && fromApi.length) return fromApi;
    const ip1 = (instance as any)?.EipAddress?.IpAddress;
    const ip2Arr: any[] = Array.isArray((instance as any)?.PublicIpAddress?.IpAddress) ? (instance as any)!.PublicIpAddress!.IpAddress : [];
    const ip2 = ip2Arr && ip2Arr.length ? ip2Arr[0] : undefined;
    const ip = ip1 || ip2;
    return ip ? [{ id: '-', publicip_address: ip, status: (instance as any)?.EipAddress?.AllocationId ? 'Associated' : '-' }] : [];
  }, [eips, instance]);
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const filteredEips = useMemo(() => {
    const list = Array.isArray(eipList) ? eipList : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const ip = String(r?.IpAddress || r?.ip_address || r?.public_ip_address || r?.publicip_address || '').toLowerCase();
      const id = String(r?.AllocationId || r?.allocation_id || r?.id || r?.publicip_id || '').toLowerCase();
      const name = String(r?.Name || r?.EipName || r?.name || '').toLowerCase();
      const instId = String(r?.InstanceId || r?.AssociatedInstanceId || r?.associate_instance?.id || r?.associate_instance?.instance_id || '').toLowerCase();
      const eniId = String(r?.NetworkInterfaceId || r?.port_id || '').toLowerCase();
      const text = `${ip} ${id} ${name} ${instId} ${eniId}`;
      const okKw = !kw || text.includes(kw);
      const st = String(r?.Status || r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === String(statusFilter || '').toLowerCase();
      const tp = String(r?.InstanceType || r?.instance_type || r?.associate_instance?.type || '').toLowerCase();
      const okTp = !typeFilter || tp === String(typeFilter || '').toLowerCase();
      return okKw && okSt && okTp;
    });
  }, [eipList, keyword, statusFilter, typeFilter]);

  const cols: any[] = [
    { title: 'EIP地址', key: 'ip', render: (_: any, r: any) => r?.IpAddress || r?.ip_address || r?.public_ip_address || r?.publicip_address || '-' },
    { title: 'EIP ID', key: 'id', render: (_: any, r: any) => r?.AllocationId || r?.allocation_id || r?.id || r?.publicip_id || '-' },
    { title: '名称', key: 'name', render: (_: any, r: any) => r?.Name || r?.EipName || r?.name || '-' },
    { title: '带宽(Mbps)', key: 'bw', render: (_: any, r: any) => {
      const size = r?.Bandwidth || (typeof r?.bandwidth === 'object' ? r?.bandwidth?.size : r?.bandwidth_size);
      return (size != null && size !== '') ? `${size}Mbps` : '-';
    } },
    { title: '互联网计费', key: 'ict', render: (_: any, r: any) => r?.InternetChargeType || r?.internet_charge_type || r?.charge_mode || '-' },
    { title: '绑定类型', key: 'bind_type', render: (_: any, r: any) => r?.InstanceType || r?.instance_type || r?.associate_instance?.type || '-' },
    { title: '绑定ID', key: 'bind_id', render: (_: any, r: any) => {
      const rid = r?.InstanceId || r?.AssociatedInstanceId || r?.associate_instance?.id || r?.associate_instance?.instance_id || '';
      return rid || '-';
    } },
    { title: '绑定网卡', key: 'eni', render: (_: any, r: any) => {
      const it = String(r?.InstanceType || r?.instance_type || '').toLowerCase();
      const iid = r?.InstanceId || r?.instance_id || '';
      const niid = r?.NetworkInterfaceId || r?.port_id || '';
      if (it === 'networkinterface' && iid && !niid) return iid;
      return niid || '-';
    } },
    { title: '状态', key: 'status', render: (_: any, r: any) => r?.Status || r?.status || '-' },
    { title: '分配时间', key: 'time', render: (_: any, r: any) => r?.AllocationTime || r?.allocation_time || '-' },
  ];
  const [bindEni, setBindEni] = useState<Record<string, string>>({});
  cols.push({
    title: '操作',
    key: 'ops',
    render: (_: any, r: any) => {
      const allocationId = r?.AllocationId || r?.allocation_id || r?.id || r?.publicip_id || '';
      const instType = String(r?.InstanceType || r?.instance_type || '').toLowerCase();
      const boundNiId = (instType === 'networkinterface' ? (r?.NetworkInterfaceId || r?.InstanceId) : (r?.NetworkInterfaceId)) || r?.port_id || '';
      const boundInstId = (instType !== 'networkinterface' ? (r?.InstanceId || r?.instance_id || '') : '');
      const boundPriIp = r?.PrivateIpAddress || r?.private_ip || '';
      const allocValid = !!(allocationId && allocationId !== '-' && !/^\s*$/.test(String(allocationId)));
      const niOpts = (eniList || []).map((ni: any) => {
        const id = ni?.NetworkInterfaceId || ni?.Id || ni?.id || '';
        const ip = ni?.PrimaryIpAddress || (Array.isArray(ni?.PrivateIpAddress?.IpAddress) ? ni.PrivateIpAddress.IpAddress[0] : '');
        return { label: `${id || '-'}（${ip || '-'}）`, value: id };
      }).filter(x => x.value);
      const content = (
        <Space direction="vertical" size={8}>
          <Space direction="vertical" size={8}>
            <Select
              style={{ width: 280 }}
              placeholder="选择网卡进行绑定"
              value={bindEni[allocationId]}
              onChange={(v) => setBindEni(prev => ({ ...prev, [allocationId]: String(v || '') }))}
              options={niOpts}
            />
            <Button
              type="primary"
              size="small"
              disabled={!bindEni[allocationId] || !allocValid}
              onClick={async () => {
                const niId = bindEni[allocationId];
                if (!niId || !allocValid) { message.warning('该EIP缺少有效的 AllocationId'); return; }
                const ni = (eniList || []).find((x: any) => String(x?.NetworkInterfaceId || x?.Id || x?.id || '') === String(niId));
                const priIp = ni?.PrimaryIpAddress || (Array.isArray(ni?.PrivateIpAddress?.IpAddress) ? ni.PrivateIpAddress.IpAddress[0] : undefined);
                try {
                  await associateAliyunEip(cloudId, String(allocationId), { NetworkInterfaceId: niId, ...(priIp ? { PrivateIpAddress: priIp } : {}) });
                  message.success('EIP绑定成功');
                  setBindEni(prev => ({ ...prev, [allocationId]: '' }));
                  const evt = typeof window !== 'undefined' ? new CustomEvent('refreshEips') : null;
                  if (evt && typeof window !== 'undefined') window.dispatchEvent(evt);
                } catch (e: any) {
                  message.error(e?.message || '绑定失败');
                }
              }}
            >
              确认绑定
            </Button>
          </Space>
          <Space direction="vertical" size={8}>
            <Button
              danger
              size="small"
              disabled={!boundNiId || !allocValid}
              onClick={async () => {
                if (!boundNiId || !allocValid) { message.warning('该EIP缺少有效的 AllocationId'); return; }
                try {
                  const payload: any = {};
                  if (instType === 'networkinterface') {
                    payload.NetworkInterfaceId = boundNiId;
                    if (boundPriIp) payload.PrivateIpAddress = boundPriIp;
                  } else {
                    payload.InstanceId = boundInstId || boundNiId;
                  }
                  await unassociateAliyunEip(cloudId, String(allocationId), payload);
                  message.success('EIP解绑成功');
                  const evt = typeof window !== 'undefined' ? new CustomEvent('refreshEips') : null;
                  if (evt && typeof window !== 'undefined') window.dispatchEvent(evt);
                } catch (e: any) {
                  message.error(e?.message || '解绑失败');
                }
              }}
            >
              解绑当前网卡
            </Button>
          </Space>
        </Space>
      );
      return (
        <Popover content={content} trigger="click" placement="left">
          <Button size="small" disabled={!allocValid}>绑定/解绑</Button>
        </Popover>
      );
    }
  });
  const rowKeyFn = (r: any) => r?.AllocationId || r?.id || r?.publicip_id || `${r?.IpAddress || r?.public_ip_address || r?.publicip_address || r?.ip_address || ''}`;
  return (
    <PageDetailSection
      toolbarLeft={(
        <Space size={8}>
          <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
          <Select
            placeholder="选择状态"
            allowClear
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as any)}
            style={{ width: 160 }}
            options={[
              ...Array.from(new Set((eipList || []).map((r: any) => String(r?.Status || r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))
            ]}
          />
          <Select
            placeholder="绑定类型"
            allowClear
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as any)}
            style={{ width: 180 }}
            options={[
              ...Array.from(new Set((eipList || []).map((r: any) => String(r?.InstanceType || r?.instance_type || r?.associate_instance?.type || '').trim()).filter(Boolean))).map(t => ({ label: t, value: t }))
            ]}
          />
        </Space>
      )}
      toolbarRight={(
        <Space size={8}>
          <Button icon={<ReloadOutlined />} onClick={async () => { if (onRefreshAll) await onRefreshAll(); }} />
        </Space>
      )}
    >
      <Table
        size="small"
        bordered={false}
        tableLayout="auto"
        rowKey={rowKeyFn}
        columns={cols as any}
        dataSource={filteredEips}
        pagination={false}
      />
    </PageDetailSection>
  );
};

(EipAddressSectionAliyun as any).tabMeta = {
  key: 'eips',
  title: '弹性公网IP',
  icon: <GlobalOutlined style={{ color: '#1677FF' }} />,
  countOf: (p: any) => {
    const list: any[] = Array.isArray(p?.eips) ? p.eips : [];
    return list.length;
  },
};

export default EipAddressSectionAliyun;
