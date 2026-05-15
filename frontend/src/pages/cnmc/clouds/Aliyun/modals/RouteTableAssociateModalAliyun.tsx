import React from 'react';
import { App, Form, Modal, Select } from 'antd';
import { fetchCloudProviderRouteTables, associateCloudProviderRouteTable } from '../../../../../services/aliyunApi';

type Props = {
  open: boolean;
  cloudId: string;
  target: any | null;
  subnets: any[];
  onClose: () => void;
  onSuccess: (routetables: any[]) => void;
};

const RouteTableAssociateModalAliyun: React.FC<Props> = ({ open, cloudId, target, subnets, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  return (
    <Modal
      open={open}
      title="挂载子网"
      centered
      destroyOnHidden
      width={600}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="保存"
      styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values: any) => {
          try {
            const id0 = target?.RouteTableId || target?.id;
            if (!id0) return;
            await associateCloudProviderRouteTable(cloudId, id0, values.subnetIds || []);
            const json = await fetchCloudProviderRouteTables(cloudId);
            const rtList: any[] = (json?.RouteTables?.RouteTable) || (json?.data?.route_tables) || (json?.route_tables) || [];
            onSuccess(Array.isArray(rtList) ? rtList : []);
            message.success('挂载成功');
            onClose();
          } catch (e: any) {
            message.error(e?.message || '挂载失败');
          }
        }}
      >
      <Form.Item name="subnetIds" label="子网" rules={[{ required: true }]}>
        <Select
          mode="multiple"
          placeholder="选择子网"
          options={(subnets || []).filter((s: any) => {
            const vpcId = target?.VpcId || target?.vpc_id;
            return vpcId ? (String(s?.VpcId || s?.vpc_id || '') === String(vpcId)) : true;
          }).map((s: any) => ({ label: `${s?.VSwitchName || s?.name || s?.VSwitchId || s?.id || '-'}`, value: s?.VSwitchId || s?.id }))}
        />
      </Form.Item>
      </Form>
    </Modal>
  );
};

export default RouteTableAssociateModalAliyun;
