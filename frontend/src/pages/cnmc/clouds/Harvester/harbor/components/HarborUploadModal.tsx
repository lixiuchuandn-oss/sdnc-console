/**
 * Harbor 镜像上传弹窗组件
 */
import React, { useState, useEffect } from 'react';
import {
  Modal,
  Table,
  Input,
  AutoComplete,
  Button,
  Upload,
  message,
  Progress,
  Alert,
  Space,
  Tag,
  Form,
} from 'antd';
import {
  InboxOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import {
  uploadImageToHarbor,
  getHarborUploadTask,
  HarborUploadResult,
  HarborUploadTask,
} from '../shared/harborApi';

const { Dragger } = Upload;

interface UploadFile {
  uid: string;
  file: File;
  repoName: string;
  tag: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  taskId?: string;
  error?: string;
}

interface Props {
  visible: boolean;
  harborId: string;
  projectName: string;
  existingRepos: string[];
  onClose: () => void;
  onSuccess: () => void;
}

const HarborUploadModal: React.FC<Props> = ({
  visible,
  harborId,
  projectName,
  existingRepos,
  onClose,
  onSuccess,
}) => {
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!visible) {
      setUploadFiles([]);
      setUploading(false);
    }
  }, [visible]);

  useEffect(() => {
    const uploadingFiles = uploadFiles.filter(
      (f) => f.status === 'uploading' && f.taskId,
    );
    if (uploadingFiles.length === 0) return;

    const pollTasks = async () => {
      for (const file of uploadingFiles) {
        if (!file.taskId) continue;
        try {
          const task = await getHarborUploadTask(harborId, projectName, file.taskId);
          setUploadFiles((prev) =>
            prev.map((f) =>
              f.uid === file.uid
                ? {
                    ...f,
                    status:
                      task.status === 'completed'
                        ? 'completed'
                        : task.status === 'failed'
                          ? 'failed'
                          : 'uploading',
                    progress:
                      task.totalLayers > 0
                        ? Math.round((task.uploadedLayers / task.totalLayers) * 100)
                        : 0,
                    error: task.error,
                  }
                : f,
            ),
          );
        } catch (error) {
          console.error('轮询任务进度失败:', error);
        }
      }
    };

    const timer = setInterval(pollTasks, 2000);
    return () => clearInterval(timer);
  }, [uploadFiles, harborId, projectName]);

  const handleFileChange = (files: File[]) => {
    const newFiles: UploadFile[] = files.map((file) => ({
      uid: `${Date.now()}-${Math.random()}`,
      file,
      repoName: file.name.replace(/\.tar$/i, '').split('-')[0] || 'library',
      tag: 'latest',
      status: 'pending' as const,
      progress: 0,
    }));
    setUploadFiles((prev) => [...prev, ...newFiles]);
  };

  const handleRemoveFile = (uid: string) => {
    setUploadFiles((prev) => prev.filter((f) => f.uid !== uid));
  };

  const handleRepoNameChange = (uid: string, value: string) => {
    setUploadFiles((prev) =>
      prev.map((f) => (f.uid === uid ? { ...f, repoName: value } : f)),
    );
  };

  const handleTagChange = (uid: string, value: string) => {
    setUploadFiles((prev) =>
      prev.map((f) => (f.uid === uid ? { ...f, tag: value } : f)),
    );
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0) {
      message.warning('请选择要上传的文件');
      return;
    }

    const invalidFiles = uploadFiles.filter((f) => !f.repoName || !f.tag);
    if (invalidFiles.length > 0) {
      message.warning('请为所有文件填写仓库名和标签');
      return;
    }

    setUploading(true);
    setUploadFiles((prev) =>
      prev.map((f) => ({ ...f, status: 'uploading' as const, progress: 0 })),
    );

    try {
      const files = uploadFiles.map((f) => ({
        file: f.file,
        repoName: f.repoName,
        tag: f.tag,
      }));

      const result = await uploadImageToHarbor(harborId, projectName, files);

      setUploadFiles((prev) =>
        prev.map((f, index) => ({
          ...f,
          taskId: result.tasks[index]?.taskId,
        })),
      );

      message.success('上传任务已创建，后台正在处理');

      const checkCompletion = setInterval(() => {
        setUploadFiles((prev) => {
          const allDone = prev.every(
            (f) => f.status === 'completed' || f.status === 'failed',
          );
          if (allDone) {
            clearInterval(checkCompletion);
            const hasSuccess = prev.some((f) => f.status === 'completed');
            if (hasSuccess) {
              onSuccess();
            }
          }
          return prev;
        });
      }, 1000);
    } catch (e: any) {
      message.error(e.message || '上传失败');
      setUploadFiles((prev) =>
        prev.map((f) => ({ ...f, status: 'failed' as const, error: e.message })),
      );
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (uploading) {
      Modal.confirm({
        title: '确认关闭',
        content: '有文件正在上传中，关闭将无法查看进度，是否继续？',
        onOk: () => onClose(),
      });
    } else {
      onClose();
    }
  };

  const renderStatus = (record: UploadFile) => {
    switch (record.status) {
      case 'pending':
        return <Tag>待上传</Tag>;
      case 'uploading':
        return (
          <Space>
            <LoadingOutlined spin />
            <Progress
              percent={record.progress}
              size="small"
              style={{ width: 100 }}
            />
          </Space>
        );
      case 'completed':
        return (
          <Tag icon={<CheckCircleOutlined />} color="success">
            已完成
          </Tag>
        );
      case 'failed':
        return (
          <Tag icon={<CloseCircleOutlined />} color="error">
            失败
          </Tag>
        );
    }
  };

  const columns = [
    {
      title: '文件名',
      dataIndex: 'file',
      key: 'file',
      render: (file: File) => file.name,
    },
    {
      title: '仓库名',
      dataIndex: 'repoName',
      key: 'repoName',
      width: 200,
      render: (repoName: string, record: UploadFile) => (
        <AutoComplete
          value={repoName}
          onChange={(value) => handleRepoNameChange(record.uid, value)}
          options={existingRepos.map((r) => ({ value: r }))}
          placeholder="输入或选择"
          disabled={uploading && record.status !== 'pending'}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '标签',
      dataIndex: 'tag',
      key: 'tag',
      width: 150,
      render: (tag: string, record: UploadFile) => (
        <Input
          value={tag}
          onChange={(e) => handleTagChange(record.uid, e.target.value)}
          placeholder="latest"
          disabled={uploading && record.status !== 'pending'}
        />
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 150,
      render: renderStatus,
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: any, record: UploadFile) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleRemoveFile(record.uid)}
          disabled={uploading && record.status === 'uploading'}
        />
      ),
    },
  ];

  const allDone = uploadFiles.every(
    (f) => f.status === 'completed' || f.status === 'failed',
  );
  const hasUploading = uploadFiles.some((f) => f.status === 'uploading');

  return (
    <Modal
      title={`上传镜像到项目 ${projectName}`}
      open={visible}
      onOk={handleUpload}
      onCancel={handleClose}
      okText="开始上传"
      cancelText="关闭"
      okButtonProps={{
        loading: uploading,
        disabled: uploadFiles.length === 0 || hasUploading,
      }}
      width={900}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="镜像将推送到 Harbor 项目，路径格式：{project}/{repo}:{tag}"
      />

      <Form.Item label="选择镜像文件 (.tar)">
        <Dragger
          accept=".tar"
          multiple
          beforeUpload={(file) => {
            handleFileChange([file]);
            return false;
          }}
          showUploadList={false}
          disabled={uploading}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
          <p className="ant-upload-hint">
            支持多选，单个文件最大 2GB，格式为 docker save 导出的 .tar 文件
          </p>
        </Dragger>
      </Form.Item>

      {uploadFiles.length > 0 && (
        <Table
          columns={columns}
          dataSource={uploadFiles}
          rowKey="uid"
          pagination={false}
          size="small"
          style={{ marginBottom: 16 }}
        />
      )}

      {allDone && uploadFiles.length > 0 && (
        <Alert
          type={uploadFiles.every((f) => f.status === 'completed') ? 'success' : 'warning'}
          showIcon
          message="上传完成"
          description={
            <div>
              成功: {uploadFiles.filter((f) => f.status === 'completed').length} 个
              <br />
              失败: {uploadFiles.filter((f) => f.status === 'failed').length} 个
            </div>
          }
        />
      )}
    </Modal>
  );
};

export default HarborUploadModal;
