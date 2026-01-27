import React, { useMemo, useState } from 'react';
import { App, Button, Input, Modal, Select, Space, Table, Tooltip, Form, Checkbox, InputNumber, Switch } from 'antd';
import { ReloadOutlined, DeploymentUnitOutlined } from '@ant-design/icons';
import { createCloudProviderEni, attachCloudProviderEni, detachCloudProviderEni, fetchCloudProviderEnis, updateCloudProviderEni, associateAliyunEip, unassociateAliyunEip } from '../../../../services/aliyunApi';
import PageDetailSection, { RowActionsButton } from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import StdFormModal from '../../../../components/StdFormModal';

type Props = {
  cloudId: string;
  instance: any;
  enis?: any[];
  eips?: any[];
  onRefreshAll?: () => Promise<void> | void;
};

const NetworkInterfaceSectionAliyun: React.FC<Props> = ({ cloudId, instance, enis, eips, onRefreshAll }) => {
  const { message } = App.useApp();
  const iid = String(instance?.InstanceId || instance?.id || '');
  const eniList: any[] = useMemo(() => {
    // 优先使用从 API 实时获取并过滤后的 enis
    const fromApi: any[] = Array.isArray(enis) ? enis : [];
    if (fromApi.length > 0) return fromApi;

    // 只有当 API 数据为空时，才回退到实例详情中的网卡数据（可能是旧数据）
    const fromInst1: any[] = Array.isArray((instance as any)?.NetworkInterfaces?.NetworkInterface) ? (instance as any)!.NetworkInterfaces!.NetworkInterface : [];
    const fromInst2: any[] = Array.isArray((instance as any)?.network_interfaces) ? (instance as any)!.network_interfaces : [];
    if (fromInst1 && fromInst1.length) return fromInst1;
    if (fromInst2 && fromInst2.length) return fromInst2;
    const vsw = (instance as any)?.VpcAttributes?.VSwitchId || (instance as any)?.VSwitchId;
    const arr: any[] = Array.isArray((instance as any)?.VpcAttributes?.PrivateIpAddress?.IpAddress) ? (instance as any)!.VpcAttributes!.PrivateIpAddress!.IpAddress : [];
    const st = (instance as any)?.Status || (instance as any)?.status;
    if (vsw || (arr && arr.length)) {
      return [{ id: '-', VSwitchId: vsw, PrivateIpAddress: { IpAddress: arr }, Status: st }];
    }
    return [];
  }, [enis, instance, iid]);

  const [keyword, setKeyword] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [bindFilter, setBindFilter] = useState<string | undefined>(undefined);
  const isBoundToEip = (niId: string) => {
    const list = (eips || []).filter((x: any) => {
      const type = String(x?.InstanceType || x?.instance_type || '').toLowerCase();
      const eniByType = (type === 'networkinterface') ? (x?.InstanceId || x?.instance_id || '') : '';
      const eniByField = x?.NetworkInterfaceId || x?.port_id || '';
      const target = String(niId || '');
      return String(eniByField || '') === target || String(eniByType || '') === target;
    });
    return list.length > 0;
  };
  const filteredEniList: any[] = useMemo(() => {
    const list = Array.isArray(eniList) ? eniList : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const id = String(r?.NetworkInterfaceId || r?.id || r?.Id || '').toLowerCase();
      const nm = String(r?.NetworkInterfaceName || r?.name || '').toLowerCase();
      const tp = String(r?.Type || '').toLowerCase();
      const okKw = !kw || id.includes(kw) || nm.includes(kw);
      const okTp = !typeFilter || tp === String(typeFilter || '').toLowerCase();
      const niId = String(r?.NetworkInterfaceId || r?.Id || r?.id || '');
      const bound = niId ? isBoundToEip(niId) : false;
      const okBind = !bindFilter || (bindFilter === 'bound' ? bound : !bound);
      return okKw && okTp && okBind;
    });
  }, [eniList, keyword, typeFilter, bindFilter, eips]);

  const hasAny = (getter: (r: any) => any) => {
    return (eniList || []).some((r: any) => {
      const v = getter(r);
      if (Array.isArray(v)) return v.length > 0;
      return v !== undefined && v !== null && String(v).trim() !== '';
    });
  };

  console.log('[DEBUG] NetworkInterfaceSectionAliyun eniList:', eniList);
  console.log('[DEBUG] NetworkInterfaceSectionAliyun filteredEniList:', filteredEniList);
  console.log('[DEBUG] NetworkInterfaceSectionAliyun raw instance:', instance);

  const cols: any[] = [];
  if (hasAny(r => r?.NetworkInterfaceId || r?.id || r?.Id)) {
    cols.push({ title: '网卡ID', key: 'id', render: (_: any, r: any) => r?.NetworkInterfaceId || r?.id || r?.Id || '-' });
  }
  if (hasAny(r => r?.NetworkInterfaceName || r?.name)) {
    cols.push({ title: '名称', key: 'name', render: (_: any, r: any) => r?.NetworkInterfaceName || r?.name || '-' });
  }
  if (hasAny(r => r?.VpcId)) {
    cols.push({ title: '所属VPC', key: 'vpc', render: (_: any, r: any) => r?.VpcId || '-' });
  }
  if (hasAny(r => r?.VSwitchId || r?.SubnetId)) {
    cols.push({ title: '交换机', key: 'vsw', render: (_: any, r: any) => r?.VSwitchId || r?.SubnetId || '-' });
  }
  if (hasAny(r => r?.ZoneId)) {
    cols.push({ title: '可用区', key: 'zone', render: (_: any, r: any) => r?.ZoneId || '-' });
  }
  // Always show Primary IP
  cols.push({ title: '主私有IP', key: 'primary_ip', render: (_: any, r: any) => {
    const val = r?.PrimaryIpAddress || r?.primaryIpAddress || r?.primary_ip_address;
    // 如果没有明确的 PrimaryIpAddress，尝试使用 PrivateIpAddress (如果是字符串)
    if (!val && typeof r?.PrivateIpAddress === 'string') return r.PrivateIpAddress;
    if (!val && typeof r?.privateIpAddress === 'string') return r.privateIpAddress;
    return val || '-';
  } });

  // Always show Private IP
  cols.push({ title: '私有IP', key: 'pri', render: (_: any, r: any) => {
    // 1. Try PrivateIpAddress.IpAddress (Array) - DescribeInstances pattern
    if (Array.isArray(r?.PrivateIpAddress?.IpAddress)) return r.PrivateIpAddress.IpAddress.join(', ');
    
    // 2. Try PrivateIpSets.PrivateIpSet (Array) - DescribeNetworkInterfaces pattern
    if (Array.isArray(r?.PrivateIpSets?.PrivateIpSet)) {
      return r.PrivateIpSets.PrivateIpSet.map((x: any) => x?.PrivateIpAddress || x).filter(Boolean).join(', ');
    }
    
    // 3. Try PrivateIpSets (Array) - Simplified pattern
    if (Array.isArray(r?.PrivateIpSets)) return r.PrivateIpSets.join(', ');

    // 4. Try privateIpAddresses (Array)
    if (Array.isArray(r?.privateIpAddresses)) return r.privateIpAddresses.join(', ');
    
    // 5. Fallback to simple string
    const val = r?.PrivateIpAddress || r?.privateIpAddress || r?.ip_address;
    if (typeof val === 'string') return val;
    
    return '-';
  } });
  if (Array.isArray(eips) && eips.length && hasAny(r => r?.NetworkInterfaceId || r?.Id || r?.id)) {
    cols.push({ title: '绑定EIP', key: 'eip', render: (_: any, r: any) => {
      const niId = r?.NetworkInterfaceId || r?.Id || r?.id || '';
      const list = (eips || []).filter((x: any) => {
        const type = String(x?.InstanceType || x?.instance_type || '').toLowerCase();
        const eniByType = (type === 'networkinterface') ? (x?.InstanceId || x?.instance_id || '') : '';
        const eniByField = x?.NetworkInterfaceId || x?.port_id || '';
        const target = String(niId || '');
        return String(eniByField || '') === target || String(eniByType || '') === target;
      });
      const addrs = list.map((x: any) => x?.IpAddress || x?.public_ip_address || x?.publicip_address || x?.ip_address).filter(Boolean);
      return addrs.length ? addrs.join(', ') : '-';
    } });
  }
  if (hasAny(r => r?.Ipv6Sets?.Ipv6Set)) {
    cols.push({ title: 'IPv6地址', key: 'ipv6', render: (_: any, r: any) => {
      const arr = Array.isArray(r?.Ipv6Sets?.Ipv6Set) ? r.Ipv6Sets.Ipv6Set : [];
      const ips = arr.map((x: any) => x?.Ipv6Address || x?.ipv6_address).filter(Boolean);
      return ips.length ? ips.join(', ') : '-';
    } });
  }
  if (hasAny(r => r?.MacAddress || r?.macAddress || r?.mac_address)) {
    cols.push({ title: 'MAC地址', key: 'mac', render: (_: any, r: any) => r?.MacAddress || r?.macAddress || r?.mac_address || '-' });
  }
  if (hasAny(r => r?.Type)) {
    cols.push({ title: '类型', key: 'type', render: (_: any, r: any) => r?.Type || '-' });
  }
  if (hasAny(r => r?.ServiceManaged !== undefined)) {
    cols.push({ title: '托管', key: 'svc', render: (_: any, r: any) => (r?.ServiceManaged ? '是' : '否') });
  }
  if (hasAny(r => r?.SourceDestCheck !== undefined || r?.sourceDestCheck !== undefined)) {
    cols.push({
      title: '源/目的检查',
      key: 'sdc',
      render: (_: any, r: any) => {
        const niId = r?.NetworkInterfaceId || r?.id || r?.Id;
        const raw = r?.SourceDestCheck !== undefined ? r?.SourceDestCheck : r?.sourceDestCheck;
        const serverVal = raw === true || String(raw).toLowerCase() === 'true';
        const val = optimisticStates[niId] !== undefined ? optimisticStates[niId] : serverVal;
        return <Switch size="small" checked={val} onChange={(checked) => handleUpdateSourceDestCheck(niId, checked)} />;
      }
    });
  }
  if (hasAny(r => r?.Status)) {
    cols.push({ title: '状态', key: 'status', render: (_: any, r: any) => r?.Status || '-' });
  }
  if (hasAny(r => r?.Description)) {
    cols.push({ title: '描述', key: 'desc', render: (_: any, r: any) => r?.Description || '-' });
  }
  if (hasAny(r => r?.SecurityGroupIds?.SecurityGroupId)) {
    cols.push({ title: '安全组', key: 'sg', render: (_: any, r: any) => {
      const arr = Array.isArray(r?.SecurityGroupIds?.SecurityGroupId) ? r.SecurityGroupIds.SecurityGroupId : [];
      return arr.length ? arr.join(', ') : '-';
    } });
  }
  if (hasAny(r => r?.Attachment?.InstanceId || r?.AttachedInstanceId)) {
    cols.push({ title: '绑定实例', key: 'att', render: (_: any, r: any) => r?.Attachment?.InstanceId || r?.AttachedInstanceId || '-' });
  }
  const availableEips = useMemo(() => {
    const arr: any[] = Array.isArray(eips) ? eips : [];
    return arr.filter((x: any) => {
      const st = String(x?.Status || x?.status || '').toLowerCase();
      const hasAssoc = !!(x?.InstanceId || x?.AssociatedInstanceId || x?.NetworkInterfaceId || x?.port_id);
      return !hasAssoc && (st === 'available' || st === '' || st === 'idle');
    });
  }, [eips]);
  const [selEip, setSelEip] = useState<Record<string, string>>({});
  const [selUnEip, setSelUnEip] = useState<Record<string, string>>({});
  const [bindOpen, setBindOpen] = useState<boolean>(false);
  const [unbindOpen, setUnbindOpen] = useState<boolean>(false);
  const [activeNiId, setActiveNiId] = useState<string>('');
  const [activePriIp, setActivePriIp] = useState<string | undefined>(undefined);
  const [bindEipId, setBindEipId] = useState<string>('');
  const [unbindEipId, setUnbindEipId] = useState<string>('');
  const [opLoading, setOpLoading] = useState<boolean>(false);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createLoading, setCreateLoading] = useState<boolean>(false);
  const [bindNiOpen, setBindNiOpen] = useState<boolean>(false);
  const [bindNiId, setBindNiId] = useState<string>('');
  const [availableEnis, setAvailableEnis] = useState<any[]>([]);
  const [attachLoading, setAttachLoading] = useState<boolean>(false);
  const [loadingEnis, setLoadingEnis] = useState<boolean>(false);
  const [bindNetworkCardIndex, setBindNetworkCardIndex] = useState<number | undefined>(undefined);
  const [bindWaitForNetworkReady, setBindWaitForNetworkReady] = useState<boolean>(false);
  const [createForm] = Form.useForm();
  const [optimisticStates, setOptimisticStates] = useState<Record<string, boolean>>({});

  const handleOpenBindModal = async () => {
    setBindNiOpen(true);
    setBindNiId('');
    setBindNetworkCardIndex(undefined);
    setBindWaitForNetworkReady(false);
    setLoadingEnis(true);
    try {
      const vpcId = (instance as any)?.VpcAttributes?.VpcId || (instance as any)?.VpcId;
      const res: any = await fetchCloudProviderEnis(cloudId, { vpcId });
      const all = res?.data?.NetworkInterfaces?.NetworkInterface || res?.data?.enis || [];
      const list = Array.isArray(all) ? all : [];
      const zoneId = (instance as any)?.ZoneId || (instance as any)?.zone_id;
      
      const valid = list.filter((x: any) => {
        const status = String(x?.Status || x?.status || '').toLowerCase();
        const vpc = x?.VpcId || x?.vpc_id;
        const zone = x?.ZoneId || x?.zone_id;
        
        const isAvailable = status === 'available';
        const isSameVpc = !vpcId || vpc === vpcId;
        const isSameZone = !zoneId || zone === zoneId;
        
        return isAvailable && isSameVpc && isSameZone;
      });
      setAvailableEnis(valid);
    } catch (e: any) {
      message.error(e?.message || '获取可用网卡列表失败');
    } finally {
      setLoadingEnis(false);
    }
  };

  const handleAttachEni = async () => {
    if (!bindNiId) return;
    try {
      setAttachLoading(true);
      await attachCloudProviderEni(cloudId, bindNiId, iid, {
        networkCardIndex: bindNetworkCardIndex,
        waitForNetworkConfigurationReady: bindWaitForNetworkReady
      });
      message.success('网卡绑定请求已发送');
      setBindNiOpen(false);
      try { const evt = typeof window !== 'undefined' ? new CustomEvent('refreshEips') : null; if (evt && typeof window !== 'undefined') window.dispatchEvent(evt); } catch {}
      if (onRefreshAll) await onRefreshAll();
    } catch (e: any) {
      message.error(e?.message || '绑定网卡失败');
    } finally {
      setAttachLoading(false);
    }
  };

  const handleDetachEni = async (niId: string) => {
    try {
      await detachCloudProviderEni(cloudId, niId, iid);
      message.success('网卡卸载请求已发送');
      try { const evt = typeof window !== 'undefined' ? new CustomEvent('refreshEips') : null; if (evt && typeof window !== 'undefined') window.dispatchEvent(evt); } catch {}
      if (onRefreshAll) await onRefreshAll();
    } catch (e: any) {
      message.error(e?.message || '卸载网卡失败');
    }
  };

  const handleUpdateSourceDestCheck = async (niId: string, checked: boolean) => {
    try {
      // Optimistic update
      setOptimisticStates(prev => ({ ...prev, [niId]: checked }));
      await updateCloudProviderEni(cloudId, niId, { sourceDestCheck: checked });
      message.success(`源/目的检查已${checked ? '开启' : '关闭'}`);
      if (onRefreshAll) await onRefreshAll();
    } catch (e: any) {
      // Revert optimistic update on failure
      setOptimisticStates(prev => {
        const next = { ...prev };
        delete next[niId];
        return next;
      });
      message.error(e?.message || '更新源/目的检查失败');
    }
  };

  const initialCreateValues = useMemo(() => {
    const vswtId = String((instance as any)?.VpcAttributes?.VSwitchId || (instance as any)?.VSwitchId || '');
    const arr: string[] = Array.isArray((instance as any)?.SecurityGroupIds?.SecurityGroupId) ? (instance as any)!.SecurityGroupIds!.SecurityGroupId : [];
    const sgId = arr && arr.length ? String(arr[0]) : '';
    return {
      vSwitchId: vswtId,
      securityGroupId: sgId,
    };
  }, [instance]);
  cols.push({
    title: '操作',
    key: 'ops',
    render: (_: any, r: any) => {
      const niId = r?.NetworkInterfaceId || r?.Id || r?.id || '';
      const priIp = r?.PrimaryIpAddress || (Array.isArray(r?.PrivateIpAddress?.IpAddress) ? r.PrivateIpAddress.IpAddress[0] : undefined);
      const boundEips = (Array.isArray(eips) ? eips : []).filter((x: any) => {
        const type = String(x?.InstanceType || x?.instance_type || '').toLowerCase();
        const eniByType = (type === 'networkinterface') ? (x?.InstanceId || x?.instance_id || '') : '';
        const eniByField = x?.NetworkInterfaceId || x?.port_id || '';
        const target = String(niId || '');
        return String(eniByField || '') === target || String(eniByType || '') === target;
      });
      const isPrimary = String(r?.Type || '').toLowerCase() === 'primary';
      return (
        <RowActionsButton
          items={[
            {
              key: 'bind',
              label: availableEips.length ? '绑定EIP' : <Tooltip title="当前地域无可用EIP">绑定EIP</Tooltip>,
              disabled: !availableEips.length,
            },
            {
              key: 'unbind',
              label: boundEips.length ? '解绑EIP' : <Tooltip title="该网卡当前没有已绑定的EIP">解绑EIP</Tooltip>,
              disabled: !boundEips.length,
              danger: true,
            },
            {
              key: 'detach',
              label: isPrimary ? <Tooltip title="主网卡无法卸载">卸载</Tooltip> : '卸载',
              disabled: isPrimary,
              danger: true,
            }
          ]}
          onClick={({ key }) => {
            if (key === 'bind') {
              setActiveNiId(niId);
              setActivePriIp(priIp);
              setBindEipId('');
              setBindOpen(true);
            } else if (key === 'unbind') {
              setActiveNiId(niId);
              setActivePriIp(priIp);
              setUnbindEipId('');
              setUnbindOpen(true);
            } else if (key === 'detach') {
              Modal.confirm({
                title: '确定卸载该网卡?',
                content: `网卡ID: ${niId}`,
                onOk: () => handleDetachEni(niId)
              });
            }
          }}
        />
      );
    }
  });
  const modalBindOptions = availableEips.map(x => ({
    label: `${x?.IpAddress || x?.public_ip_address || x?.publicip_address || x?.ip_address || '-'}（${x?.AllocationId || x?.allocation_id || x?.id || x?.publicip_id || '-'}）`,
    value: String(x?.AllocationId || x?.allocation_id || x?.id || x?.publicip_id || '')
  }));
  const modalUnbindOptions = (Array.isArray(eips) ? eips : []).filter((x: any) => {
    const type = String(x?.InstanceType || x?.instance_type || '').toLowerCase();
    const eniByType = (type === 'networkinterface') ? (x?.InstanceId || x?.instance_id || '') : '';
    const eniByField = x?.NetworkInterfaceId || x?.port_id || '';
    const target = String(activeNiId || '');
    return String(eniByField || '') === target || String(eniByType || '') === target;
  }).map(x => ({
    label: `${x?.IpAddress || x?.public_ip_address || x?.publicip_address || x?.ip_address || '-'}（${x?.AllocationId || x?.allocation_id || x?.id || x?.publicip_id || '-'}）`,
    value: String(x?.AllocationId || x?.allocation_id || x?.id || x?.publicip_id || '')
  }));
  const rowKeyFn = (r: any) => {
    const id = r?.NetworkInterfaceId || r?.id || r?.Id;
    const ip = Array.isArray(r?.PrivateIpAddress?.IpAddress) ? r?.PrivateIpAddress?.IpAddress[0] : '';
    const vsw = r?.VSwitchId || '';
    return id || `${vsw}-${ip}`;
  };
  return (
    <PageDetailSection
      toolbarLeft={(
        <Space size={8}>
          <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
          <Select
            placeholder="绑定状态"
            allowClear
            value={bindFilter}
            onChange={(v) => setBindFilter(v as any)}
            style={{ width: 160 }}
            options={[{ label: '已绑定EIP', value: 'bound' }, { label: '未绑定EIP', value: 'unbound' }]}
          />
          <Select
            placeholder="类型"
            allowClear
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as any)}
            style={{ width: 160 }}
            options={[
              ...Array.from(new Set((eniList || []).map((r: any) => String(r?.Type || '').trim()).filter(Boolean))).map(t => ({ label: t, value: t }))
            ]}
          />
        </Space>
      )}
      toolbarRight={(
        <Space size={8}>
          <Button type="primary" onClick={() => { setCreateOpen(true); }}>{'创建网卡'}</Button>
          <Button onClick={handleOpenBindModal}>{'绑定网卡'}</Button>
          <Button icon={<ReloadOutlined />} onClick={async () => { try { const evt = typeof window !== 'undefined' ? new CustomEvent('refreshEips') : null; if (evt && typeof window !== 'undefined') window.dispatchEvent(evt); } catch {} if (onRefreshAll) await onRefreshAll(); }} />
        </Space>
      )}
    >
      <Table
        size="small"
        bordered={false}
        tableLayout="auto"
        rowKey={rowKeyFn}
        columns={cols as any}
        dataSource={filteredEniList}
        pagination={false}
      />
      <StdFormModal
        open={createOpen}
        title="创建弹性网卡"
        form={createForm}
        initialValues={initialCreateValues}
        onCancel={() => setCreateOpen(false)}
        onFinish={async (values) => {
          try {
            setCreateLoading(true);
            await createCloudProviderEni(cloudId, {
              vSwitchId: values.vSwitchId,
              securityGroupId: values.securityGroupId,
              name: values.name,
              description: values.description,
              ipv4Address: values.ipv4Address
            });
            message.success('网卡创建成功');
            setCreateOpen(false);
            if (onRefreshAll) await onRefreshAll();
          } catch (e: any) {
            message.error(e?.message || '创建网卡失败');
          } finally {
            setCreateLoading(false);
          }
        }}
        confirmLoading={createLoading}
      >
        <Form.Item
          name="vSwitchId"
          label="VSwitch ID"
          rules={[{ required: true, message: '请输入 VSwitch ID' }]}
        >
          <Input placeholder="VSwitch ID" />
        </Form.Item>
        <Form.Item
          name="securityGroupId"
          label="SecurityGroup ID"
          rules={[{ required: true, message: '请输入 SecurityGroup ID' }]}
        >
          <Input placeholder="SecurityGroup ID" />
        </Form.Item>
        <Form.Item name="name" label="名称">
          <Input placeholder="名称（可选）" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input placeholder="描述（可选）" />
        </Form.Item>
        <Form.Item name="ipv4Address" label="私有IPv4">
          <Input placeholder="私有IPv4（可选）" />
        </Form.Item>
      </StdFormModal>
      <Modal
        open={bindOpen}
        title="绑定弹性公网IP到网卡"
        onCancel={() => { if (opLoading) return; setBindOpen(false); }}
        onOk={async () => {
          if (!bindEipId || !activeNiId) return;
          try {
            setOpLoading(true);
            await associateAliyunEip(cloudId, bindEipId, { NetworkInterfaceId: activeNiId, ...(activePriIp ? { PrivateIpAddress: activePriIp } : {}) });
            setBindOpen(false);
            setBindEipId('');
            message.success('EIP已绑定到网卡');
            try { const evt = typeof window !== 'undefined' ? new CustomEvent('refreshEips') : null; if (evt && typeof window !== 'undefined') window.dispatchEvent(evt); } catch {}
            if (onRefreshAll) await onRefreshAll();
          } catch (e: any) {
            message.error(e?.message || '绑定EIP失败');
          } finally {
            setOpLoading(false);
          }
        }}
        confirmLoading={opLoading}
        okButtonProps={{ disabled: !bindEipId }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            style={{ width: '100%' }}
            placeholder="选择可用 EIP"
            value={bindEipId}
            onChange={(v) => setBindEipId(String(v || ''))}
            options={modalBindOptions}
          />
        </Space>
      </Modal>
      <Modal
        open={unbindOpen}
        title="从网卡解绑弹性公网IP"
        onCancel={() => { if (opLoading) return; setUnbindOpen(false); }}
        onOk={async () => {
          if (!unbindEipId || !activeNiId) return;
          try {
            setOpLoading(true);
            await unassociateAliyunEip(cloudId, unbindEipId, { NetworkInterfaceId: activeNiId, ...(activePriIp ? { PrivateIpAddress: activePriIp } : {}) });
            setUnbindOpen(false);
            setUnbindEipId('');
            message.success('EIP已从网卡解绑');
            try { const evt = typeof window !== 'undefined' ? new CustomEvent('refreshEips') : null; if (evt && typeof window !== 'undefined') window.dispatchEvent(evt); } catch {}
            if (onRefreshAll) await onRefreshAll();
          } catch (e: any) {
            message.error(e?.message || '解绑EIP失败');
          } finally {
            setOpLoading(false);
          }
        }}
        confirmLoading={opLoading}
        okButtonProps={{ disabled: !unbindEipId }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            style={{ width: '100%' }}
            placeholder="选择已绑定的 EIP"
            value={unbindEipId}
            onChange={(v) => setUnbindEipId(String(v || ''))}
            options={modalUnbindOptions}
          />
        </Space>
      </Modal>
      <Modal
        open={bindNiOpen}
        title="绑定弹性网卡"
        onCancel={() => { if (attachLoading) return; setBindNiOpen(false); }}
        onOk={handleAttachEni}
        confirmLoading={attachLoading}
        okButtonProps={{ disabled: !bindNiId }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            style={{ width: '100%' }}
            placeholder="选择可用网卡"
            value={bindNiId}
            onChange={(v) => setBindNiId(v)}
            loading={loadingEnis}
            options={availableEnis.map((x: any) => {
              const id = x?.NetworkInterfaceId || x?.id || x?.Id || '';
              const name = x?.NetworkInterfaceName || x?.name || '';
              const ip = x?.PrimaryIpAddress || '';
              return {
                label: `${name ? name + ' ' : ''}${id}${ip ? ' (' + ip + ')' : ''}`,
                value: id
              };
            })}
          />
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center' }}>
            <span style={{ marginRight: 8 }}>网卡索引:</span>
            <InputNumber
              placeholder="可选"
              style={{ width: 150 }}
              min={0}
              value={bindNetworkCardIndex}
              onChange={(v) => setBindNetworkCardIndex(v === null ? undefined : v)}
            />
          </div>
          <div style={{ marginTop: 8 }}>
            <Checkbox
              checked={bindWaitForNetworkReady}
              onChange={(e) => setBindWaitForNetworkReady(e.target.checked)}
            >
              等待网络配置就绪 (WaitForNetworkConfigurationReady)
            </Checkbox>
          </div>
          {availableEnis.length === 0 && !loadingEnis && (
            <div style={{ color: '#999', marginTop: 8 }}>
              当前地域/VPC/可用区下无可用网卡
            </div>
          )}
        </Space>
      </Modal>
    </PageDetailSection>
  );
};

(NetworkInterfaceSectionAliyun as any).tabMeta = {
  key: 'network',
  title: '弹性网卡',
  icon: <DeploymentUnitOutlined style={{ color: '#1677FF' }} />,
  countOf: (p: any) => {
    const list: any[] = Array.isArray(p?.enis) ? p.enis : [];
    return list.length;
  },
};

export default NetworkInterfaceSectionAliyun;
