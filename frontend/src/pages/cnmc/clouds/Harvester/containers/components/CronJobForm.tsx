/**
 * ==============================================================================
 * 模块名称: CronJob 创建表单 (CronJobForm)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/CronJobForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 分步骤表单组件，用于创建 Kubernetes CronJob 资源。
 * 
 * [模式支持]
 * - 表单模式: 分步骤引导填写
 * - YAML 模式: 直接编辑 YAML 定义
 * 
 * [步骤设计]
 * 步骤1: 基本信息 - 名称、命名空间、标签
 * 步骤2: 调度配置 - Cron 表达式、并发策略、历史限制
 * 步骤3: 容器配置 - 镜像、命令、环境变量、资源限制
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
  ClockCircleOutlined,
} from '@ant-design/icons';
import yaml from 'js-yaml';
import { createHarvesterContainerResource } from '../../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName, isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { RegistryBrowserDrawer, CronExpressionHelper } from './index';

// ============================================================
// 类型定义
// ============================================================

export interface CronJobFormValues {
  // 基本信息
  name: string;
  namespace: string;
  labels: Array<{ key: string; value: string }>;
  
  // 调度配置
  schedule: string;
  concurrencyPolicy: 'Allow' | 'Forbid' | 'Replace';
  successfulJobsHistoryLimit: number;
  failedJobsHistoryLimit: number;
  
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
  restartPolicy: 'OnFailure' | 'Never';
  
  // 高级配置
  imagePullSecrets: string[];
}

export interface CronJobFormProps {
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

const CONCURRENCY_POLICY_OPTIONS = [
  { value: 'Allow', label: 'Allow (允许并发)' },
  { value: 'Forbid', label: 'Forbid (禁止并发)' },
  { value: 'Replace', label: 'Replace (替换旧任务)' },
];

// 常用 Cron 表达式预设
const CRON_PRESETS = [
  { label: '每分钟', value: '* * * * *' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每天凌晨2点', value: '0 2 * * *' },
  { label: '每天中午12点', value: '0 12 * * *' },
  { label: '每周一凌晨2点', value: '0 2 * * 1' },
  { label: '每月1号凌晨2点', value: '0 2 1 * *' },
];

// 宏表达式预设
const MACRO_PRESETS = [
  { label: '@daily (每天)', value: '@daily' },
  { label: '@hourly (每小时)', value: '@hourly' },
  { label: '@weekly (每周)', value: '@weekly' },
  { label: '@monthly (每月)', value: '@monthly' },
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
// 子组件: Cron 表达式帮助
// ============================================================

const CronExpressionHelp: React.FC = () => (
  <Alert
    message="Cron 表达式格式"
    description={
      <div>
        <code>* * * * *</code>
        <br />
        <span style={{ fontSize: 12, color: '#666' }}>
          分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-7)
        </span>
        <div style={{ marginTop: 8 }}>
          <strong>示例：</strong>
          <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
            <li><code>0 * * * *</code> - 每小时整点</li>
            <li><code>*/15 * * * *</code> - 每15分钟</li>
            <li><code>0 9-17 * * 1-5</code> - 工作日9-17点整点</li>
            <li><code>0 0 1 1 *</code> - 每月1号零点</li>
          </ul>
        </div>
      </div>
    }
    type="info"
    showIcon
    style={{ marginTop: 8 }}
  />
);

// ============================================================
// 主组件
// ============================================================

const CronJobForm: React.FC<CronJobFormProps> = ({
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
  const [scheduleValue, setScheduleValue] = useState('0 2 * * *');
  const [selectedPreset, setSelectedPreset] = useState<string>('0 2 * * *');

  /**
   * 加载 localStorage 中的仓库列表
   */
  const localStorageRegistries = useMemo(() => {
    try {
      const data = localStorage.getItem('harvester-registries');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }, []);

  /**
   * 将 Secret 对象转换为 RegistryBrowser 需要的 credential 格式
   */
  const secretToCredential = useCallback((secret: any) => {
    if (!secret) return null;

    try {
      const data = secret?.data?.['.dockerconfigjson'];
      if (!data) return null;

      const decoded = atob(data);
      const config = JSON.parse(decoded);
      const auths = config.auths || {};
      const server = Object.keys(auths)[0];

      if (!server) return null;

      const auth = auths[server];
      let username: string | undefined;
      let password: string | undefined;

      if (auth?.auth) {
        try {
          const decodedAuth = atob(auth.auth);
          const [u, p] = decodedAuth.split(':');
          username = u;
          password = p;
        } catch {
          username = auth?.username;
          password = auth?.password;
        }
      } else {
        username = auth?.username;
        password = auth?.password;
      }

      return {
        name: secret?.metadata?.name,
        namespace: secret?.metadata?.namespace,
        server,
        username: username || undefined,
        password: password || undefined,
        insecure: !server.startsWith('https://'),
      };
    } catch {
      return null;
    }
  }, []);

  /**
   * 合并 Secrets 和 localStorage 仓库列表
   */
  const allRegistries = useMemo(() => {
    const registries: any[] = [];

    localStorageRegistries.forEach((reg: any) => {
      registries.push({
        source: 'localStorage',
        id: reg.id,
        name: reg.name,
        server: reg.server,
        username: reg.username,
        password: reg.password,
        insecure: reg.insecure,
      });
    });

    if (secretsWithCredentials && secretsWithCredentials.length > 0) {
      secretsWithCredentials.forEach((secret: any) => {
        const credential = secretToCredential(secret);
        if (credential) {
          registries.push({
            source: 'secret',
            id: secret?.metadata?.name,
            name: secret?.metadata?.name,
            server: credential.server,
            username: credential.username,
            password: credential.password,
            insecure: credential.insecure,
          });
        }
      });
    }

    return registries;
  }, [localStorageRegistries, secretsWithCredentials, secretToCredential]);

  /**
   * 将 registry 对象转换为 credential
   */
  const registryToCredential = useCallback((registry: any) => {
    return {
      server: registry.server,
      username: registry.username,
      password: registry.password,
      insecure: registry.insecure,
    };
  }, []);

  /**
   * 打开仓库浏览器
   */
  const openRegistryBrowser = useCallback(() => {
    if (allRegistries.length > 0) {
      const currentImage = form.getFieldValue('image') || '';
      const serverFromImage = currentImage.split('/')[0];
      
      let targetCredential = registryToCredential(allRegistries[0]);
      if (serverFromImage && serverFromImage.includes('.')) {
        const matchingRegistry = allRegistries.find(r => r.server === serverFromImage);
        if (matchingRegistry) {
          targetCredential = registryToCredential(matchingRegistry);
        }
      }
      setBrowserCredential(targetCredential);
    }
    setRegistryBrowserVisible(true);
  }, [allRegistries, form, registryToCredential]);

  // 初始化默认值
  useEffect(() => {
    const defaultSchedule = '0 2 * * *';
    form.setFieldsValue({
      name: generateVmWizardStyleDisplayName('cjob'),
      namespace: defaultNamespace || namespacesOptions[0] || 'default',
      imagePullPolicy: 'IfNotPresent',
      schedule: defaultSchedule,
      concurrencyPolicy: 'Forbid',
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 1,
      backoffLimit: 6,
      activeDeadlineSeconds: 0,
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
    setScheduleValue(defaultSchedule);
    setSelectedPreset(defaultSchedule);
  }, [form, defaultNamespace, namespacesOptions]);

  // 步骤定义
  const steps = [
    { title: '基本信息', icon: <FormOutlined /> },
    { title: '调度配置', icon: <ClockCircleOutlined /> },
    { title: '容器配置', icon: <InfoCircleOutlined /> },
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
  const formValuesToYaml = useCallback((values: CronJobFormValues): string => {
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

    const jobSpec: any = {
      template: {
        metadata: {
          labels: Object.keys(labels).length > 0 ? labels : { 'cronjob-name': values.name },
        },
        spec: {
          restartPolicy: values.restartPolicy,
          containers: [container],
        },
      },
    };

    if (values.backoffLimit > 0) {
      jobSpec.backoffLimit = values.backoffLimit;
    }

    if (values.activeDeadlineSeconds > 0) {
      jobSpec.activeDeadlineSeconds = values.activeDeadlineSeconds;
    }

    // 镜像拉取凭证
    if (values.imagePullSecrets && values.imagePullSecrets.length > 0) {
      jobSpec.template.spec.imagePullSecrets = values.imagePullSecrets.map((name) => ({ name }));
    }

    const spec: any = {
      schedule: values.schedule,
      concurrencyPolicy: values.concurrencyPolicy,
      successfulJobsHistoryLimit: values.successfulJobsHistoryLimit,
      failedJobsHistoryLimit: values.failedJobsHistoryLimit,
      jobTemplate: {
        spec: jobSpec,
      },
    };

    const cronjob = {
      apiVersion: 'batch/v1',
      kind: 'CronJob',
      metadata: {
        name: generateHarvesterCrMetadataName('cronjob'),
        namespace: values.namespace,
        labels: Object.keys(labels).length > 0 ? labels : undefined,
        annotations: {
          'tower.io/alias': values.name,
        },
      },
      spec,
    };

    return yaml.dump(cronjob, { indent: 2, lineWidth: -1 });
  }, []);

  // YAML 转表单值
  const yamlToFormValues = useCallback((yamlStr: string): Partial<CronJobFormValues> | null => {
    try {
      const doc = yaml.load(yamlStr) as any;
      if (!doc || doc.kind !== 'CronJob') {
        message.error('无效的 CronJob YAML');
        return null;
      }

      const container = doc?.spec?.jobTemplate?.spec?.template?.spec?.containers?.[0] || {};
      
      return {
        name: doc.metadata?.name || '',
        namespace: doc.metadata?.namespace || 'default',
        labels: Object.entries(doc.metadata?.labels || {}).map(([key, value]) => ({
          key,
          value: String(value),
        })),
        schedule: doc.spec?.schedule || '0 2 * * *',
        concurrencyPolicy: doc.spec?.concurrencyPolicy || 'Forbid',
        successfulJobsHistoryLimit: doc.spec?.successfulJobsHistoryLimit || 3,
        failedJobsHistoryLimit: doc.spec?.failedJobsHistoryLimit || 1,
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
        backoffLimit: doc.spec?.jobTemplate?.spec?.backoffLimit || 6,
        activeDeadlineSeconds: doc.spec?.jobTemplate?.spec?.activeDeadlineSeconds || 0,
        restartPolicy: doc.spec?.jobTemplate?.spec?.template?.spec?.restartPolicy || 'OnFailure',
        imagePullSecrets: (doc.spec?.jobTemplate?.spec?.template?.spec?.imagePullSecrets || []).map((s: any) => s.name),
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
      const yamlStr = formValuesToYaml(values as CronJobFormValues);
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
        const allValues = form.getFieldsValue(true) as CronJobFormValues;
        
        // 手动验证必填字段
        if (!allValues.name) {
          message.error('请输入名称');
          setCurrentStep(0);
          return;
        }
        if (!allValues.schedule) {
          message.error('请输入调度计划');
          setCurrentStep(1);
          return;
        }
        if (!allValues.image) {
          message.error('请输入镜像地址');
          setCurrentStep(2);
          return;
        }
        
        const yamlStr = formValuesToYaml(allValues);
        body = yaml.load(yamlStr) as any;
      }

      await createHarvesterContainerResource(
        cloudId,
        '/apis/batch/v1/cronjobs',
        body.metadata?.namespace,
        body,
      );

      message.success('CronJob 创建成功');
      onSuccess();
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  // 从镜像浏览器选择镜像
  const handleSelectImage = (image: string) => {
    form.setFieldsValue({ image });
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
                  <Input placeholder="cronjob-name" />
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
          <Card title="调度配置" size="small">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="schedule"
                  label="调度计划 (Cron 表达式)"
                  rules={[{ required: true, message: '请输入 Cron 表达式' }]}
                >
                  <Input 
                    placeholder="0 2 * * *" 
                    onChange={(e) => {
                      const value = e.target.value;
                      setScheduleValue(value);
                      // 检查是否匹配某个预设或宏
                      const matchedPreset = [...CRON_PRESETS, ...MACRO_PRESETS].find(p => p.value === value);
                      setSelectedPreset(matchedPreset ? matchedPreset.value : 'custom');
                    }}
                    addonAfter={
                      <Select
                        style={{ width: 140 }}
                        placeholder="预设"
                        value={selectedPreset}
                        onChange={(value) => {
                          const schedule = value === 'custom' ? scheduleValue : value;
                          if (value !== 'custom') {
                            form.setFieldsValue({ schedule });
                            setScheduleValue(schedule);
                          }
                          setSelectedPreset(value);
                        }}
                        options={[
                          { label: '常用预设', options: CRON_PRESETS },
                          { label: '宏表达式', options: MACRO_PRESETS },
                          { label: '自定义', value: 'custom' },
                        ]}
                      />
                    }
                  />
                </Form.Item>
                <CronExpressionHelper expression={scheduleValue} />
              </Col>
            </Row>
            <CronExpressionHelp />
            <Divider />
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item
                  name="concurrencyPolicy"
                  label={
                    <Tooltip title="当新的任务执行时间到达时，如果前一个任务还未完成的处理策略">
                      并发策略 <InfoCircleOutlined />
                    </Tooltip>
                  }
                >
                  <Select options={CONCURRENCY_POLICY_OPTIONS} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="successfulJobsHistoryLimit"
                  label={
                    <Tooltip title="保留的成功任务历史数量">
                      成功历史限制 <InfoCircleOutlined />
                    </Tooltip>
                  }
                >
                  <InputNumber min={0} max={100} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="failedJobsHistoryLimit"
                  label={
                    <Tooltip title="保留的失败任务历史数量">
                      失败历史限制 <InfoCircleOutlined />
                    </Tooltip>
                  }
                >
                  <InputNumber min={0} max={100} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Alert
              message="并发策略说明"
              description={
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li><strong>Allow</strong>：允许并发执行多个任务</li>
                  <li><strong>Forbid</strong>：禁止并发，如果前一个任务未完成则跳过新任务</li>
                  <li><strong>Replace</strong>：取消当前正在运行的任务，执行新任务</li>
                </ul>
              }
              type="info"
              showIcon
            />
          </Card>
        );

      case 2:
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
              <Col span={12}>
                <Form.Item name="imagePullSecrets" label="镜像拉取凭证">
                  <Select
                    mode="multiple"
                    allowClear
                    options={imagePullSecrets.map((s) => ({
                      label: s.metadata.name,
                      value: s.metadata.name,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Divider />
            <Form.Item name="command" label="启动命令" extra="每行一个命令参数">
              <Input.TextArea rows={3} placeholder="echo&#10;hello" />
            </Form.Item>
            <Form.Item name="args" label="启动参数" extra="每行一个参数">
              <Input.TextArea rows={3} placeholder="--arg1&#10;--arg2" />
            </Form.Item>
            <Divider />
            <EnvEditor />
            <Divider />
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name={['resources', 'requests', 'cpu']} label="CPU 请求">
                  <Input placeholder="100m (0.1 核)" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name={['resources', 'requests', 'memory']} label="内存请求">
                  <Input placeholder="128Mi" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name={['resources', 'limits', 'cpu']} label="CPU 限制">
                  <Input placeholder="500m (0.5 核)" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name={['resources', 'limits', 'memory']} label="内存限制">
                  <Input placeholder="512Mi" />
                </Form.Item>
              </Col>
            </Row>
            <Divider />
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="restartPolicy" label="重启策略">
                  <Select options={RESTART_POLICY_OPTIONS} />
                </Form.Item>
              </Col>
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
                    <Tooltip title="每次执行的最长运行时间（秒），0 表示不限制">
                      超时时间（秒） <InfoCircleOutlined />
                    </Tooltip>
                  }
                >
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
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
            description="直接编辑 CronJob 的 YAML 定义。编辑完成后点击创建按钮提交。"
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
kind: CronJob
metadata:
  name: my-cronjob
  namespace: default
spec:
  schedule: "0 2 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
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
        onRegistryChange={setBrowserCredential}
        currentImage={form.getFieldValue('image')}
        onClose={() => setRegistryBrowserVisible(false)}
        onSelectImage={handleSelectImage}
      />
    </div>
  );
};

export default CronJobForm;
