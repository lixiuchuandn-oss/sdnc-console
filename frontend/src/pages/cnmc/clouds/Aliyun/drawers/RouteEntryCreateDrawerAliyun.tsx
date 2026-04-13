import React, { useEffect, useState } from 'react';
import { App, Form, Input, Select } from 'antd';
import StdSideDrawer from '../../../../../components/StdSideDrawer';
import { fetchCloudProviderRouteEntries, addCloudProviderRouteEntry, fetchCloudProviderNatGateways, fetchCloudProviderEnis, fetchCloudProviderVpnGateways } from '../../../../../services/aliyunApi';
import { collectInstanceIpv4 } from '../../Hw/components/Common';

type Props = {
  open: boolean;
  cloudId: string;
  ecs: any[];
  routeTableTarget: any | null;
  onClose: () => void;
  onUpdated: (entries: any[]) => void;
};

const RouteEntryCreateDrawerAliyun: React.FC<Props> = ({ open, cloudId, ecs, routeTableTarget, onClose, onUpdated }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  
  const [nats, setNats] = useState<any[]>([]);
  const [enis, setEnis] = useState<any[]>([]);
  const [vpns, setVpns] = useState<any[]>([]);

  useEffect(() => { if (!open) form.resetFields(); }, [open, form]);

  const extractEntries = (json: any): any[] => {
    const d = (json && (json as any).data) ? (json as any).data : json;
    const arr = Array.isArray(d)
      ? d
      : Array.isArray((d || {}).RouteEntries?.RouteEntry)
      ? (d || {}).RouteEntries.RouteEntry
      : Array.isArray((d || {}).route_entries)
      ? (d || {}).route_entries
      : Array.isArray((json || {}).RouteEntries?.RouteEntry)
      ? (json || {}).RouteEntries.RouteEntry
      : Array.isArray((json || {}).route_entries)
      ? (json || {}).route_entries
      : [];
    return Array.isArray(arr) ? arr : [];
  };

  const refresh = async (rtId: string) => {
    try {
      const json = await fetchCloudProviderRouteEntries(cloudId, rtId);
      const list = extractEntries(json);
      onUpdated(Array.isArray(list) ? list : []);
    } catch (e:any) { message.error(e?.message || '加载路由条目失败'); }
  };

  const type = Form.useWatch('type', form);

  useEffect(() => {
    if (!open) return;
    const t = String(type || 'ecs').toLowerCase();
    
    if (t === 'nat' && nats.length === 0) {
      fetchCloudProviderNatGateways(cloudId).then((res: any) => {
        const list = res?.data?.NatGateways?.NatGateway || [];
        setNats(Array.isArray(list) ? list : []);
      }).catch(() => {});
    } else if (t === 'eni' && enis.length === 0) {
      // For ENI, we might want to filter by VPC, but route table can accept any ENI in VPC.
      // fetchCloudProviderEnis expects params. Let's pass vpcId if available.
      const vpcId = routeTableTarget?.VpcId || routeTableTarget?.vpc_id;
      fetchCloudProviderEnis(cloudId, { vpcId }).then((res: any) => {
        const list = res?.data?.NetworkInterfaces?.NetworkInterface || [];
        setEnis(Array.isArray(list) ? list : []);
      }).catch(() => {});
    } else if (t === 'vpn' && vpns.length === 0) {
      fetchCloudProviderVpnGateways(cloudId).then((res: any) => {
        const list = res?.data?.VpnGateways?.VpnGateway || [];
        setVpns(Array.isArray(list) ? list : []);
      }).catch(() => {});
    }
  }, [open, type, cloudId, nats.length, enis.length, vpns.length, routeTableTarget]);

  return (
    <StdSideDrawer
      open={open}
      title="添加路由条目"
      width={640}
      styles={{ body: { padding: 24 } }}
      onClose={onClose}
      onOk={()=> form.submit()}
      okText="创建"
    >
      <Form form={form} layout="vertical" onFinish={async (values:any)=>{
        try {
          const id0 = routeTableTarget?.RouteTableId || routeTableTarget?.id; if (!id0) return;
          const t = String(values?.type || 'ecs').toLowerCase();
          let nh = values.nexthop;
          if (t === 'ecs') nh = values.instanceId || values.nexthop;
          
          await addCloudProviderRouteEntry(cloudId, id0, { type: t, destination: values.destination, nexthop: nh, description: values.description });
          await refresh(id0);
          message.success('新增成功');
          onClose();
        } catch (e:any) { message.error(e?.message || '新增失败'); }
      }}>
        <Form.Item name="type" initialValue="instance" label="下一跳类型">
          <Select options={[
            { label: '服务器实例 (ECS)', value: 'instance' },
            { label: '弹性网卡 (ENI)', value: 'networkinterface' },
            { label: 'VPN网关 (VPN)', value: 'vpngateway' },
            { label: 'NAT网关 (NAT)', value: 'natgateway' },
            { label: '虚拟IP (HaVip)', value: 'havip' },
            { label: '云连接 (RouterInterface)', value: 'routerinterface' },
            { label: 'IPv6网关', value: 'ipv6gateway' }
          ]} />
        </Form.Item>
        <Form.Item name="destination" label="目的网段" rules={[{ required: true, message: '请输入目的网段' }, { validator: (_:any, value:string)=>{ const v = String(value||'').trim(); if (!v) return Promise.resolve(); const m = v.match(new RegExp('^((25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\/(3[0-2]|[12]?\\d|0)$')); if (!m) return Promise.reject('请输入有效的IPv4 CIDR，例如 10.0.0.0/24'); const ip = v.split('/')[0]; const mask = v.split('/')[1]; if (mask === '0' && ip !== '0.0.0.0') return Promise.reject('仅默认路由可使用 /0 网络：0.0.0.0/0'); return Promise.resolve(); } }]}> <Input placeholder="例如 0.0.0.0/0" /> </Form.Item>
        <Form.Item shouldUpdate noStyle>
          {()=>{
            const typ = String(form.getFieldValue('type') || 'instance').toLowerCase();
            
            if (typ === 'instance' || typ === 'ecs') {
              const ecsOptions = (ecs||[]).map((s:any)=> ({ label: `${s?.InstanceName || s?.name || s?.InstanceId || s?.id || '-'}`, value: s?.InstanceId || s?.id }));
              const instId = form.getFieldValue('instanceId');
              const inst = (ecs||[]).find((s:any)=> String((s?.InstanceId||s?.id)||'') === String(instId||''));
              const addrsRaw = inst?.VpcAttributes?.PrivateIpAddress?.IpAddress || inst?.addresses;
              return (
                <>
                  <Form.Item name="instanceId" label="ECS实例" rules={[{ required: true }]}> <Select showSearch optionFilterProp="label" placeholder="选择实例" options={ecsOptions} onChange={(v)=> form.setFieldsValue({ ecsIp: undefined, nexthop: v })} /> </Form.Item>
                  <Form.Item name="ecsIp" label="实例IP"> <Select showSearch optionFilterProp="label" placeholder="选择IP" options={collectInstanceIpv4(addrsRaw).map((ip:string)=> ({ label: ip, value: ip }))} /> </Form.Item>
                </>
              );
            }

            if (typ === 'natgateway' || typ === 'nat') {
               const opts = nats.map((n:any) => ({ label: `${n.Name || n.NatGatewayName || n.NatGatewayId} (${n.NatGatewayId})`, value: n.NatGatewayId }));
               return <Form.Item name="nexthop" label="选择NAT网关" rules={[{ required: true }]}> <Select showSearch optionFilterProp="label" options={opts} placeholder="选择NAT网关" /> </Form.Item>;
            }

            if (typ === 'networkinterface' || typ === 'eni') {
               const opts = enis.map((n:any) => ({ label: `${n.NetworkInterfaceName || n.Name || n.NetworkInterfaceId} (${n.PrivateIpAddress})`, value: n.NetworkInterfaceId }));
               return <Form.Item name="nexthop" label="选择弹性网卡" rules={[{ required: true }]}> <Select showSearch optionFilterProp="label" options={opts} placeholder="选择弹性网卡" /> </Form.Item>;
            }

            if (typ === 'vpngateway' || typ === 'vpn') {
               const opts = vpns.map((n:any) => ({ label: `${n.Name || n.VpnGatewayName || n.VpnGatewayId}`, value: n.VpnGatewayId }));
               return <Form.Item name="nexthop" label="选择VPN网关" rules={[{ required: true }]}> <Select showSearch optionFilterProp="label" options={opts} placeholder="选择VPN网关" /> </Form.Item>;
            }

            return <Form.Item name="nexthop" label="下一跳ID" rules={[{ required: true }]}> <Input placeholder="资源ID" /> </Form.Item>;
          }}
        </Form.Item>
        <Form.Item name="description" label="描述"> <Input placeholder="描述" /> </Form.Item>
        <Form.Item name="nexthop" hidden> <Input /> </Form.Item>
      </Form>
    </StdSideDrawer>
  );
};

export default RouteEntryCreateDrawerAliyun;
