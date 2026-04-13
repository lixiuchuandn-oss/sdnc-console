import React, { useState } from 'react';
import { App, Form, Input, Select } from 'antd';
import StdFormModal from '../../../../../components/StdFormModal';
import { fetchCloudProviderSubnets } from '../../../../../services/api';
import { createHuaweiCloudSubnet } from '../../../../../services/huaweiApi';
import { parseCidrNum, samePrefix, rangesOverlap, normalizeErr } from '../utils/net';

type Props = {
  open: boolean;
  cloudId: string;
  vpcs: any[];
  subnets: any[];
  onClose: () => void;
  onSuccess: (subnets: any[]) => void;
};

const SubnetCreateModal: React.FC<Props> = ({ open, cloudId, vpcs, subnets, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [subnetVpcCidr, setSubnetVpcCidr] = useState<string>('');

  return (
    <StdFormModal
      open={open}
      title="创建子网"
      form={form}
      onCancel={onClose}
      onFinish={async (values: any) => {
        try {
          await createHuaweiCloudSubnet(cloudId, { vpc_id: values.vpcId, cidr: values.cidr, ipv6_cidr: values.ipv6_cidr || undefined, name: values.name, gateway_ip: values.gateway_ip, dhcp_enable: values.dhcp_enable, primary_dns: values.primary_dns, secondary_dns: values.secondary_dns });
          const json = await fetchCloudProviderSubnets(cloudId);
          const subnetList: any[] = (json?.data?.subnets) || (json?.subnets) || [];
          onSuccess(Array.isArray(subnetList) ? subnetList : []);
          message.success('创建成功');
          onClose();
        } catch (e: any) { message.error(normalizeErr(e, '创建失败')); }
      }}
    >
      <Form.Item name="vpcId" label="VPC" rules={[{ required: true }]} extra={<span>VPC IPv4 CIDR：{subnetVpcCidr || '-'}</span>}> 
        <Select placeholder="选择VPC" options={(vpcs||[]).map((v:any)=> ({ label: `${v?.name || v?.id || '-'}`, value: v?.id }))} onChange={(val:string)=>{ const vp = (vpcs||[]).find((x:any)=> String(x?.id||'')===String(val||'')); setSubnetVpcCidr(vp?.cidr || ''); }} />
      </Form.Item>
      <Form.Item name="name" label="名称" validateTrigger={["onChange","onBlur","onSubmit"]} rules={[{ required: true, transform: (v:any)=> String(v||'').trim(), message: '请输入名称' }]}> <Input placeholder="请输入名称" /> </Form.Item>
      <Form.Item name="cidr" label="IPv4 CIDR" validateTrigger={["onChange","onBlur","onSubmit"]} rules={[
        { required: true, transform: (v:any)=> String(v||'').trim(), message: '请输入IPv4 CIDR' },
        { validator: (_:any, value:string)=>{
          const v = String(value||'').trim();
          if (!v) return Promise.resolve();
          const re4 = new RegExp('^((25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\/(3[0-2]|[12]?\\d)$');
          if (!re4.test(v)) return Promise.reject('请输入有效的IPv4 CIDR，例如 192.168.1.0/24');
          const vpcId = form.getFieldValue('vpcId');
          const vpc = (vpcs||[]).find((x:any)=> String(x?.id||'')===String(vpcId||''));
          if (vpc && vpc.cidr) {
            const s = parseCidrNum(v);
            const vc = parseCidrNum(String(vpc.cidr));
            if (s.maskLen < vc.maskLen || s.maskLen > 28) return Promise.reject('子网掩码必须介于VPC掩码与/28之间');
            if (!samePrefix(s, vc)) return Promise.reject('子网CIDR必须在所选VPC的CIDR范围内');
            const existed = (subnets||[]).filter((sn:any)=> String(sn?.vpc_id||'')===String(vpcId||'') && sn?.cidr).map((sn:any)=> parseCidrNum(String(sn.cidr)));
            if (existed.some((e:any)=> rangesOverlap(s, e))) return Promise.reject('子网CIDR与当前VPC已有子网重叠');
          }
          return Promise.resolve();
        }}
      ]}> <Input placeholder="例如 192.168.1.0/24" /> </Form.Item>
      <Form.Item shouldUpdate noStyle>
        {({ getFieldValue }) => {
          const v6 = String(getFieldValue('ipv6_cidr') || '').trim();
          const ok6 = new RegExp('^([0-9a-fA-F:]+)\\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$').test(v6);
          const tip6 = v6 ? (<span style={{ color: ok6 ? '#52c41a' : '#ff4d4f' }}>{ok6 ? 'CIDR 合法' : 'CIDR 格式不合法'}</span>) : null;
          return (
            <Form.Item name="ipv6_cidr" label="IPv6 CIDR（可选）" validateFirst validateTrigger={["onChange","onBlur","onSubmit"]} rules={[{ validator: (_:any, val:string)=>{ const v = String(val||'').trim(); if (!v) return Promise.resolve(); const re6 = new RegExp('^([0-9a-fA-F:]+)\\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$'); return re6.test(v) ? Promise.resolve() : Promise.reject('请输入合法IPv6 CIDR，如 2408:4000::/48'); } }]} extra={tip6}>
              <Input placeholder="例如 2408:4000::/48" />
            </Form.Item>
          );
        }}
      </Form.Item>
      <Form.Item name="gateway_ip" label="网关IP"> <Input placeholder="例如 192.168.1.1" /> </Form.Item>
      <Form.Item name="dhcp_enable" label="DHCP"> <Select allowClear placeholder="启用/关闭" options={[{ label:'启用', value:true }, { label:'关闭', value:false }]} style={{ width: 160 }} /> </Form.Item>
      <Form.Item name="primary_dns" label="主DNS"> <Input placeholder="例如 114.xx.xx.114" /> </Form.Item>
      <Form.Item name="secondary_dns" label="备DNS"> <Input placeholder="例如 114.xx.xx.115" /> </Form.Item>
    </StdFormModal>
  );
};

export default SubnetCreateModal;