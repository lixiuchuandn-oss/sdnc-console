/**
 * 镜像上传弹窗组件
 */
import React, { useState } from 'react';
import { Modal, Form, Input, Upload, message, Alert } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { uploadImageToRegistry } from '../../../../../../services/localRegistryApi';

const { Dragger } = Upload;

interface Props {
  visible: boolean;
  cloudId: string;
  registryId?: string;
  registryServer: string;
  insecure?: boolean;
  username?: string;
  password?: string;
  onCancel: () => void;
  onSuccess: () => void;
  /** 本地仓库异步任务创建后回调（用于打开任务抽屉） */
  onTaskCreated?: (taskId: string) => void;
}

const ImageUploadModal: React.FC<Props> = ({
  visible,
  cloudId,
  registryId,
  registryServer,
  insecure = true,
  username,
  password,
  onCancel,
  onSuccess,
  onTaskCreated,
}) => {
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleUpload = async () => {
    if (!file) {
      message.warning('请选择镜像文件');
      return;
    }

    const values = await form.validateFields();
    setSubmitting(true);

    try {
      const res: any = await uploadImageToRegistry(
        cloudId,
        registryId,
        file,
        values.targetRepo || 'library',
        values.targetTag || 'latest',
        registryId ? undefined : registryServer,
        registryId ? undefined : insecure,
        registryId ? undefined : username,
        registryId ? undefined : password,
      );

      const createdTaskId = res?.data?.taskId as string | undefined;
      if (registryId) {
        message.success('提交成功，请在「上传任务」中查看进度');
        if (createdTaskId) {
          onTaskCreated?.(createdTaskId);
        }
      } else {
        message.success('提交成功');
      }
      onSuccess();
      handleReset();
    } catch (e: any) {
      message.error(e.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    form.resetFields();
    setFile(null);
  };

  const handleCancel = () => {
    handleReset();
    onCancel();
  };

  return (
    <Modal
      title="上传镜像"
      open={visible}
      onOk={handleUpload}
      onCancel={handleCancel}
      okText="上传"
      cancelText="取消"
      okButtonProps={{ loading: submitting, disabled: !file }}
      width={600}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`目标仓库: ${registryServer}`}
          description={
            registryId
              ? '提交后将在后台推送镜像，进度请在「上传任务」中查看'
              : undefined
          }
        />

        <Form.Item label="镜像文件 (.tar)">
          <Dragger
            accept=".tar"
            beforeUpload={(f) => {
              setFile(f);
              return false;
            }}
            onRemove={() => setFile(null)}
            fileList={file ? [file as any] : []}
            disabled={submitting}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
            <p className="ant-upload-hint">
              支持 docker save 导出的 .tar 文件
            </p>
          </Dragger>
        </Form.Item>

        <Form.Item
          name="targetRepo"
          label="目标仓库"
          extra="如: library、myapp，默认为 library"
        >
          <Input placeholder="library" disabled={submitting} />
        </Form.Item>

        <Form.Item
          name="targetTag"
          label="目标标签"
          extra="如: latest、v1.0.0，默认为 latest"
        >
          <Input placeholder="latest" disabled={submitting} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ImageUploadModal;
