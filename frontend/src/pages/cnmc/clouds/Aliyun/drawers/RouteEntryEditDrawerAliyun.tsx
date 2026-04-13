import React from 'react';
import { App, Form, Input, Select } from 'antd';
import StdSideDrawer from '../../../../../components/StdSideDrawer';
import { fetchCloudProviderRouteEntries, modCloudProviderRouteEntry } from '../../../../../services/aliyunApi';
import { collectInstanceIpv4 } from '../../Hw/components/Common';

type Props = {
  open: boolean;
  cloudId: string;
  ecs: any[];
  routeTableTarget: any | null;
  editTarget: any | null;
  onClose: () => void;
  onUpdated: (entries: any[]) => void;
};

const RouteEntryEditDrawerAliyun: React.FC<Props> = ({ open, cloudId, ecs, routeTableTarget, editTarget, onClose, onUpdated }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

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

  return (
    <StdSideDrawer
      open={open}
      title="编辑路由条目"
      width={640}
      styles={{ body: { padding: 24 } }}
      onClose={onClose}
      onOk={()=> form.submit()}
      okText="保存"
    >
      <Form form={form} layout="vertical" onFinish={async (values:any)=>{
        try {
          const id0 = routeTableTarget?.RouteTableId || routeTableTarget?.id; if (!id0 || !editTarget) return;
          const t = String(values?.type || 'ecs').toLowerCase();
          const nh = t==='ecs' ? (values.instanceId || values.nexthop) : values.nexthop;
          await modCloudProviderRouteEntry(cloudId, id0, { type: t, destination: values.destination, nexthop: nh, description: values.description });
          await refresh(id0);
          onClose();
          message.success('更新成功');
        } catch (e:any) {
          const raw = String(e?.message || '').trim();
          try { const obj = JSON.parse(raw); const msg = obj?.message || '更新失败'; const detail = obj?.error ? `：${obj.error}` : ''; message.error(`${msg}${detail}`); }
          catch { message.error(raw || '更新失败'); }
        }
      }}>
        <Form.Item name="type" initialValue="ecs" label="下一跳类型"> <Select options={[{ label: '服务器实例', value: 'ecs' }, { label: '扩展网卡', value: 'eni' }, { label: '虚拟IP', value: 'vip' }, { label: 'NAT网关', value: 'nat' }, { label: '云连接', value: 'pcn' }]} /> </Form.Item>
        <Form.Item name="destination" label="目的网段" rules={[{ required: true, message: '请输入目的网段' }, { validator: (_:any, value:string)=>{ const v = String(value||'').trim(); if (!v) return Promise.resolve(); const m = v.match(new RegExp('^((25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\/(3[0-2]|[12]?\\d|0)$')); if (!m) return Promise.reject('请输入有效的IPv4 CIDR，例如 10.0.0.0/24'); const ip = v.split('/')[0]; const mask = v.split('/')[1]; if (mask === '0' && ip !== '0.0.0.0') return Promise.reject('仅默认路由可使用 /0 网络：0.0.0.0/0'); return Promise.resolve(); } }]}>
          <Input placeholder="例如 10.0.0.0/24" />
        </Form.Item>
        <Form.Item shouldUpdate noStyle>
          {()=>{
            const ecsOptions = (ecs||[]).map((s:any)=> ({ label: `${s?.InstanceName || s?.name || s?.InstanceId || s?.id || '-'}`, value: s?.InstanceId || s?.id }));
            const typ = String(form.getFieldValue('type') || 'ecs').toLowerCase();
            const instId = form.getFieldValue('instanceId');
            const inst = (ecs||[]).find((s:any)=> String((s?.InstanceId||s?.id)||'') === String(instId||''));
            const addrsRaw = inst?.VpcAttributes?.PrivateIpAddress?.IpAddress || inst?.addresses;
            return (
              <>
                {typ==='ecs' ? (
                  <>
                    <Form.Item name="instanceId" label="ECS实例" rules={[{ required: true }]}> <Select showSearch optionFilterProp="label" placeholder="选择实例" options={ecsOptions} onChange={(v)=> form.setFieldsValue({ ecsIp: undefined, nexthop: v })} /> </Form.Item>
                    <Form.Item name="ecsIp" label="实例IP"> <Select showSearch optionFilterProp="label" placeholder="选择IP" options={collectInstanceIpv4(addrsRaw).map((ip:string)=> ({ label: ip, value: ip }))} /> </Form.Item>
                  </>
                ) : (
                  <Form.Item name="nexthop" label="下一跳" rules={[{ required: true }]}> <Input placeholder="资源ID" /> </Form.Item>
                )}
              </>
            );
          }}
        </Form.Item>
        <Form.Item name="description" label="描述"> <Input placeholder="描述" /> </Form.Item>
        <Form.Item name="nexthop" hidden> <Input /> </Form.Item>
      </Form>
    </StdSideDrawer>
  );
};

export default RouteEntryEditDrawerAliyun;
