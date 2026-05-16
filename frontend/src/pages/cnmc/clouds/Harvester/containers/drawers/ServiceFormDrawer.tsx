/**
 * 容器业务域 · Kubernetes Service 创建/编辑：表单与抽屉同文件。
 *
 * 落位：`Harvester/containers/drawers/ServiceFormDrawer.tsx`
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ImportOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { CardProps } from 'antd';
import type { FormInstance } from 'antd/es/form';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Typography,
} from 'antd';
import { createHarvesterService, updateHarvesterService, fetchHarvesterPodsBySelector } from '../../../../../../services/harvesterApi';
import WorkloadImportDrawer, { type WorkloadInfo } from './WorkloadImportDrawer';
import { generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName, isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { getHarvesterDrawerSectionCardProps } from '../../shared/drawerSectionCard';

const { Text } = Typography;

const DEFAULT_SECTION_CARD_SHELL: Pick<CardProps, 'bordered' | 'style'> = {};
const DRAWER_SECTION_CARD_PROPS = getHarvesterDrawerSectionCardProps();

// ============================================================
// 类型（供 barrel 与其它模块引用）
// ============================================================

export interface ServiceFormValues {
  name: string;
  namespace: string;
  labels: Array<{ key: string; value: string }>;
  /** 编辑模式下可选：metadata.annotations（不含 tower.io/alias，别名仍用 name 字段） */
  metadataAnnotations?: Array<{ key: string; value: string }>;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
  selector: Array<{ key: string; value: string }>;
  ports: Array<{
    name: string;
    protocol: 'TCP' | 'UDP' | 'SCTP';
    port: number;
    targetPort: string | number;
    nodePort?: number;
  }>;
  externalName?: string;
  clusterIP?: string;
}

export interface ServiceFormProps {
  cloudId: string;
  namespacesOptions: string[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  /** 编辑模式 */
  editMode?: boolean;
  /** 编辑模式下的初始数据（原始 Service 对象） */
  initialData?: any;
  /** 编辑模式下展示「注解」键值编辑（metadata.annotations，不含 tower.io/alias） */
  showAnnotationsEditor?: boolean;
  /** 由外层（如 Drawer）传入同一 Form 实例，以便 footer 调用 submit */
  form?: FormInstance<ServiceFormValues>;
  /** 为 true 时不渲染底部取消/提交（由外层 Drawer footer 承担） */
  hideFooterActions?: boolean;
  /** 提交请求进行中，供外层 footer 同步 loading */
  onSubmittingChange?: (submitting: boolean) => void;
  /** 分区 Card 外壳（由 Drawer 注入） */
  sectionCardProps?: Pick<CardProps, 'bordered' | 'style'>;
}

export interface ServiceFormDrawerProps {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  namespacesOptions: string[];
  /** 创建 | 编辑 */
  mode: 'create' | 'edit';
  /** 创建时默认命名空间 */
  defaultNamespace?: string;
  /** 编辑必填：须含 raw（K8s Service 对象） */
  record?: { raw?: any; namespace?: string; name?: string } | null;
  onCommitted?: () => void;
}

// ============================================================
// 常量
// ============================================================

const SERVICE_TYPE_OPTIONS = [
  { value: 'ClusterIP', label: 'ClusterIP (集群内部访问)' },
  { value: 'NodePort', label: 'NodePort (节点端口暴露)' },
  { value: 'LoadBalancer', label: 'LoadBalancer (负载均衡器)' },
  { value: 'ExternalName', label: 'ExternalName (外部名称映射)' },
];

const PROTOCOL_OPTIONS = [
  { value: 'TCP', label: 'TCP' },
  { value: 'UDP', label: 'UDP' },
  { value: 'SCTP', label: 'SCTP' },
];

function extractServiceFormValues(data: unknown): Partial<ServiceFormValues> {
  if (!data || typeof data !== 'object') return {};

  const d = data as { metadata?: Record<string, unknown>; spec?: Record<string, unknown> };
  const metadata = (d.metadata || {}) as Record<string, unknown>;
  const spec = (d.spec || {}) as Record<string, unknown>;

  const labels = Object.entries((metadata.labels as Record<string, string>) || {}).map(([key, value]) => ({
    key,
    value: String(value),
  }));

  const metadataAnnotations = Object.entries((metadata.annotations as Record<string, unknown>) || {})
    .filter(([k]) => k !== 'tower.io/alias')
    .map(([key, value]) => ({ key, value: String(value ?? '') }));

  const selector = Object.entries((spec.selector as Record<string, string>) || {}).map(([key, value]) => ({
    key,
    value: String(value),
  }));

  const ports = ((spec.ports as unknown[]) || []).map((p: any) => ({
    name: p.name || '',
    protocol: p.protocol || 'TCP',
    port: p.port,
    targetPort: p.targetPort,
    nodePort: p.nodePort,
  }));

  const ann = metadata.annotations as Record<string, unknown> | undefined;
  const metaName = metadata.name as string | undefined;

  return {
    name: (ann?.['tower.io/alias'] as string | undefined) || metaName || '',
    namespace: String(metadata.namespace ?? ''),
    labels,
    metadataAnnotations,
    selector,
    ports,
    type: (spec.type as ServiceFormValues['type']) || 'ClusterIP',
    externalName: spec.externalName as string | undefined,
    clusterIP: spec.clusterIP as string | undefined,
  };
}

function buildServiceSubmitData(
  values: ServiceFormValues,
  isEdit: boolean,
  options: { showAnnotationsEditor: boolean; initialData?: any },
): any {
  const { showAnnotationsEditor, initialData } = options;
  const annotationsTowerAlias = values.name;

  let mergedAnnotations: Record<string, string>;
  if (isEdit && showAnnotationsEditor && initialData?.metadata?.annotations) {
    mergedAnnotations = { ...initialData.metadata.annotations };
    for (const k of Object.keys(initialData.metadata.annotations)) {
      if (k !== 'tower.io/alias') {
        delete mergedAnnotations[k];
      }
    }
    (values.metadataAnnotations || []).forEach(({ key, value }) => {
      if (key) mergedAnnotations[key] = String(value ?? '');
    });
    mergedAnnotations['tower.io/alias'] = annotationsTowerAlias;
  } else {
    mergedAnnotations = {
      ...(isEdit ? initialData?.metadata?.annotations : {}),
      'tower.io/alias': annotationsTowerAlias,
    };
  }

  const baseResource = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: isEdit ? initialData?.metadata?.name : generateHarvesterCrMetadataName('service'),
      namespace: values.namespace,
      labels: values.labels?.reduce(
        (acc, { key, value }) => {
          if (key && value) acc[key] = value;
          return acc;
        },
        {} as Record<string, string>,
      ),
      annotations: mergedAnnotations,
    },
  };

  const selector = values.selector?.reduce(
    (acc, { key, value }) => {
      if (key && value) acc[key] = value;
      return acc;
    },
    {} as Record<string, string>,
  );

  if (values.type === 'ExternalName') {
    return {
      ...baseResource,
      spec: {
        type: 'ExternalName',
        externalName: values.externalName,
      },
    };
  }

  const ports = values.ports?.map((p, index) => {
    const portSpec: any = {
      name: p.name || `port-${index}`,
      protocol: p.protocol || 'TCP',
      port: p.port,
      targetPort: typeof p.targetPort === 'number' ? p.targetPort : parseInt(String(p.targetPort), 10) || p.targetPort,
    };
    if (values.type === 'NodePort' && p.nodePort) {
      portSpec.nodePort = p.nodePort;
    }
    return portSpec;
  });

  const spec: any = {
    type: values.type,
    selector,
    ports,
  };

  if (values.clusterIP) {
    spec.clusterIP = values.clusterIP;
  }

  return {
    ...baseResource,
    spec,
  };
}

// ============================================================
// 子组件: 标签/选择器编辑器
// ============================================================

const KeyValueEditor: React.FC<{
  name: string;
  label?: string;
  addButtonText?: string;
}> = ({ name, label, addButtonText = '添加' }) => (
  <Form.List name={name}>
    {(fields, { add, remove }) => (
      <Flex vertical gap="small" style={{ width: '100%' }}>
        {label ? (
          <Text strong style={{ display: 'block' }}>
            {label}
          </Text>
        ) : null}
        {fields.map(({ key, name: index, ...restField }) => (
          <Row key={key} gutter={[12, 8]} align="middle" wrap={false}>
            <Col flex="1 1 0">
              <Form.Item
                {...restField}
                name={[index, 'key']}
                rules={[{ required: true, message: '请输入键' }]}
                style={{ marginBottom: 0 }}
              >
                <Input placeholder="键 (如: app)" />
              </Form.Item>
            </Col>
            <Col flex="1 1 0">
              <Form.Item
                {...restField}
                name={[index, 'value']}
                rules={[{ required: true, message: '请输入值' }]}
                style={{ marginBottom: 0 }}
              >
                <Input placeholder="值 (如: nginx)" />
              </Form.Item>
            </Col>
            <Col flex="none">
              <Button
                type="text"
                danger
                size="small"
                icon={<MinusCircleOutlined />}
                onClick={() => remove(index)}
                aria-label="删除此行"
              />
            </Col>
          </Row>
        ))}
        <Button type="dashed" block onClick={() => add()} icon={<PlusOutlined />}>
          {addButtonText}
        </Button>
      </Flex>
    )}
  </Form.List>
);

// ============================================================
// Service 表单（可单独使用，或与 Drawer 组合）
// ============================================================

export const ServiceForm: React.FC<ServiceFormProps> = ({
  cloudId,
  namespacesOptions,
  onSuccess,
  onCancel,
  defaultNamespace,
  editMode = false,
  initialData,
  showAnnotationsEditor = false,
  form: formProp,
  hideFooterActions = false,
  onSubmittingChange,
  sectionCardProps,
}) => {
  const cardShell = sectionCardProps ?? DEFAULT_SECTION_CARD_SHELL;
  const [localForm] = Form.useForm<ServiceFormValues>();
  const form = formProp ?? localForm;
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [serviceType, setServiceType] = useState<string>('ClusterIP');

  const [discoveredPorts, setDiscoveredPorts] = useState<Array<{ name: string; port: number; protocol?: string }>>([]);
  const [discoveringPorts, setDiscoveringPorts] = useState(false);

  const [workloadImportOpen, setWorkloadImportOpen] = useState(false);

  const namespaceSelectOptions = useMemo(
    () => namespacesOptions.filter((ns) => !isSystemNamespace(ns)).map((ns) => ({ label: ns, value: ns })),
    [namespacesOptions],
  );

  const syncSubmitting = useCallback(
    (v: boolean) => {
      setLoading(v);
      onSubmittingChange?.(v);
    },
    [onSubmittingChange],
  );

  useEffect(() => {
    if (editMode && initialData) {
      const values = extractServiceFormValues(initialData);
      form.setFieldsValue(values);
      setServiceType(values.type || 'ClusterIP');
    } else {
      const defaultNs = defaultNamespace || namespacesOptions[0] || 'default';
      form.setFieldValue('namespace', defaultNs);
    }
  }, [defaultNamespace, namespacesOptions, form, editMode, initialData]);

  const handleTypeChange = (value: string) => {
    setServiceType(value);
    if (value === 'ExternalName') {
      form.setFieldValue('ports', []);
    }
  };

  const handleDiscoverPorts = useCallback(async () => {
    const namespace = form.getFieldValue('namespace');
    const selector = form.getFieldValue('selector') as Array<{ key: string; value: string }>;

    if (!namespace) {
      message.warning('请先选择命名空间');
      return;
    }

    if (!selector || selector.length === 0 || !selector.some((s) => s.key && s.value)) {
      message.warning('请先配置选择器');
      return;
    }

    const labelSelector = selector
      .filter((s) => s.key && s.value)
      .map((s) => `${s.key}=${s.value}`)
      .join(',');

    setDiscoveringPorts(true);
    try {
      const result = await fetchHarvesterPodsBySelector(cloudId, namespace, labelSelector);
      const pods = result?.data?.items || result?.items || [];

      if (!Array.isArray(pods)) {
        message.error('Pod 数据格式错误');
        console.error('Invalid pods response:', result);
        return;
      }

      const portsMap = new Map<string, { name: string; port: number; protocol?: string }>();

      pods.forEach((pod: any) => {
        const containers = pod?.spec?.containers || [];
        containers.forEach((container: any) => {
          const containerPorts = container.ports || [];
          containerPorts.forEach((p: any) => {
            const key = p.name ? `${p.name}:${p.containerPort}` : `port:${p.containerPort}`;
            if (!portsMap.has(key)) {
              portsMap.set(key, {
                name: p.name || '',
                port: p.containerPort,
                protocol: p.protocol,
              });
            }
          });
        });
      });

      const ports = Array.from(portsMap.values());
      setDiscoveredPorts(ports);

      if (ports.length === 0) {
        message.info('未找到匹配 Pod 的端口定义，请手动输入');
      } else {
        message.success(`发现 ${ports.length} 个可用端口`);
      }
    } catch (error: any) {
      console.error('查询 Pod 端口失败:', error);
      message.error(error.message || '查询失败');
    } finally {
      setDiscoveringPorts(false);
    }
  }, [cloudId, form, message]);

  const handleImportFromWorkload = (workload: WorkloadInfo) => {
    form.setFieldValue('namespace', workload.namespace);

    const selector = Object.entries(workload.selector).map(([key, value]) => ({ key, value }));
    form.setFieldValue('selector', selector);

    setDiscoveredPorts(workload.ports);

    if (workload.ports.length > 0) {
      const ports = workload.ports.map((p) => ({
        name: p.name || '',
        protocol: p.protocol || 'TCP',
        port: p.port,
        targetPort: p.name || p.port,
      }));
      form.setFieldValue('ports', ports);
    }

    message.success(`已从 ${workload.type}/${workload.displayName} 导入配置`);
  };

  const handleFinish = async (values: ServiceFormValues) => {
    syncSubmitting(true);
    try {
      const submitData = buildServiceSubmitData(values, editMode, { showAnnotationsEditor, initialData });

      if (editMode) {
        if (initialData?.metadata?.resourceVersion) {
          submitData.metadata.resourceVersion = initialData.metadata.resourceVersion;
        }
        await updateHarvesterService(cloudId, values.namespace, initialData?.metadata?.name, submitData);
        message.success('Service 更新成功');
      } else {
        await createHarvesterService(cloudId, values.namespace, submitData);
        message.success('Service 创建成功');
      }
      onSuccess();
    } catch (error: any) {
      console.error('[ServiceForm] 提交失败:', error);
      const errorMsg = error?.response?.data?.message || error?.message || '操作失败';
      message.error(errorMsg);
    } finally {
      syncSubmitting(false);
    }
  };

  return (
    <>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{
          name: generateVmWizardStyleDisplayName('svc'),
          type: 'ClusterIP',
          labels: [],
          metadataAnnotations: [],
          selector: [],
          ports: [{ protocol: 'TCP' }],
        }}
      >
        <Flex vertical gap="middle" style={{ width: '100%' }}>
          <Card title="基本信息" size="small" {...cardShell}>
            <Flex vertical gap="middle" style={{ width: '100%' }}>
              {editMode ? (
                <>
                  <Form.Item label="资源 ID">
                    <Input value={initialData?.metadata?.name || ''} disabled />
                  </Form.Item>
                  <Row gutter={[16, 0]}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="name"
                        label="显示名称"
                        rules={[{ required: true, message: '请输入显示名称' }]}
                      >
                        <Input placeholder="如: my-service" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="namespace"
                        label="命名空间"
                        rules={[{ required: true, message: '请选择命名空间' }]}
                      >
                        <Select
                          placeholder="选择命名空间"
                          showSearch
                          disabled
                          options={namespaceSelectOptions}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ) : (
                <Row gutter={[16, 0]}>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="name"
                      label="名称"
                      rules={[
                        { required: true, message: '请输入名称' },
                        { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '只允许小写字母、数字和连字符' },
                      ]}
                    >
                      <Input placeholder="如: my-service" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="namespace"
                      label="命名空间"
                      rules={[{ required: true, message: '请选择命名空间' }]}
                    >
                      <Select
                        placeholder="选择命名空间"
                        showSearch
                        options={namespaceSelectOptions}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              )}
              {!editMode && serviceType !== 'ExternalName' && (
                <Space wrap align="center">
                  <Button type="primary" icon={<ImportOutlined />} onClick={() => setWorkloadImportOpen(true)}>
                    从工作负载导入
                  </Button>
                  <Text type="secondary">自动填充选择器和端口配置</Text>
                </Space>
              )}
              {!(editMode && showAnnotationsEditor) && (
                <KeyValueEditor name="labels" label="标签" addButtonText="添加标签" />
              )}
            </Flex>
          </Card>

          {editMode && showAnnotationsEditor && (
            <Card title="标签" size="small" {...cardShell}>
              <KeyValueEditor name="labels" addButtonText="添加标签" />
            </Card>
          )}

          {editMode && showAnnotationsEditor && (
            <Card title="注解" size="small" {...cardShell}>
              <KeyValueEditor name="metadataAnnotations" addButtonText="添加注解" />
            </Card>
          )}

          <Card title="Service 配置" size="small" {...cardShell}>
            <Flex vertical gap="middle" style={{ width: '100%' }}>
              <Row gutter={[16, 0]}>
                <Col xs={24} sm={12}>
                  <Form.Item name="type" label="Service 类型" rules={[{ required: true, message: '请选择类型' }]}>
                    <Select options={SERVICE_TYPE_OPTIONS} onChange={handleTypeChange} />
                  </Form.Item>
                </Col>
                {serviceType === 'ClusterIP' && (
                  <Col xs={24} sm={12}>
                    <Form.Item name="clusterIP" label="ClusterIP">
                      <Input placeholder="留空自动分配，或输入 'None'" />
                    </Form.Item>
                  </Col>
                )}
              </Row>

              {serviceType === 'ExternalName' && (
                <Flex vertical gap="small">
                  <Alert type="info" showIcon message="ExternalName 类型将 Service 映射到外部 DNS 名称" />
                  <Form.Item
                    name="externalName"
                    label="外部名称"
                    rules={[{ required: true, message: '请输入外部 DNS 名称' }]}
                  >
                    <Input placeholder="如: external.example.com" />
                  </Form.Item>
                </Flex>
              )}

              {serviceType !== 'ExternalName' && (
                <Flex vertical gap="middle">
                  <KeyValueEditor name="selector" label="选择器" addButtonText="添加条目" />
                  <Space wrap align="center">
                    <Button type="dashed" size="small" icon={<SearchOutlined />} onClick={handleDiscoverPorts} loading={discoveringPorts}>
                      查询可用端口
                    </Button>
                    {discoveredPorts.length > 0 ? (
                      <Text type="success">已发现 {discoveredPorts.length} 个端口</Text>
                    ) : null}
                  </Space>
                </Flex>
              )}
            </Flex>
          </Card>

          {serviceType !== 'ExternalName' && (
            <Card title="端口配置" size="small" {...cardShell}>
              <Form.List name="ports">
                {(fields, { add, remove }) => (
                  <Flex vertical gap="middle" style={{ width: '100%' }}>
                    {fields.map(({ key, name: index, ...restField }, fieldIndex) => (
                      <React.Fragment key={key}>
                        {fieldIndex > 0 ? <Divider style={{ margin: 0 }} /> : null}
                        <Flex vertical gap="small" style={{ width: '100%' }}>
                          <Flex justify="space-between" align="center" wrap="wrap" gap="small">
                            <Text type="secondary">端口 {index + 1}</Text>
                            <Button
                              type="link"
                              danger
                              size="small"
                              icon={<MinusCircleOutlined />}
                              onClick={() => remove(index)}
                            >
                              删除
                            </Button>
                          </Flex>
                          <Row gutter={[12, 8]}>
                            <Col xs={24} sm={12}>
                              <Form.Item {...restField} name={[index, 'name']} label="名称">
                                <Input placeholder="如: http" />
                              </Form.Item>
                            </Col>
                            <Col xs={24} sm={12}>
                              <Form.Item {...restField} name={[index, 'protocol']} label="协议" initialValue="TCP">
                                <Select options={PROTOCOL_OPTIONS} />
                              </Form.Item>
                            </Col>
                            <Col xs={24} sm={12}>
                              <Form.Item
                                {...restField}
                                name={[index, 'port']}
                                label="端口"
                                rules={[{ required: true, message: '请输入端口' }]}
                              >
                                <InputNumber min={1} max={65535} placeholder="80" style={{ width: '100%' }} />
                              </Form.Item>
                            </Col>
                            <Col xs={24} sm={12}>
                              <Form.Item
                                {...restField}
                                name={[index, 'targetPort']}
                                label="容器内部端口"
                                rules={[{ required: true, message: '请输入容器内部端口' }]}
                              >
                                <Select
                                  placeholder="选择或输入端口"
                                  showSearch
                                  allowClear
                                  mode="tags"
                                  maxTagCount={1}
                                  options={discoveredPorts.map((p) => ({
                                    label: p.name ? `${p.name} (${p.port})` : `${p.port}`,
                                    value: p.name || p.port,
                                  }))}
                                  filterOption={(input, option) =>
                                    (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase()) ||
                                    (option?.value ?? '').toString().toLowerCase().includes(input.toLowerCase())
                                  }
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                          {serviceType === 'NodePort' ? (
                            <Row gutter={[12, 8]}>
                              <Col xs={24} sm={12}>
                                <Form.Item {...restField} name={[index, 'nodePort']} label="NodePort">
                                  <InputNumber min={30000} max={32767} placeholder="自动分配" style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                            </Row>
                          ) : null}
                        </Flex>
                      </React.Fragment>
                    ))}
                    <Button type="dashed" onClick={() => add({ protocol: 'TCP' })} block icon={<PlusOutlined />}>
                      添加端口
                    </Button>
                  </Flex>
                )}
              </Form.List>
            </Card>
          )}

          {!hideFooterActions ? (
            <Flex justify="flex-end" gap="small">
              <Button onClick={onCancel}>取消</Button>
              <Button type="primary" htmlType="submit" loading={loading}>
                {editMode ? '更新' : '创建'}
              </Button>
            </Flex>
          ) : null}
        </Flex>
      </Form>

      <WorkloadImportDrawer
        open={workloadImportOpen}
        cloudId={cloudId}
        namespace={form.getFieldValue('namespace')}
        onClose={() => setWorkloadImportOpen(false)}
        onImport={handleImportFromWorkload}
      />
    </>
  );
};

// ============================================================
// 抽屉：footer submit + 注入分区 Card
// ============================================================

const ServiceFormDrawer: React.FC<ServiceFormDrawerProps> = ({
  open,
  onClose,
  cloudId,
  namespacesOptions,
  mode,
  defaultNamespace,
  record,
  onCommitted,
}) => {
  const [form] = Form.useForm<ServiceFormValues>();
  const [submitting, setSubmitting] = useState(false);

  const raw = record?.raw;

  const drawerVisible = useMemo(() => {
    if (!open) return false;
    if (mode === 'create') return true;
    return !!raw;
  }, [open, mode, raw]);

  useEffect(() => {
    if (!open) {
      form.resetFields();
      setSubmitting(false);
    }
  }, [open, form]);

  const drawerTitle = mode === 'create' ? '创建服务' : '编辑服务';

  const submitLabel = mode === 'create' ? '创建' : '更新';

  return (
    <Drawer
      title={drawerTitle}
      open={drawerVisible}
      onClose={onClose}
      width={800}
      destroyOnHidden
      footer={
        drawerVisible ? (
          <Flex justify="flex-end" gap="small">
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => form.submit()}>
              {submitLabel}
            </Button>
          </Flex>
        ) : undefined
      }
    >
      {drawerVisible ? (
        <ServiceForm
          form={form}
          hideFooterActions
          sectionCardProps={DRAWER_SECTION_CARD_PROPS}
          onSubmittingChange={setSubmitting}
          cloudId={cloudId}
          namespacesOptions={namespacesOptions}
          editMode={mode === 'edit'}
          initialData={mode === 'edit' ? raw : undefined}
          defaultNamespace={defaultNamespace}
          showAnnotationsEditor={mode === 'edit'}
          onCancel={onClose}
          onSuccess={() => {
            onCommitted?.();
            onClose();
          }}
        />
      ) : null}
    </Drawer>
  );
};

export default ServiceFormDrawer;
