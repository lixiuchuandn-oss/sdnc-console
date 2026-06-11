/**
 * ==============================================================================
 * 模块名称: Job 创建表单 (JobForm)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/JobForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 分步骤表单组件，用于创建 Kubernetes Job 资源。
 * 
 * [模式支持]
 * - 表单模式: 分步骤引导填写
 * - YAML 模式: 直接编辑 YAML 定义
 * 
 * [步骤设计]
 * 步骤1: 基本信息 - 名称、命名空间、标签
 * 步骤2: 容器配置 - 镜像、命令、环境变量、资源限制
 * 步骤3: 任务配置 - 重试次数、超时时间、并行数
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Form,
  Input,
  Select,
  InputNumber,
  Steps,
  Button,
  Space,
  Card,
  Divider,
  Row,
  Col,
  App,
  Segmented,
  Alert,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
  CodeOutlined,
  FormOutlined,
} from '@ant-design/icons';
import yaml from 'js-yaml';
import { createHarvesterContainerResource } from '../../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName, isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { RegistryBrowserDrawer } from './index';
import { ensureImagePullSecretsForImages } from './workloadForm/ensureRegistryPullSecret';
import {
  filterDockerRegistryEntries,
  findRegistryForImage,
  localRegistryToCredential,
} from './workloadForm/registryCredentials';
import { useMergedRegistryList } from './workloadForm/hooks/useMergedRegistryList';

// ============================================================
// 常量定义
// ============================================================

const CPU_UNITS = [
  { label: 'm (毫核)', value: 'm' },
  { label: '核', value: '' },
];

const MEMORY_UNITS = [
  { label: 'Mi', value: 'Mi' },
  { label: 'Gi', value: 'Gi' },
  { label: 'Ki', value: 'Ki' },
  { label: 'M', value: 'M' },
  { label: 'G', value: 'G' },
];

const ResourceInput: React.FC<{
  value?: string;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  units: Array<{ label: string; value: string }>;
  defaultUnit: string;
  unitTooltip?: string;
}> = ({ value, onChange, placeholder, units, defaultUnit, unitTooltip }) => {
  const [num, setNum] = useState<string>('');
  const [unit, setUnit] = useState<string>(defaultUnit);

  useEffect(() => {
    if (!value) {
      setNum('');
      setUnit(defaultUnit);
      return;
    }
    const match = value.match(/^(\d+\.?\d*)(.*)$/);
    if (match) {
      setNum(match[1]);
      const suffix = match[2];
      if (suffix !== undefined && suffix !== '') {
        setUnit(suffix);
      } else {
        if (defaultUnit === 'm') {
          setUnit('');
        } else {
          setUnit(defaultUnit);
        }
      }
    }
  }, [value, defaultUnit]);

  const handleNumChange = (newNum: string) => {
    setNum(newNum);
    if (newNum) {
      onChange?.(newNum + unit);
    } else {
      onChange?.(undefined);
    }
  };

  const handleUnitChange = (newUnit: string) => {
    setUnit(newUnit);
    if (num) {
      onChange?.(num + newUnit);
    }
  };

  return (
    <Input.Group compact style={{ display: 'flex' }}>
      <InputNumber
        value={num ? Number(num) : undefined}
        onChange={(v) => handleNumChange(v ? String(v) : '')}
        placeholder={placeholder}
        min={0}
        step={unit === 'm' ? 100 : 0.5}
        precision={unit === 'm' ? 0 : 2}
        style={{ flex: 1, minWidth: 60 }}
      />
      <Tooltip title={unitTooltip}>
        <Select
          value={unit}
          onChange={handleUnitChange}
          options={units}
          style={{ width: 110 }}
        />
      </Tooltip>
    </Input.Group>
  );
};
// 类型定义
// ============================================================

export interface JobFormValues {
  // 基本信息
  name: string;
  namespace: string;
  labels: Array<{ key: string; value: string }>;
  
  // 容器配置
  containerName: string;
  image: string;
  imagePullPolicy: 'Always' | 'IfNotPresent' | 'Never';
  command: string;
  args: string;
  env: Array<{ name: string; value: string }>;
  resources: {
    requests: { cpu?: string; memory?: string };
    limits: { cpu?: string; memory?: string };
  };
  
  // 任务配置
  backoffLimit: number;
  activeDeadlineSeconds: number;
  ttlSecondsAfterFinished: number;
  parallelism: number;
  completions: number;
  restartPolicy: 'OnFailure' | 'Never';
  
  // 高级配置
  imagePullSecrets: string[];
}

export interface JobFormProps {
  cloudId: string;
  namespacesOptions: string[];
  imagePullSecrets: Array<{ metadata: { name: string; namespace: string } }>;
  secretsWithCredentials?: any[];
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
}

// ============================================================
// 常量定义
// ============================================================

const IMAGE_PULL_POLICY_OPTIONS = [
  { value: 'IfNotPresent', label: 'IfNotPresent (本地优先)' },
  { value: 'Always', label: 'Always (始终拉取)' },
  { value: 'Never', label: 'Never (从不拉取)' },
];

const RESTART_POLICY_OPTIONS = [
  { value: 'OnFailure', label: 'OnFailure (失败重启)' },
  { value: 'Never', label: 'Never (从不重启)' },
];

// ============================================================
// 子组件: 标签编辑器
// ============================================================

const LabelEditor: React.FC<{
  name: string;
  label: string;
}> = ({ name, label }) => (
  <Form.List name={name}>
    {(fields, { add, remove }) => (
      <div>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <span style={{ fontWeight: 500 }}>{label}</span>
            <Button type="dashed" size="small" onClick={() => add()} icon={<PlusOutlined />}>
              添加
            </Button>
          </Space>
        </div>
        {fields.map(({ key, name: index, ...restField }) => (
          <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
            <Form.Item
              {...restField}
              name={[index, 'key']}
              rules={[{ required: true, message: '请输入键' }]}
            >
              <Input placeholder="键" style={{ width: 150 }} />
            </Form.Item>
            <Form.Item
              {...restField}
              name={[index, 'value']}
              rules={[{ required: true, message: '请输入值' }]}
            >
              <Input placeholder="值" style={{ width: 150 }} />
            </Form.Item>
            <MinusCircleOutlined onClick={() => remove(index)} />
          </Space>
        ))}
      </div>
    )}
  </Form.List>
);

// ============================================================
// 子组件: 环境变量编辑器
// ============================================================

const EnvEditor: React.FC = () => (
  <Form.List name="env">
    {(fields, { add, remove }) => (
      <div>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <span style={{ fontWeight: 500 }}>环境变量</span>
            <Button type="dashed" size="small" onClick={() => add()} icon={<PlusOutlined />}>
              添加
            </Button>
          </Space>
        </div>
        {fields.map(({ key, name: index, ...restField }) => (
          <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
            <Form.Item
              {...restField}
              name={[index, 'name']}
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input placeholder="名称" style={{ width: 150 }} />
            </Form.Item>
            <Form.Item
              {...restField}
              name={[index, 'value']}
              rules={[{ required: true, message: '请输入值' }]}
            >
              <Input placeholder="值" style={{ width: 250 }} />
            </Form.Item>
            <MinusCircleOutlined onClick={() => remove(index)} />
          </Space>
        ))}
      </div>
    )}
  </Form.List>
);

// ============================================================
// 主组件
// ============================================================

const JobForm: React.FC<JobFormProps> = ({
  cloudId,
  namespacesOptions,
  imagePullSecrets,
  secretsWithCredentials,
  onSuccess,
  onCancel,
  defaultNamespace,
}) => {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const [yamlValue, setYamlValue] = useState('');
  const [registryBrowserVisible, setRegistryBrowserVisible] = useState(false);
  const [browserCredential, setBrowserCredential] = useState<any>(null);

  const allRegistries = useMergedRegistryList(cloudId);
  const dockerRegistries = useMemo(
    () => filterDockerRegistryEntries(allRegistries),
    [allRegistries],
  );

  const openRegistryBrowser = useCallback(() => {
    if (dockerRegistries.length === 0) {
      message.warning(
        allRegistries.some((r) => r.source === 'harbor')
          ? 'Harbor 镜像请在选择镜像抽屉中切换到「Harbor 镜像仓库」；或部署本地 Docker 仓库'
          : '请先在镜像仓库中添加仓库、部署本地仓库或创建凭证',
      );
      setBrowserCredential(null);
      setRegistryBrowserVisible(true);
      return;
    }
    const currentImage = form.getFieldValue('image') || '';
    let targetCredential = localRegistryToCredential(dockerRegistries[0]);
    if (currentImage) {
      const matchingRegistry = findRegistryForImage(currentImage, dockerRegistries);
      if (matchingRegistry) {
        targetCredential = localRegistryToCredential(matchingRegistry);
      }
    }
    if (!targetCredential) {
      message.error('解析镜像仓库失败，请检查仓库配置');
      return;
    }
    setBrowserCredential(targetCredential);
    setRegistryBrowserVisible(true);
  }, [allRegistries, dockerRegistries, form, message]);

  // 初始化默认值
  useEffect(() => {
    form.setFieldsValue({
      name: generateVmWizardStyleDisplayName('job'),
      namespace: defaultNamespace || namespacesOptions[0] || 'default',
      imagePullPolicy: 'IfNotPresent',
      backoffLimit: 6,
      activeDeadlineSeconds: 600,
      ttlSecondsAfterFinished: 3600,
      parallelism: 1,
      completions: 1,
      restartPolicy: 'OnFailure',
      containerName: 'main',
      resources: {
        requests: {},
        limits: {},
      },
      labels: [],
      env: [],
      imagePullSecrets: [],
    });
  }, [form, defaultNamespace, namespacesOptions]);

  // 步骤定义
  const steps = [
    { title: '基本信息', icon: <FormOutlined /> },
    { title: '容器配置', icon: <InfoCircleOutlined /> },
    { title: '任务配置', icon: <InfoCircleOutlined /> },
  ];

  // 下一步
  const handleNext = async () => {
    try {
      await form.validateFields();
      setCurrentStep(currentStep + 1);
    } catch (e) {
      // 验证失败
    }
  };

  // 上一步
  const handlePrev = () => {
    setCurrentStep(currentStep - 1);
  };

  // 表单值转 YAML
  const formValuesToYaml = useCallback((values: JobFormValues): string => {
    const labels: Record<string, string> = {};
    (values.labels || []).forEach((l) => {
      if (l.key && l.value) labels[l.key] = l.value;
    });

    const env = (values.env || []).map((e) => ({ name: e.name, value: e.value }));
    
    const container: any = {
      name: values.containerName || 'main',
      image: values.image,
      imagePullPolicy: values.imagePullPolicy,
    };

    // 命令
    if (values.command) {
      container.command = values.command.split('\n').filter(Boolean);
    }
    if (values.args) {
      container.args = values.args.split('\n').filter(Boolean);
    }

    // 环境变量
    if (env.length > 0) {
      container.env = env;
    }

    // 资源限制
    const resources: any = {};
    if (values.resources?.requests?.cpu || values.resources?.requests?.memory) {
      resources.requests = {};
      if (values.resources.requests.cpu) resources.requests.cpu = values.resources.requests.cpu;
      if (values.resources.requests.memory) resources.requests.memory = values.resources.requests.memory;
    }
    if (values.resources?.limits?.cpu || values.resources?.limits?.memory) {
      resources.limits = {};
      if (values.resources.limits.cpu) resources.limits.cpu = values.resources.limits.cpu;
      if (values.resources.limits.memory) resources.limits.memory = values.resources.limits.memory;
    }
    if (Object.keys(resources).length > 0) {
      container.resources = resources;
    }

    const jobName = generateHarvesterCrMetadataName('job');
    
    const spec: any = {
      backoffLimit: values.backoffLimit,
      parallelism: values.parallelism,
      completions: values.completions,
      template: {
        metadata: {
          labels: Object.keys(labels).length > 0 ? { ...labels, 'job-name': jobName } : { 'job-name': jobName },
        },
        spec: {
          restartPolicy: values.restartPolicy,
          containers: [container],
        },
      },
    };

    if (values.activeDeadlineSeconds > 0) {
      spec.activeDeadlineSeconds = values.activeDeadlineSeconds;
    }

    if (values.ttlSecondsAfterFinished && values.ttlSecondsAfterFinished > 0) {
      spec.ttlSecondsAfterFinished = values.ttlSecondsAfterFinished;
    }

    // 镜像拉取凭证
    if (values.imagePullSecrets && values.imagePullSecrets.length > 0) {
      spec.template.spec.imagePullSecrets = values.imagePullSecrets.map((name) => ({ name }));
    }

    const job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace: values.namespace,
        labels: Object.keys(labels).length > 0 ? labels : undefined,
        annotations: values.name ? {
          'tower.io/alias': values.name,
        } : undefined,
      },
      spec,
    };

    return yaml.dump(job, { indent: 2, lineWidth: -1 });
  }, []);

  // YAML 转表单值
  const yamlToFormValues = useCallback((yamlStr: string): Partial<JobFormValues> | null => {
    try {
      const doc = yaml.load(yamlStr) as any;
      if (!doc || doc.kind !== 'Job') {
        message.error('无效的 Job YAML');
        return null;
      }

      const container = doc?.spec?.template?.spec?.containers?.[0] || {};
      
      return {
        name: doc.metadata?.name || '',
        namespace: doc.metadata?.namespace || 'default',
        labels: Object.entries(doc.metadata?.labels || {}).map(([key, value]) => ({
          key,
          value: String(value),
        })),
        containerName: container.name || 'main',
        image: container.image || '',
        imagePullPolicy: container.imagePullPolicy || 'IfNotPresent',
        command: (container.command || []).join('\n'),
        args: (container.args || []).join('\n'),
        env: (container.env || []).map((e: any) => ({ name: e.name, value: e.value || '' })),
        resources: {
          requests: container.resources?.requests || {},
          limits: container.resources?.limits || {},
        },
        backoffLimit: doc.spec?.backoffLimit || 6,
        activeDeadlineSeconds: doc.spec?.activeDeadlineSeconds || 600,
        parallelism: doc.spec?.parallelism || 1,
        completions: doc.spec?.completions || 1,
        restartPolicy: doc.spec?.template?.spec?.restartPolicy || 'OnFailure',
        imagePullSecrets: (doc.spec?.template?.spec?.imagePullSecrets || []).map((s: any) => s.name),
      };
    } catch (e: any) {
      message.error('YAML 解析失败: ' + e.message);
      return null;
    }
  }, [message]);

  // 模式切换时转换数据
  const handleModeChange = useCallback((newMode: 'form' | 'yaml') => {
    if (newMode === 'yaml') {
      // 表单 -> YAML
      const values = form.getFieldsValue(true);
      const yamlStr = formValuesToYaml(values as JobFormValues);
      setYamlValue(yamlStr);
    } else {
      // YAML -> 表单
      if (yamlValue) {
        const parsed = yamlToFormValues(yamlValue);
        if (parsed) {
          form.setFieldsValue(parsed);
        }
      }
    }
    setMode(newMode);
  }, [form, formValuesToYaml, yamlToFormValues, yamlValue]);

  // 提交表单
  const handleSubmit = async () => {
    setLoading(true);
    try {
      let body: any;
      
      if (mode === 'yaml') {
        body = yaml.load(yamlValue) as any;
      } else {
        // 使用 getFieldsValue(true) 获取所有字段值（包括未渲染的字段）
        const allValues = form.getFieldsValue(true) as JobFormValues;
        
        // 手动验证必填字段
        if (!allValues.name) {
          message.error('请输入名称');
          setCurrentStep(0);
          return;
        }
        if (!allValues.image) {
          message.error('请输入镜像地址');
          setCurrentStep(1);
          return;
        }

        const namespace = allValues.namespace || defaultNamespace || 'default';
        const secrets = await ensureImagePullSecretsForImages(
          cloudId,
          namespace,
          [allValues.image],
          allRegistries,
          allValues.imagePullSecrets || [],
        );
        allValues.imagePullSecrets = secrets;
        form.setFieldsValue({ imagePullSecrets: secrets });
        
        const yamlStr = formValuesToYaml(allValues);
        body = yaml.load(yamlStr) as any;
      }

      await createHarvesterContainerResource(
        cloudId,
        '/apis/batch/v1/jobs',
        body.metadata?.namespace,
        body,
      );

      message.success('Job 创建成功');
      onSuccess();
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  // 从镜像浏览器选择镜像
  const handleSelectImage = (image: string, secret?: string) => {
    form.setFieldsValue({ image });
    if (secret) {
      const currentSecrets = form.getFieldValue('imagePullSecrets') || [];
      if (!currentSecrets.includes(secret)) {
        form.setFieldsValue({ imagePullSecrets: [...currentSecrets, secret] });
        message.success(`已选择镜像: ${image}，并自动添加拉取凭证: ${secret}`);
      } else {
        message.success(`已选择镜像: ${image}`);
      }
    } else {
      message.success(`已选择镜像: ${image}`);
    }
    setRegistryBrowserVisible(false);
  };

  // 渲染步骤内容
  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <Card title="基本信息" size="small">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="name"
                  label="名称"
                  rules={[
                    { required: true, message: '请输入名称' },
                    { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '名称只能包含小写字母、数字和连字符' },
                  ]}
                >
                  <Input placeholder="job-name" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="namespace"
                  label="项目"
                  rules={[{ required: true, message: '请选择项目' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={namespacesOptions.filter((ns) => !isSystemNamespace(ns)).map((ns) => ({ label: ns, value: ns }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            <LabelEditor name="labels" label="标签" />
          </Card>
        );

      case 1:
        return (
          <Card title="容器配置" size="small">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="containerName"
                  label="容器名称"
                  rules={[{ required: true, message: '请输入容器名称' }]}
                >
                  <Input placeholder="main" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="image"
                  label={
                    <Space>
                      镜像
                      <Button type="link" size="small" onClick={openRegistryBrowser}>
                        浏览仓库
                      </Button>
                    </Space>
                  }
                  rules={[{ required: true, message: '请输入镜像地址' }]}
                >
                  <Input placeholder="nginx:latest 或 registry.example.com/image:tag" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="imagePullPolicy" label="镜像拉取策略">
                  <Select options={IMAGE_PULL_POLICY_OPTIONS} />
                </Form.Item>
              </Col>
            </Row>
            <Divider />
            <Form.Item name="command" label="启动命令" extra="每行一个命令参数">
              <Input.TextArea rows={3} placeholder={"echo\nhello"} />
            </Form.Item>
            <Form.Item name="args" label="启动参数" extra="每行一个参数">
              <Input.TextArea rows={3} placeholder={"--arg1\n--arg2"} />
            </Form.Item>
            <Divider />
            <EnvEditor />
            <Divider />
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name={['resources', 'requests', 'cpu']} label="CPU 请求">
                  <ResourceInput placeholder="如: 100" units={CPU_UNITS} defaultUnit="m" unitTooltip="m: 毫核(1000m=1核)；核: 支持小数如0.5" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name={['resources', 'requests', 'memory']} label="内存请求">
                  <ResourceInput placeholder="如: 128" units={MEMORY_UNITS} defaultUnit="Mi" unitTooltip="MiB/GiB: 二进制单位(1GiB=1024MiB)，任意数值均可" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name={['resources', 'limits', 'cpu']} label="CPU 限制">
                  <ResourceInput placeholder="如: 500" units={CPU_UNITS} defaultUnit="m" unitTooltip="m: 毫核(1000m=1核)；核: 支持小数如0.5" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name={['resources', 'limits', 'memory']} label="内存限制">
                  <ResourceInput placeholder="如: 512" units={MEMORY_UNITS} defaultUnit="Mi" unitTooltip="MiB/GiB: 二进制单位(1GiB=1024MiB)，任意数值均可" />
                </Form.Item>
              </Col>
            </Row>
          </Card>
        );

      case 2:
        return (
          <Card title="任务配置" size="small">
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item
                  name="backoffLimit"
                  label={
                    <Tooltip title="任务失败后的重试次数">
                      重试次数 <InfoCircleOutlined />
                    </Tooltip>
                  }
                >
                  <InputNumber min={0} max={100} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="activeDeadlineSeconds"
                  label={
                    <Tooltip title="任务的最长运行时间（秒），0 表示不限制">
                      超时时间（秒） <InfoCircleOutlined />
                    </Tooltip>
                  }
                >
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="ttlSecondsAfterFinished"
                  label={
                    <Tooltip title="Job 完成后自动清理 Pod 的等待时间（秒），0 表示不自动清理">
                      完成后保留时间（秒） <InfoCircleOutlined />
                    </Tooltip>
                  }
                >
                  <InputNumber min={0} max={86400} style={{ width: '100%' }} placeholder="如 3600 表示 1 小时后清理" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="restartPolicy" label="重启策略">
                  <Select options={RESTART_POLICY_OPTIONS} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="parallelism"
                  label={
                    <Tooltip title="并行运行的 Pod 数量">
                      并行数 <InfoCircleOutlined />
                    </Tooltip>
                  }
                >
                  <InputNumber min={1} max={100} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="completions"
                  label={
                    <Tooltip title="需要成功完成的 Pod 数量">
                      完成数 <InfoCircleOutlined />
                    </Tooltip>
                  }
                >
                  <InputNumber min={1} max={1000} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Alert
              message="任务配置说明"
              description={
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li><strong>重试次数</strong>：任务失败后自动重试的最大次数</li>
                  <li><strong>超时时间</strong>：任务运行的最大时长，超时后将被终止</li>
                  <li><strong>重启策略</strong>：OnFailure - 失败时重启容器；Never - 从不重启</li>
                  <li><strong>并行数</strong>：同时运行的 Pod 数量</li>
                  <li><strong>完成数</strong>：需要成功完成的 Pod 总数</li>
                </ul>
              }
              type="info"
              showIcon
            />
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div>
      {/* 模式切换 */}
      <div style={{ marginBottom: 16, textAlign: 'right' }}>
        <Segmented
          value={mode}
          onChange={(v) => handleModeChange(v as 'form' | 'yaml')}
          options={[
            { label: '表单模式', value: 'form', icon: <FormOutlined /> },
            { label: 'YAML 模式', value: 'yaml', icon: <CodeOutlined /> },
          ]}
        />
      </div>

      {mode === 'form' ? (
        <>
          {/* 步骤条 */}
          <Steps current={currentStep} items={steps} style={{ marginBottom: 24 }} />
          
          {/* 表单内容 */}
          <Form form={form} layout="vertical">
            {renderStepContent()}
          </Form>

          {/* 操作按钮 */}
          <div style={{ marginTop: 24, textAlign: 'right' }}>
            <Space>
              {currentStep > 0 && (
                <Button onClick={handlePrev}>上一步</Button>
              )}
              {currentStep < steps.length - 1 && (
                <Button type="primary" onClick={handleNext}>
                  下一步
                </Button>
              )}
              {currentStep === steps.length - 1 && (
                <Button type="primary" loading={loading} onClick={handleSubmit}>
                  创建
                </Button>
              )}
              <Button onClick={onCancel}>取消</Button>
            </Space>
          </div>
        </>
      ) : (
        <>
          <Alert
            message="YAML 模式"
            description="直接编辑 Job 的 YAML 定义。编辑完成后点击创建按钮提交。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Input.TextArea
            value={yamlValue}
            onChange={(e) => setYamlValue(e.target.value)}
            rows={20}
            style={{ fontFamily: 'monospace' }}
            placeholder={`apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
  namespace: default
spec:
  backoffLimit: 3
  template:
    spec:
      containers:
      - name: main
        image: busybox
        command: ["echo", "hello"]
      restartPolicy: OnFailure`}
          />
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Space>
              <Button type="primary" loading={loading} onClick={handleSubmit}>
                创建
              </Button>
              <Button onClick={onCancel}>取消</Button>
            </Space>
          </div>
        </>
      )}

      {/* 镜像仓库浏览器 */}
      <RegistryBrowserDrawer
        visible={registryBrowserVisible}
        cloudId={cloudId}
        credential={browserCredential}
        registries={allRegistries}
        namespace={form.getFieldValue('namespace') || defaultNamespace || 'default'}
        onRegistryChange={setBrowserCredential}
        currentImage={form.getFieldValue('image')}
        onClose={() => setRegistryBrowserVisible(false)}
        onSelectImage={handleSelectImage}
      />
    </div>
  );
};

export default JobForm;
