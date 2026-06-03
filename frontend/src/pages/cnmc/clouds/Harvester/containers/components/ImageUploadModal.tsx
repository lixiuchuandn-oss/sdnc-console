/**
 * 镜像上传弹窗组件
 */
import React, { useState } from 'react';
import { Modal, Form, Input, Upload, message, Progress, Alert, Space, Typography } from 'antd';
import { InboxOutlined, CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { uploadImageToRegistry } from '../../../../../../services/localRegistryApi';

const { Dragger } = Upload;
const { Text } = Typography;

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
}) => {
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!file) {
      message.warning('请选择镜像文件');
      return;
    }

    const values = await form.validateFields();
    setUploading(true);
    setUploadProgress(0);

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
      
      setTaskId(res?.data?.taskId);
      message.success('上传任务已创建，后台正在处理');
      onSuccess();
      handleReset();
    } catch (e: any) {
      message.error(e.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    form.resetFields();
    setFile(null);
    setUploadProgress(0);
    setTaskId(null);
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
      okButtonProps={{ loading: uploading, disabled: !file }}
      width={600}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`目标仓库: ${registryServer}`}
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
            disabled={uploading}
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
          <Input placeholder="library" disabled={uploading} />
        </Form.Item>

        <Form.Item
          name="targetTag"
          label="目标标签"
          extra="如: latest、v1.0.0，默认为 latest"
        >
          <Input placeholder="latest" disabled={uploading} />
        </Form.Item>

        {uploading && (
          <Form.Item label="上传进度">
            <Progress percent={uploadProgress} status="active" />
          </Form.Item>
        )}

        {taskId && (
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message="上传任务已创建"
            description="镜像正在后台处理中，请稍后刷新查看结果"
          />
        )}
      </Form>
    </Modal>
  );
};

export default ImageUploadModal;
