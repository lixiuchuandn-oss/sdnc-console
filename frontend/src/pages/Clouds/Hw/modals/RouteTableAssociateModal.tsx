import React from 'react';
import { App, Form, Select } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { fetchCloudProviderRouteTables, associateCloudProviderRouteTable } from '../../../../services/api';
import { normalizeErr } from '../utils/net';

type Props = {
  open: boolean;
  cloudId: string;
  target: any | null;
  subnets: any[];
  onClose: () => void;
  onSuccess: (routetables: any[]) => void;
};

const RouteTableAssociateModal: React.FC<Props> = ({ open, cloudId, target, subnets, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  return (
    <StdFormModal
      open={open}
      title="挂载子网"
      form={form}
      onCancel={onClose}
      onFinish={async (values: any) => {
        try {
          const id0 = target?.id || target?.RouteTableId; if (!id0) return;
          await associateCloudProviderRouteTable(cloudId, id0, values.subnetIds || []);
          const json = await fetchCloudProviderRouteTables(cloudId);
          const rtList: any[] = (json?.data?.route_tables) || (json?.route_tables) || [];
          onSuccess(Array.isArray(rtList) ? rtList : []);
          message.success('挂载成功');
          onClose();
        } catch (e:any) { message.error(normalizeErr(e, '挂载失败')); }
      }}
    >
      <Form.Item name="subnetIds" label="子网" rules={[{ required: true }]}> 
        <Select mode="multiple" placeholder="选择子网" options={(subnets||[]).filter((s:any)=>{
          const vpcId = target?.vpc_id || target?.VpcId;
          return vpcId ? (String(s?.vpc_id||'') === String(vpcId)) : true;
        }).map((s:any)=> ({ label: `${s?.name || s?.id || '-'}`, value: s?.id }))} />
      </Form.Item>
    </StdFormModal>
  );
};

export default RouteTableAssociateModal;