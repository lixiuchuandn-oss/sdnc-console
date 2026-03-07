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
  destroyOnHidden?: boolean;
  forceRender?: boolean;
  initialValues?: any;
  centered?: boolean;
};

const StdFormModal: React.FC<StdFormModalProps> = ({ open, title, okText = '保存', width = 600, confirmLoading, form, onCancel, onFinish, children, destroyOnHidden = true, forceRender, initialValues, centered = true }) => {
  return (
    <Modal
      className="stdform-modal"
      title={typeof title === 'string' ? (<span style={{ fontWeight: 400 }}>{title}</span>) : title}
      open={open}
      centered={centered}
      onCancel={onCancel}
      onOk={() => form?.submit?.()}
      okText={okText}
      confirmLoading={confirmLoading}
      destroyOnHidden={destroyOnHidden}
      forceRender={forceRender}
      width={width}
      styles={{
        header: { marginBottom: 16 },
        body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' }
      }}
    >
      <style>{`.stdform-modal .ant-form-item { margin-bottom: 16px; }`}</style>
      <Form form={form} layout="vertical" onFinish={onFinish} initialValues={initialValues}>
        {React.Children.map(children, (child, index) => {
           if (React.isValidElement(child)) {
             return React.cloneElement(child, { key: child.key || index } as any);
           }
           return child;
        })}
      </Form>
    </Modal>
  );
};

export default StdFormModal;
