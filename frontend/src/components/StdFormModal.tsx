import React from 'react';
import { Modal, Form } from 'antd';

type StdFormModalProps = {
  open: boolean;
  title: React.ReactNode;
  okText?: string;
  width?: number;
  confirmLoading?: boolean;
  form?: any;
  onCancel?: () => void;
  onFinish?: (values: any) => void;
  children?: React.ReactNode;
  destroyOnClose?: boolean;
  destroyOnHidden?: boolean;
  forceRender?: boolean;
  initialValues?: any;
};

const StdFormModal: React.FC<StdFormModalProps> = ({ open, title, okText = '保存', width = 600, confirmLoading, form, onCancel, onFinish, children, destroyOnClose = true, destroyOnHidden, forceRender, initialValues }) => {
  const shouldDestroyOnHidden = typeof destroyOnHidden !== 'undefined' ? destroyOnHidden : destroyOnClose;
  return (
    <Modal
      className="stdform-modal"
      title={typeof title === 'string' ? (<span style={{ fontWeight: 400 }}>{title}</span>) : title}
      open={open}
      onCancel={onCancel}
      onOk={() => form?.submit?.()}
      okText={okText}
      confirmLoading={confirmLoading}
      destroyOnHidden={shouldDestroyOnHidden}
      forceRender={forceRender}
      width={width}
      styles={{
        header: { marginBottom: 16 },
        body: { maxHeight: '80vh', overflowY: 'auto' }
      }}
    >
      <style>{`.stdform-modal .ant-form-item { margin-bottom: 16px; }`}</style>
      <Form form={form} layout="vertical" onFinish={onFinish} initialValues={initialValues}>
        {children}
      </Form>
    </Modal>
  );
};

export default StdFormModal;
