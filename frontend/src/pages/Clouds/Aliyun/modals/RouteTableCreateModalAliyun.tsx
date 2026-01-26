import React from 'react';
import { App, Form, Input, Select } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { fetchCloudProviderRouteTables, createCloudProviderRouteTable } from '../../../../services/aliyunApi';

type Props = {
  open: boolean;
  cloudId: string;
  vpcs: any[];
  onClose: () => void;
  onSuccess: (routetables: any[]) => void;
};

const RouteTableCreateModalAliyun: React.FC<Props> = ({ open, cloudId, vpcs, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  return (
    <StdFormModal
      open={open}
      title="创建路由表"
      form={form}
      onCancel={onClose}
      onFinish={async (values: any) => {
        try {
          await createCloudProviderRouteTable(cloudId, { vpcId: values.vpcId, name: values.name, description: values.description });
          const json = await fetchCloudProviderRouteTables(cloudId);
          const rtList: any[] = (json?.RouteTables?.RouteTable) || (json?.data?.route_tables) || (json?.route_tables) || [];
          onSuccess(Array.isArray(rtList) ? rtList : []);
          message.success('创建成功');
          onClose();
        } catch (e: any) { message.error(e?.message || '创建失败'); }
      }}
    >
      <Form.Item name="vpcId" label="VPC" rules={[{ required: true }]}>
        <Select
          placeholder="选择VPC"
          options={(vpcs || []).map((v: any) => ({ label: `${v?.VpcName || v?.name || v?.VpcId || v?.id || '-'}`, value: v?.VpcId || v?.id }))}
        />
      </Form.Item>
      <Form.Item name="name" label="名称"> <Input placeholder="请输入名称" /> </Form.Item>
      <Form.Item name="description" label="描述"> <Input placeholder="请输入描述" /> </Form.Item>
    </StdFormModal>
  );
};

export default RouteTableCreateModalAliyun;
