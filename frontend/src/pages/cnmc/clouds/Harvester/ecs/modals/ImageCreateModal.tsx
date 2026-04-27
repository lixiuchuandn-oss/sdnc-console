/**
 * 新增虚拟机镜像弹窗（Harvester 集群）
 * frontend/src/pages/cnmc/clouds/Harvester/ecs/modals/ImageCreateModal.tsx
 *
 * === 功能 ===
 * - 浏览器上传：创建 Tower 上传任务并以 raw body POST 至后端代传 Harvester。
 * - URL 导入：调用 createHarvesterImage（集群侧拉取）。
 * - Windows 工具：仅提供 ImageUploader.exe 下载入口。
 *
 * === variant ===
 * - standard：租户等场景，仅展示「浏览器上传」表单。
 * - full：运维场景，Tabs 含浏览器 / URL / 桌面工具。
 *
 * === 浏览器上传字段 ===
 * - 选文件后根据文件名自动填充显示名（去扩展名）与类型（扩展名 → iso | disk，与后端 imageType 一致）。
 */
import React, { useEffect, useState, type MutableRefObject } from 'react';
import { Button, Col, Form, Input, message, Row, Select, Tabs, Typography, Upload } from 'antd';
import { DownloadOutlined, PaperClipOutlined } from '@ant-design/icons';
import StdFormModal from '../../../../../../components/StdFormModal';
import { API_BASE_URL } from '../../../../../../services/api';
import {
  createHarvesterImage,
  createHarvesterImageUploadTask,
  fetchHarvesterImageUploadTask,
  type HarvesterImageUploadTask,
} from '../../../../../../services/harvesterApi';
import { getToken } from '../../../../../../utils/tokenStorage';

// ---------------------------------------------------------------------------
// 类型与纯函数（无 React 依赖，便于单测或复用）
// ---------------------------------------------------------------------------

export type ImageCreateModalProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  /** standard：仅浏览器上传；full：浏览器 + URL + 桌面工具 */
  variant: 'standard' | 'full';
  /** 与列表页权限校验一致，无写权限时直接 return */
  ensureWrite: () => boolean;
  onUrlImportSuccess?: () => void;
  /** 合并/更新侧边栏「上传任务」列表中的单条记录 */
  onUploadTaskUpsert: (task: HarvesterImageUploadTask) => void;
  /** 与 ImagesSection 共用，取消任务时可 abort 浏览器直传 fetch */
  uploadControllersRef: MutableRefObject<Map<string, AbortController>>;
};

/** 与 handleStartTaskUpload 中 disk 类型映射一致（后端 disk → qcow2） */
const BROWSER_UPLOAD_DISK_EXTENSIONS = new Set([
  'qcow2',
  'raw',
  'img',
  'vmdk',
  'vdi',
  'vhd',
  'vhdx',
  'qed',
]);

type BrowserUploadInference = {
  displayName: string;
  imageType: 'iso' | 'disk' | undefined;
};

/**
 * 从本地文件名推导展示用显示名与 Harvester 上传任务 imageType。
 * 无法识别扩展名时 imageType 为 undefined（由用户下拉补充或走后端默认）。
 */
function inferBrowserUploadFromFilename(filename: string): BrowserUploadInference {
  const base = filename.replace(/^[\\/]+/g, '').split(/[/\\]/).pop() || filename;
  const lower = base.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';
  const displayName = (base.replace(/\.[^.\\/]+$/, '') || base).trim() || base;
  let imageType: 'iso' | 'disk' | undefined;
  if (ext === 'iso') imageType = 'iso';
  else if (BROWSER_UPLOAD_DISK_EXTENSIONS.has(ext)) imageType = 'disk';
  return { displayName, imageType };
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

const ImageCreateModal: React.FC<ImageCreateModalProps> = ({
  open,
  onClose,
  cloudId,
  variant,
  ensureWrite,
  onUrlImportSuccess,
  onUploadTaskUpsert,
  uploadControllersRef,
}) => {
  const [form] = Form.useForm();
  const [createTab, setCreateTab] = useState<'browser' | 'desktop' | 'url'>('browser');
  const [uploadingTask, setUploadingTask] = useState(false);
  const [toolFile, setToolFile] = useState<File | null>(null);

  // 每次打开弹窗：清空表单与本地文件，避免上次选择的文件残留
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ toolNamespace: 'default', namespace: 'default' });
    setCreateTab('browser');
    setToolFile(null);
  }, [open, form]);

  /** URL 导入 Tab：校验 namespace / displayName / url 后创建集群拉取镜像 */
  const handleCreate = async () => {
    if (!ensureWrite()) return;
    try {
      const v = await form.validateFields();
      let diskFormat: string | undefined;
      if (v.imageType === 'iso') diskFormat = 'iso';
      else if (v.imageType === 'disk') diskFormat = 'qcow2';
      await createHarvesterImage(cloudId, {
        namespace: v.namespace || 'default',
        displayName: v.displayName || undefined,
        sourceType: 'download',
        url: v.url || undefined,
        diskFormat,
      });
      message.success('创建成功');
      onClose();
      onUrlImportSuccess?.();
    } catch (e: any) {
      // Ant Design 表单校验失败会带 errorFields，不弹通用错误
      if (e?.errorFields) return;
      message.error(e?.message || '创建失败');
    }
  };

  /**
   * 浏览器上传 Tab：StdFormModal 触发 form.submit → 本函数。
   * 镜像显示名为可选；最终以表单值为准，空则再次用 inferBrowserUploadFromFilename(file.name)。
   */
  const handleStartTaskUpload = async () => {
    if (!ensureWrite()) return;
    if (!toolFile) {
      message.warning('请先选择镜像文件');
      return;
    }

    const namespace = String(form.getFieldValue('toolNamespace') || 'default');
    const inferred = inferBrowserUploadFromFilename(toolFile.name);
    const displayName =
      String(form.getFieldValue('toolDisplayName') || '').trim() || inferred.displayName;
    const imageType =
      String(form.getFieldValue('toolImageType') || '').trim() || inferred.imageType || undefined;
    const file = toolFile;

    setUploadingTask(true);
    try {
      const created: any = await createHarvesterImageUploadTask(cloudId, {
        namespace,
        displayName,
        imageType,
      });
      const task = (created?.data || created) as HarvesterImageUploadTask;
      if (!task?.id) throw new Error('创建任务失败：未返回 taskId');

      onUploadTaskUpsert(task);
      onClose();
      setToolFile(null);
      form.setFieldsValue({ toolDisplayName: '', toolImageType: undefined });
      message.success('任务已创建，开始上传，可在「上传任务」查看/取消');

      const controller = new AbortController();
      uploadControllersRef.current.set(task.id, controller);

      const taskFileUrl = `${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images/upload-tasks/${encodeURIComponent(task.id)}/file`;

      // 弹窗已关，上传在后台继续；失败仅 message，不阻塞 UI
      void (async () => {
        try {
          const token = getToken();
          const headers: Record<string, string> = {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
            'X-File-Size': String(file.size),
          };
          if (token) headers.Authorization = `Bearer ${token}`;

          const uploadResp = await fetch(taskFileUrl, {
            method: 'POST',
            headers,
            body: file,
            signal: controller.signal,
          });
          if (!uploadResp.ok) {
            const text = await uploadResp.text();
            throw new Error(text || `文件上传失败（HTTP ${uploadResp.status}）`);
          }
          const latest: any = await fetchHarvesterImageUploadTask(cloudId, task.id);
          onUploadTaskUpsert((latest?.data || latest) as HarvesterImageUploadTask);
        } catch (e: any) {
          if (controller.signal.aborted) return;
          message.error(e?.message || '文件上传失败');
        } finally {
          uploadControllersRef.current.delete(task.id);
        }
      })();
    } catch (e: any) {
      message.error(e?.message || '提交上传任务失败');
    } finally {
      setUploadingTask(false);
    }
  };

  const openImageUploaderDownload = () => {
    window.open(`${API_BASE_URL}/api/tools/imageuploader.exe`, '_blank', 'noopener,noreferrer');
  };

  /** URL 导入表单（仅 full variant 的 Tab 使用） */
  const renderUrlImportPanel = () => (
    <>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="镜像仓" name="namespace" initialValue="default" rules={[{ required: true }]}>
            <Select options={[{ label: '公共镜像仓（默认）', value: 'default' }]} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="镜像类型" name="imageType" tooltip="可选，不选择时后端会自动推断">
            <Select
              placeholder="选择镜像类型（可选）"
              allowClear
              options={[
                { value: 'disk', label: 'Qcow2（磁盘镜像）' },
                { value: 'iso', label: 'ISO（光盘镜像）' },
              ]}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item label="镜像显示名" name="displayName" rules={[{ required: true }]}>
        <Input placeholder="如：ubuntu_20.04_200G.qcow2" />
      </Form.Item>
      <Form.Item
        label="下载地址"
        name="url"
        rules={[
          {
            validator: async (_, v) => {
              if (!v || !/^https?:\/\//i.test(String(v))) return Promise.reject('请输入合法的 http(s) 链接');
              return Promise.resolve();
            },
          },
        ]}
      >
        <Input placeholder="http(s)://..." />
      </Form.Item>
    </>
  );

  /** 浏览器直传表单（standard 与 full 的「浏览器上传」Tab 共用） */
  const renderBrowserUploadPanel = () => (
    <div>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="镜像仓" name="toolNamespace" initialValue="default">
            <Select options={[{ label: '公共镜像仓（默认）', value: 'default' }]} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            label="镜像类型"
            name="toolImageType"
            tooltip="选择文件后将按扩展名预选（如 .iso / .qcow2），可修改"
          >
            <Select
              allowClear
              options={[
                { value: 'disk', label: 'Qcow2（磁盘镜像）' },
                { value: 'iso', label: 'ISO（光盘镜像）' },
              ]}
              placeholder="按需选择"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item
        label="镜像显示名"
        name="toolDisplayName"
        tooltip="选择文件后将用文件名（去掉扩展名）自动填充，可修改"
      >
        <Input placeholder="选择文件后自动填充" />
      </Form.Item>
      <Form.Item label="本地文件" required>
        <div
          style={{
            border: '1px dashed #d9d9d9',
            borderRadius: 6,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <Upload
            beforeUpload={(file) => {
              const f = file as File;
              setToolFile(f);
              const inferred = inferBrowserUploadFromFilename(f.name);
              form.setFieldsValue({
                toolDisplayName: inferred.displayName,
                toolImageType: inferred.imageType,
              });
              return false;
            }}
            maxCount={1}
            onRemove={() => {
              setToolFile(null);
              form.setFieldsValue({ toolDisplayName: '', toolImageType: undefined });
            }}
            showUploadList={false}
          >
            <Button>选择镜像文件</Button>
          </Upload>
          <Typography.Text style={{ flex: 1, textAlign: 'left' }} ellipsis>
            <PaperClipOutlined style={{ marginRight: 6, color: '#1677ff' }} />
            {toolFile?.name || '-'}
          </Typography.Text>
        </div>
      </Form.Item>
    </div>
  );

  /** 仅文案 + 下载按钮，无表单提交 */
  const renderDesktopToolPanel = () => (
    <div style={{ padding: '0 8px' }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        适用于大文件或浏览器上传不稳定的环境。下载 Windows 桌面工具后本地运行，按向导登录 Tower、选择 Cloudmap 资源池与命名空间，将镜像直传至集群。
      </Typography.Paragraph>
      <Button type="primary" icon={<DownloadOutlined />} onClick={openImageUploaderDownload}>
        下载 ImageUploader.exe
      </Button>
    </div>
  );

  /** full 模式下根据当前 Tab 切换「创建」与「提交任务」两套 onFinish */
  const isUrlCreateTab = createTab === 'url';

  return (
    <StdFormModal
      open={open}
      title="新增镜像"
      onCancel={onClose}
      onFinish={isUrlCreateTab ? handleCreate : handleStartTaskUpload}
      form={form}
      okText={isUrlCreateTab ? '创建' : '提交任务'}
      confirmLoading={uploadingTask}
      okButtonProps={createTab === 'desktop' ? { style: { display: 'none' } } : undefined}
      width={600}
    >
      {variant === 'standard' ? (
        renderBrowserUploadPanel()
      ) : (
        <Tabs
          activeKey={createTab}
          destroyInactiveTabPane
          onChange={(k) => {
            setCreateTab(k as 'browser' | 'desktop' | 'url');
          }}
          items={[
            {
              key: 'browser',
              label: '浏览器上传',
              children: renderBrowserUploadPanel(),
            },
            {
              key: 'url',
              label: 'URL 导入',
              children: renderUrlImportPanel(),
            },
            {
              key: 'desktop',
              label: 'Windows 桌面工具',
              children: renderDesktopToolPanel(),
            },
          ]}
        />
      )}
    </StdFormModal>
  );
};

export default ImageCreateModal;
