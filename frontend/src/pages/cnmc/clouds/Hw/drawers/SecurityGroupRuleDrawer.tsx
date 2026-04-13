import React, { useEffect } from 'react';
import { App, Form, Input, InputNumber, Select, Dropdown, Button, Space } from 'antd';
import StdSideDrawer from '../../../../../components/StdSideDrawer';
import { showCloudProviderSecurityGroup, createHuaweiCloudSecurityGroupRule, updateHuaweiCloudSecurityGroupRule } from '../../../../../services/huaweiApi';
import { normalizeErr } from '../utils/net';

type Props = {
  open: boolean;
  cloudId: string;
  secGroups: any[];
  target: any | null;
  tab: string;
  editTarget: any | null;
  onClose: () => void;
  onUpdated: (group: any) => void;
};

const SecurityGroupRuleDrawer: React.FC<Props> = ({ open, cloudId, secGroups, target, tab, editTarget, onClose, onUpdated }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const protoWatch = Form.useWatch('protocol', form);
  const portMinWatch = Form.useWatch('port_min', form);
  const portMaxWatch = Form.useWatch('port_max', form);

  useEffect(() => {
    if (!open) return;
    const prefill = () => {
      if (editTarget) {
        const srcType = editTarget?.remote_group_id ? 'group' : 'ip';
        form.setFieldsValue({
          direction: tab,
          protocol: editTarget?.protocol,
          ethertype: editTarget?.ethertype,
          port_min: editTarget?.port_min,
          port_max: editTarget?.port_max,
          source_type: srcType,
          remote_group_id: editTarget?.remote_group_id,
          remote_ip_prefix: editTarget?.remote_ip_prefix,
          description: editTarget?.description,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ direction: tab, protocol: 'tcp', ethertype: 'ipv4', source_type: 'ip' });
      }
    };
    setTimeout(prefill, 0);
  }, [open, editTarget, tab, form]);

  const refreshGroup = async (gid: string) => {
    const resp: any = await showCloudProviderSecurityGroup(cloudId, String(gid));
    const data0: any = resp?.data || resp;
    const data: any = data0?.security_group || data0?.securityGroup || data0?.securitygroup || data0;
    onUpdated(data);
  };

  return (
    <StdSideDrawer
      open={open}
      title={editTarget ? '编辑规则' : '新增规则'}
      width={640}
      styles={{ body: { padding: 24 }, footer: { padding: '16px 24px' } }}
      onClose={onClose}
      onOk={()=> form.submit()}
      okText={editTarget ? '保存' : '创建'}
    >
      <Form form={form} layout="horizontal" labelAlign="left" style={{ width: 560 }} labelCol={{ flex: '140px' }} wrapperCol={{ style: { width: 400, marginLeft: 16 } }} onFinish={async (values:any)=>{
        try {
          const gid = target?.id || target?.SecurityGroupId; if (!gid) return;
          const dir = String(values.direction||'').toLowerCase() || String(tab||'').toLowerCase();
          const proto = String(values.protocol||'').toLowerCase();
          const pm = values.port_min!=null ? parseInt(String(values.port_min)) : undefined;
          const px = values.port_max!=null ? parseInt(String(values.port_max)) : undefined;
          const cidr = String(values.remote_ip_prefix||'');
          const desc = String(values.description||'');
          const eth = String(values.ethertype||'').toLowerCase() || undefined;
          const st = String(values.source_type||'').toLowerCase();
          const base = { direction: dir, protocol: proto, ethertype: eth, port_range_min: pm, port_range_max: px, description: desc || undefined } as any;
          if (st === 'group') { base.remote_group_id = values.remote_group_id ? String(values.remote_group_id) : undefined; }
          else { base.remote_ip_prefix = cidr || undefined; }
          if (editTarget && editTarget.id) { await updateHuaweiCloudSecurityGroupRule(cloudId, String(gid), String(editTarget.id), base); message.success('已更新规则'); }
          else { await createHuaweiCloudSecurityGroupRule(cloudId, String(gid), base); message.success('已新增规则'); }
          await refreshGroup(String(gid));
          onClose();
        } catch(e:any){ message.error(normalizeErr(e, '提交失败')); }
      }}>
        <Form.Item name="direction" label="方向">
          <Select placeholder="选择方向" options={[{ label:'ingress', value:'ingress' }, { label:'egress', value:'egress' }]} style={{ width: 400 }} />
        </Form.Item>
        <Form.Item name="ethertype" label="类型">
          <Select placeholder="选择类型" options={[{ label:'IPv4', value:'ipv4' }, { label:'IPv6', value:'ipv6' }]} style={{ width: 400 }} />
        </Form.Item>
        <Form.Item name="action" label="策略" initialValue="allow">
          <Select options={[{ label:'允许', value:'allow' }]} disabled style={{ width: 400 }} />
        </Form.Item>
        <Form.Item label="协议端口">
          <Dropdown
            menu={{
              items: [
                { key: 'basic', label: '基本协议', children: [
                  { key: 'all', label: '全部协议' },
                  { key: 'tcp-all', label: '全部TCP' },
                  { key: 'udp-all', label: '全部UDP' },
                  { key: 'tcp-custom', label: '自定义TCP' },
                  { key: 'udp-custom', label: '自定义UDP' },
                  { key: 'icmp', label: 'ICMP' },
                ] },
                { key: 'common', label: '常用协议端口', children: [
                  { key: 'http-80', label: 'HTTP 80' },
                  { key: 'https-443', label: 'HTTPS 443' },
                  { key: 'ssh-22', label: 'SSH 22' },
                  { key: 'rdp-3389', label: 'RDP 3389' },
                ] }
              ],
              onClick: ({ key }) => {
                if (key==='all') form.setFieldsValue({ protocol:'all', port_min: undefined, port_max: undefined });
                else if (key==='tcp-all') form.setFieldsValue({ protocol:'tcp', port_min: 1, port_max: 65535 });
                else if (key==='udp-all') form.setFieldsValue({ protocol:'udp', port_min: 1, port_max: 65535 });
                else if (key==='tcp-custom') form.setFieldsValue({ protocol:'tcp', port_min: undefined, port_max: undefined });
                else if (key==='udp-custom') form.setFieldsValue({ protocol:'udp', port_min: undefined, port_max: undefined });
                else if (key==='icmp') form.setFieldsValue({ protocol:'icmp', port_min: undefined, port_max: undefined });
                else if (key==='http-80') form.setFieldsValue({ protocol:'tcp', port_min:80, port_max:80 });
                else if (key==='https-443') form.setFieldsValue({ protocol:'tcp', port_min:443, port_max:443 });
                else if (key==='ssh-22') form.setFieldsValue({ protocol:'tcp', port_min:22, port_max:22 });
                else if (key==='rdp-3389') form.setFieldsValue({ protocol:'tcp', port_min:3389, port_max:3389 });
              }
            }}
          >
            <Button style={{ width: 400 }}>
              {(() => { const p = String(protoWatch||'').toLowerCase(); const pm = portMinWatch; const px = portMaxWatch; if (p==='all') return '基本协议 / 全部协议'; if (p==='icmp') return '基本协议 / ICMP'; if (p==='tcp' && pm===1 && px===65535) return '基本协议 / 全部TCP'; if (p==='udp' && pm===1 && px===65535) return '基本协议 / 全部UDP'; if (p==='tcp' && pm!=null && px!=null && pm===px) return `常用协议端口 / TCP ${pm}`; if (p==='udp' && pm!=null && px!=null && pm===px) return `常用协议端口 / UDP ${pm}`; if (p==='tcp') return '基本协议 / 自定义TCP'; if (p==='udp') return '基本协议 / 自定义UDP'; return '基本协议 / 全部协议'; })()}
            </Button>
          </Dropdown>
        </Form.Item>
        <Form.Item name="protocol" label="协议" rules={[{ required: true, message: '请选择协议' }]}> 
          <Select options={[{ label:'tcp', value:'tcp' }, { label:'udp', value:'udp' }, { label:'icmp', value:'icmp' }, { label:'all', value:'all' }]} style={{ width: 400 }} onChange={(val)=>{ const p=String(val||'').toLowerCase(); if (p!=='tcp' && p!=='udp') form.setFieldsValue({ port_min: undefined, port_max: undefined }); }} />
        </Form.Item>
        <Form.Item shouldUpdate noStyle>
          {({ getFieldValue }) => {
            const p = String(getFieldValue('protocol') || '').toLowerCase();
            const showPorts = p==='tcp' || p==='udp';
            return showPorts ? (
              <Form.Item label="端口范围" wrapperCol={{ style: { width: 400, marginLeft: 16 } }}>
                <Space>
                  <Form.Item name="port_min" noStyle>
                    <InputNumber min={1} max={65535} placeholder="最小" style={{ width: 190 }} />
                  </Form.Item>
                  <span style={{ width: 20, textAlign: 'center' }}>-</span>
                  <Form.Item name="port_max" noStyle rules={[{ validator: async (_, value) => { const pm = form.getFieldValue('port_min'); if (pm==null || value==null) return Promise.resolve(); const a = Number(pm); const b = Number(value); if (Number.isNaN(a) || Number.isNaN(b)) return Promise.resolve(); if (a > b) return Promise.reject(new Error('端口范围不合法：最小值不能大于最大值')); return Promise.resolve(); } }] }>
                    <InputNumber min={1} max={65535} placeholder="最大" style={{ width: 190 }} />
                  </Form.Item>
                </Space>
              </Form.Item>
            ) : null;
          }}
        </Form.Item>
        <Form.Item name="source_type" label="源地址">
          <Select options={[{ label:'IP地址', value:'ip' }, { label:'安全组', value:'group' }]} style={{ width: 400 }} />
        </Form.Item>
        <Form.Item shouldUpdate noStyle>
          {({ getFieldValue }) => {
            const src = String(getFieldValue('source_type') || 'ip');
            return src==='group' ? (
              <Form.Item name="remote_group_id" label="安全组" rules={[{ required: true, message: '请选择安全组' }]}> 
                <Select options={(secGroups||[]).map((g:any)=> ({ label: g?.name || g?.SecurityGroupName || g?.id || g?.SecurityGroupId, value: g?.id || g?.SecurityGroupId }))} showSearch style={{ width: 400 }} />
              </Form.Item>
            ) : (
              <Form.Item name="remote_ip_prefix" label="源CIDR" rules={[{ required: true, message: '请输入CIDR' }, { validator: async (_, value) => { const v = String(value||'').trim(); if (!v) return Promise.resolve(); const et = String(form.getFieldValue('ethertype')||'ipv4').toLowerCase(); if (et==='ipv6') { const parts = v.split('/'); if (parts.length!==2) return Promise.reject(new Error('CIDR 格式错误')); const mask = parseInt(parts[1], 10); if (!(mask>=0 && mask<=128)) return Promise.reject(new Error('IPv6 掩码范围为 0-128')); if (!v.includes(':')) return Promise.reject(new Error('IPv6 地址格式错误')); return Promise.resolve(); } else { const m = v.match(/^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(3[0-2]|[12]?\d)$/); if (!m) return Promise.reject(new Error('IPv4 CIDR 格式错误，如 10.0.0.0/16')); return Promise.resolve(); } } } ]}> 
                <Input placeholder={(() => { const et=String(form.getFieldValue('ethertype')||'ipv4').toLowerCase(); return et==='ipv6' ? '如 ::/0 或 2001:db8::/32' : '如 0.0.0.0/0 或 10.0.0.0/16'; })()} style={{ width: 400 }} />
              </Form.Item>
            );
          }}
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input placeholder="可选" style={{ width: 400 }} />
        </Form.Item>
      </Form>
    </StdSideDrawer>
  );
};

export default SecurityGroupRuleDrawer;