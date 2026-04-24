import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tabs,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import yaml from 'js-yaml';
import {
  createRancherClusterWorkload,
  fetchRancherClusterNamespaces,
  type RancherWorkloadKind,
} from '../../../../../../../services/rancherClusterApi';
import {
  RANCHER_CLUSTER_WORKLOADS_SUB_LABEL,
  type RancherClusterWorkloadsSubKey,
} from '../../../../../../../layouts/admin/rancher/rancherClusterSidebar';
import { buildManifestFromForm, defaultFormValues, type WorkloadFormValues } from './buildWorkloadManifest';
import { getDefaultWorkloadYaml } from './workloadCreateTemplates';

const K8S_NAME = {
  pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
  message: '须为小写字母、数字或连字符，符合 DNS 子域规则',
};

const EXPECTED_KIND: Record<RancherWorkloadKind, string> = {
  deployment: 'Deployment',
  statefulset: 'StatefulSet',
  daemonset: 'DaemonSet',
  cronjob: 'CronJob',
  job: 'Job',
  pod: 'Pod',
};

type Props = {
  open: boolean;
  onClose: () => void;
  poolId: string;
  clusterId: string;
  kind: RancherClusterWorkloadsSubKey;
  onSuccess: () => void;
};

const RancherWorkloadCreateModal: React.FC<Props> = ({
  open,
  onClose,
  poolId,
  clusterId,
  kind,
  onSuccess,
}) => {
  const wk = kind as RancherWorkloadKind;
  const [form] = Form.useForm<WorkloadFormValues>();
  const [activeTab, setActiveTab] = useState<string>('form');
  const [yamlText, setYamlText] = useState(() => getDefaultWorkloadYaml(kind));
  const [nsOptions, setNsOptions] = useState<{ value: string; label: string }[]>([]);
  const [nsLoading, setNsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !poolId || !clusterId) return;
    setErr(null);
    setActiveTab('form');
    setYamlText(getDefaultWorkloadYaml(kind));
    (async () => {
      setNsLoading(true);
      let first = 'default';
      try {
        const list = await fetchRancherClusterNamespaces(poolId, clusterId);
        setNsOptions(list.map((n) => ({ value: n.name, label: n.name })));
        first = list[0]?.name || 'default';
      } catch {
        setNsOptions([{ value: 'default', label: 'default' }]);
      } finally {
        setNsLoading(false);
      }
      form.setFieldsValue({
        ...defaultFormValues(wk, first),
        namespace: first,
      } as WorkloadFormValues);
    })();
  }, [open, kind, wk, poolId, clusterId, form]);

  const submitForm = async (values: WorkloadFormValues) => {
    if (!poolId || !clusterId) return;
    setErr(null);
    setSubmitting(true);
    try {
      const manifest = buildManifestFromForm(wk, values);
      await createRancherClusterWorkload(poolId, clusterId, wk, manifest);
      onSuccess();
      onClose();
    } catch (e: any) {
      setErr(e?.message || (typeof e === 'string' ? e : '创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitYaml = async () => {
    if (!poolId || !clusterId) return;
    setErr(null);
    let obj: unknown;
    try {
      obj = yaml.load(yamlText) as unknown;
    } catch (e: any) {
      setErr(e?.message || 'YAML 解析失败');
      return;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      setErr('请提供单个 Kubernetes 对象');
      return;
    }
    const o = obj as Record<string, unknown>;
    const md = (o.metadata as Record<string, unknown> | undefined) || {};
    if (!String(md.namespace || '').trim() || !String(md.name || '').trim()) {
      setErr('metadata 需包含非空的 name 与 namespace');
      return;
    }
    if (String(o.kind || '').trim() !== EXPECTED_KIND[wk]) {
      setErr(`资源 kind 须为 ${EXPECTED_KIND[wk]}`);
      return;
    }
    setSubmitting(true);
    try {
      await createRancherClusterWorkload(poolId, clusterId, wk, o);
      onSuccess();
      onClose();
    } catch (e: any) {
      setErr(e?.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const renderFormFields = () => {
    const common = (
      <>
        <Form.Item
          name="namespace"
          label="命名空间"
          rules={[{ required: true, message: '请选择命名空间' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            loading={nsLoading}
            options={nsOptions}
          />
        </Form.Item>
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '请输入工作负载名称' }, K8S_NAME]}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="containerName"
          label="容器名称"
          rules={[{ required: true, message: '请输入容器名' }, K8S_NAME]}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item name="image" label="容器镜像" rules={[{ required: true, message: '请输入镜像' }]}>
          <Input autoComplete="off" />
        </Form.Item>
      </>
    );

    const optionalPort = (
      <Form.Item name="port" label="容器端口">
        <InputNumber min={1} max={65535} style={{ width: '100%' }} />
      </Form.Item>
    );

    const optionalCommand = (
      <Form.Item name="command" label="启动命令">
        <Input.TextArea rows={2} autoComplete="off" />
      </Form.Item>
    );

    switch (kind) {
      case 'deployment':
        return (
          <>
            {common}
            <Form.Item
              name="replicas"
              label="副本数"
              rules={[{ required: true, message: '请填写副本数' }]}
            >
              <InputNumber min={1} max={10000} style={{ width: '100%' }} />
            </Form.Item>
            {optionalPort}
            {optionalCommand}
          </>
        );
      case 'statefulset':
        return (
          <>
            {common}
            <Form.Item
              name="serviceName"
              label="服务名（Service）"
              rules={[
                {
                  pattern: /^(|([a-z0-9]([-a-z0-9]*[a-z0-9])?))$/,
                  message: '留空或符合 DNS 子域',
                },
              ]}
            >
              <Input allowClear autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="replicas"
              label="副本数"
              rules={[{ required: true, message: '请填写副本数' }]}
            >
              <InputNumber min={1} max={10000} style={{ width: '100%' }} />
            </Form.Item>
            {optionalPort}
            {optionalCommand}
          </>
        );
      case 'daemonset':
        return (
          <>
            {common}
            {optionalPort}
            {optionalCommand}
          </>
        );
      case 'job':
        return (
          <>
            {common}
            {optionalCommand}
          </>
        );
      case 'cronjob':
        return (
          <>
            {common}
            <Form.Item
              name="schedule"
              label="Cron 调度"
              rules={[{ required: true, message: '请填写调度表达式' }]}
            >
              <Input autoComplete="off" />
            </Form.Item>
            {optionalCommand}
            {optionalPort}
          </>
        );
      case 'pod':
        return (
          <>
            {common}
            {optionalPort}
            {optionalCommand}
          </>
        );
      default:
        return common;
    }
  };

  return (
    <Modal
      title={
        <Space>
          <PlusOutlined />
          <span>创建 {RANCHER_CLUSTER_WORKLOADS_SUB_LABEL[kind]}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={640}
      destroyOnClose
      footer={null}
    >
      {err && (
        <Alert
          type="error"
          showIcon
          message={err}
          style={{ marginBottom: 12 }}
          closable
          onClose={() => setErr(null)}
        />
      )}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'form',
            label: '表单',
            children: (
              <Form<WorkloadFormValues>
                form={form}
                layout="vertical"
                onFinish={(v) => void submitForm(v)}
                requiredMark="optional"
              >
                {renderFormFields()}
                <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                  <Space>
                    <Button
                      onClick={() => {
                        const ns = (form.getFieldValue('namespace') as string) || 'default';
                        form.setFieldsValue(defaultFormValues(wk, ns) as WorkloadFormValues);
                        setErr(null);
                      }}
                    >
                      重置
                    </Button>
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" htmlType="submit" loading={submitting}>
                      创建
                    </Button>
                  </Space>
                </Form.Item>
              </Form>
            ),
          },
          {
            key: 'yaml',
            label: 'YAML',
            children: (
              <>
                <Input.TextArea
                  value={yamlText}
                  onChange={(e) => setYamlText(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                  rows={16}
                  spellCheck={false}
                />
                <div style={{ marginTop: 12, textAlign: 'right' }}>
                  <Space>
                    <Button
                      onClick={() => {
                        setYamlText(getDefaultWorkloadYaml(kind));
                        setErr(null);
                      }}
                    >
                      重置为模板
                    </Button>
                    <Button
                      type="primary"
                      loading={submitting}
                      onClick={() => void submitYaml()}
                    >
                      创建
                    </Button>
                  </Space>
                </div>
              </>
            ),
          },
        ]}
      />
    </Modal>
  );
};

export default RancherWorkloadCreateModal;
