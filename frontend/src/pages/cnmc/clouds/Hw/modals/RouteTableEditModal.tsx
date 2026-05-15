import React, { useEffect } from 'react';
import { App, Form, Input, Modal } from 'antd';
import { fetchCloudProviderRouteTables, updateCloudProviderRouteTable } from '../../../../../services/api';
import { normalizeErr } from '../utils/net';

type Props = {
  open: boolean;
  cloudId: string;
  target: any | null;
  onClose: () => void;
  onSuccess: (routetables: any[]) => void;
};

const RouteTableEditModal: React.FC<Props> = ({ open, cloudId, target, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  useEffect(() => {
    const prefill = () => {
      if (!open || !target) return;
      const name0 = target?.name;
      const desc0 = target?.description;
      setTimeout(() => { form.setFieldsValue({ name: name0, description: desc0 }); }, 0);
    };
    prefill();
  }, [open, target, form]);

  return (
    <Modal
      open={open}
      title="编辑路由表"
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
            const id0 = target?.id || target?.RouteTableId;
            if (!id0) return;
            await updateCloudProviderRouteTable(cloudId, id0, { name: values.name, description: values.description });
            const json = await fetchCloudProviderRouteTables(cloudId);
            const rtList: any[] = (json?.data?.route_tables) || (json?.route_tables) || [];
            onSuccess(Array.isArray(rtList) ? rtList : []);
            message.success('更新成功');
            onClose();
          } catch (e: any) {
            message.error(normalizeErr(e, '更新失败'));
          }
        }}
      >
      <Form.Item name="name" label="名称"> <Input placeholder="请输入名称" /> </Form.Item>
      <Form.Item name="description" label="描述"> <Input placeholder="请输入描述" /> </Form.Item>
      </Form>
    </Modal>
  );
};

export default RouteTableEditModal;