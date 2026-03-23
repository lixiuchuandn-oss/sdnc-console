/**
 * ==============================================================================
 * 模块名称: 工作负载创建表单 (WorkloadForm)
 * 文件路径: src/pages/Clouds/Harvester/containers/components/WorkloadForm.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 分步骤表单组件，用于创建 Kubernetes 工作负载资源：
 * - Deployment
 * - StatefulSet
 * - DaemonSet
 * 
 * [模式支持]
 * - 表单模式: 分步骤引导填写
 * - YAML 模式: 直接编辑 YAML 定义
 * 
 * [步骤设计]
 * 步骤1: 基本信息 - 名称、命名空间、类型、标签
 * 步骤2: 容器配置 - 镜像、端口、环境变量、资源限制
 * 步骤3: 高级配置 - 副本数、存储、调度、健康检查
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
  Tag,
  Divider,
  Row,
  Col,
  Switch,
  App,
  Segmented,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  InfoCircleOutlined,
  CodeOutlined,
  FormOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import yaml from 'js-yaml';
import { createHarvesterContainerResource, updateHarvesterContainerResource } from '../../../../../services/harvesterApi';
import LinedTextArea from '../../../../../components/LinedTextArea';
import YamlEditor from '../../../../../components/YamlEditor';
import { RegistryBrowserDrawer } from './index';

// ============================================================
// 类型定义
// ============================================================

export type WorkloadType = 'deployment' | 'statefulset' | 'daemonset';

export interface WorkloadFormValues {
  // 基本信息
  name: string;
  namespace: string;
  workloadType: WorkloadType;
  labels: Array<{ key: string; value: string }>;
  
  // 容器配置
  containerName: string;
  image: string;
  imagePullPolicy: 'Always' | 'IfNotPresent' | 'Never';
  ports: Array<{ containerPort: number; protocol: 'TCP' | 'UDP'; name?: string }>;
  env: Array<{ name: string; value: string }>;
  resources: {
    requests: { cpu?: string; memory?: string };
    limits: { cpu?: string; memory?: string };
  };
  command?: string[];
  args?: string[];
  
  // 高级配置
  replicas: number;
  imagePullSecrets: string[];
  nodeSelector: Array<{ key: string; value: string }>;
  
  // 健康检查
  livenessProbe?: {
    enabled: boolean;
    type: 'httpGet' | 'tcpSocket' | 'exec';
    httpGet?: { path: string; port: number };
    tcpSocket?: { port: number };
    exec?: { command: string[] };
    initialDelaySeconds: number;
    periodSeconds: number;
  };
  readinessProbe?: {
    enabled: boolean;
    type: 'httpGet' | 'tcpSocket' | 'exec';
    httpGet?: { path: string; port: number };
    tcpSocket?: { port: number };
    exec?: { command: string[] };
    initialDelaySeconds: number;
    periodSeconds: number;
  };
}

export interface WorkloadFormProps {
  cloudId: string;
  namespacesOptions: string[];
  imagePullSecrets: Array<{ metadata: { name: string; namespace: string } }>;
  secretsWithCredentials?: any[];  // 包含完整凭证信息的 Secret 列表（用于仓库浏览）
  onSuccess: () => void;
  onCancel: () => void;
  defaultNamespace?: string;
  defaultType?: WorkloadType;
  editData?: any; // 编辑模式：传入现有的 workload 数据
}

// ============================================================
// 常量定义
// ============================================================

const WORKLOAD_TYPE_OPTIONS = [
  { value: 'deployment', label: 'Deployment', desc: '无状态应用，支持弹性伸缩' },
  { value: 'statefulset', label: 'StatefulSet', desc: '有状态应用，稳定网络标识' },
  { value: 'daemonset', label: 'DaemonSet', desc: '守护进程，每个节点运行' },
];

const IMAGE_PULL_POLICY_OPTIONS = [
  { value: 'IfNotPresent', label: 'IfNotPresent (本地优先)' },
  { value: 'Always', label: 'Always (始终拉取)' },
  { value: 'Never', label: 'Never (从不拉取)' },
];

const PROTOCOL_OPTIONS = [
  { value: 'TCP', label: 'TCP' },
  { value: 'UDP', label: 'UDP' },
];

const PROBE_TYPE_OPTIONS = [
  { value: 'httpGet', label: 'HTTP 请求' },
  { value: 'tcpSocket', label: 'TCP 端口' },
  { value: 'exec', label: '执行命令' },
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
// 子组件: 端口配置
// ============================================================

const PortsEditor: React.FC = () => (
  <Form.List name="ports">
    {(fields, { add, remove }) => (
      <div>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <span style={{ fontWeight: 500 }}>端口配置</span>
            <Button type="dashed" size="small" onClick={() => add({ protocol: 'TCP' })} icon={<PlusOutlined />}>
              添加端口
            </Button>
          </Space>
        </div>
        {fields.map(({ key, name: index, ...restField }) => (
          <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
            <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'name']}
              >
                <Input placeholder="端口名称" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'containerPort']}
                rules={[{ required: true, message: '端口必填' }]}
              >
                <InputNumber placeholder="容器端口" min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                {...restField}
                name={[index, 'protocol']}
                initialValue="TCP"
              >
                <Select options={PROTOCOL_OPTIONS} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <MinusCircleOutlined onClick={() => remove(index)} style={{ marginTop: 8 }} />
            </Col>
          </Row>
        ))}
      </div>
    )}
  </Form.List>
);

// ============================================================
// 子组件: 环境变量
// ============================================================

const EnvEditor: React.FC = () => (
  <Form.List name="env">
    {(fields, { add, remove }) => (
      <div>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <span style={{ fontWeight: 500 }}>环境变量</span>
            <Button type="dashed" size="small" onClick={() => add()} icon={<PlusOutlined />}>
              添加变量
            </Button>
          </Space>
        </div>
        {fields.map(({ key, name: index, ...restField }) => (
          <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
            <Col span={10}>
              <Form.Item
                {...restField}
                name={[index, 'name']}
                rules={[{ required: true, message: '变量名必填' }]}
              >
                <Input placeholder="变量名 (如: ENV_KEY)" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                {...restField}
                name={[index, 'value']}
                rules={[{ required: true, message: '变量值必填' }]}
              >
                <Input placeholder="变量值" />
              </Form.Item>
            </Col>
            <Col span={2}>
              <MinusCircleOutlined onClick={() => remove(index)} style={{ marginTop: 8 }} />
            </Col>
          </Row>
        ))}
      </div>
    )}
  </Form.List>
);

// ============================================================
// 子组件: 健康检查配置
// ============================================================

const ProbeEditor: React.FC<{
  name: 'livenessProbe' | 'readinessProbe';
  label: string;
}> = ({ name, label }) => {
  const form = Form.useFormInstance();
  const probeType = Form.useWatch([name, 'type'], form);
  
  return (
    <Card size="small" title={label} style={{ marginBottom: 16 }}>
      <Form.Item name={[name, 'enabled']} label="启用" valuePropName="checked">
        <Switch />
      </Form.Item>
      
      <Form.Item noStyle shouldUpdate>
        {({ getFieldValue }) => {
          const enabled = getFieldValue([name, 'enabled']);
          if (!enabled) return null;
          
          return (
            <>
              <Form.Item name={[name, 'type']} label="检查方式">
                <Select options={PROBE_TYPE_OPTIONS} style={{ width: 150 }} />
              </Form.Item>
              
              {probeType === 'httpGet' && (
                <Row gutter={8}>
                  <Col span={12}>
                    <Form.Item name={[name, 'httpGet', 'path']} label="HTTP 路径">
                      <Input placeholder="/health" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name={[name, 'httpGet', 'port']} label="端口">
                      <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              )}
              
              {probeType === 'tcpSocket' && (
                <Form.Item name={[name, 'tcpSocket', 'port']} label="TCP 端口">
                  <InputNumber min={1} max={65535} style={{ width: 200 }} />
                </Form.Item>
              )}
              
              {probeType === 'exec' && (
                <Form.Item name={[name, 'exec', 'command']} label="执行命令">
                  <Select
                    mode="tags"
                    placeholder="输入命令后按回车添加"
                    style={{ width: '100%' }}
                    tokenSeparators={[' ']}
                  />
                </Form.Item>
              )}
              
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item 
                    name={[name, 'initialDelaySeconds']} 
                    label="初始延迟(秒)"
                    initialValue={30}
                  >
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item 
                    name={[name, 'periodSeconds']} 
                    label="检查间隔(秒)"
                    initialValue={10}
                  >
                    <InputNumber min={1} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            </>
          );
        }}
      </Form.Item>
    </Card>
  );
};

// ============================================================
// 主组件
// ============================================================

// ============================================================
// 默认 YAML 模板
// ============================================================

const DEFAULT_DEPLOYMENT_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: default
  labels:
    app: my-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 80
              protocol: TCP
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
`;

const DEFAULT_STATEFULSET_YAML = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-app
  namespace: default
  labels:
    app: my-app
spec:
  replicas: 1
  serviceName: my-app
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 80
              protocol: TCP
`;

const DEFAULT_DAEMONSET_YAML = `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: my-app
  namespace: default
  labels:
    app: my-app
spec:
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 80
              protocol: TCP
`;

// ============================================================
// 主组件
// ============================================================

const WorkloadForm: React.FC<WorkloadFormProps> = ({
  cloudId,
  namespacesOptions,
  imagePullSecrets,
  secretsWithCredentials,
  onSuccess,
  onCancel,
  defaultNamespace,
  defaultType = 'deployment',
  editData,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const isEditMode = !!editData;
  
  // YAML 模式状态
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const [yamlContent, setYamlContent] = useState<string>(DEFAULT_DEPLOYMENT_YAML);
  const [yamlError, setYamlError] = useState<string>('');
  
  // 仓库浏览器状态
  const [browserVisible, setBrowserVisible] = useState(false);
  const [browserCredential, setBrowserCredential] = useState<any>(null);

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
   * 只处理 kubernetes.io/dockerconfigjson 类型的 Secret
   */
  const secretToCredential = useCallback((secret: any) => {
    if (!secret) return null;

    try {
      // 只处理 docker-registry 类型的 Secret
      const secretType = secret?.type || secret?.metadata?.annotations?.['kubernetes.io/service-account.name'];
      const isDockerConfig = secretType === 'kubernetes.io/dockerconfigjson' || 
                            secret?.data?.['.dockerconfigjson'];
      
      if (!isDockerConfig) {
        // 非 docker-registry 类型的 Secret，静默跳过
        return null;
      }

      const data = secret?.data?.['.dockerconfigjson'];
      if (!data) {
        // 有类型但缺少数据字段，静默跳过
        return null;
      }

      const decoded = atob(data);
      const config = JSON.parse(decoded);
      const auths = config.auths || {};
      const server = Object.keys(auths)[0];

      if (!server) {
        // 未找到仓库地址，静默跳过
        return null;
      }

      const auth = auths[server];
      let username: string | undefined;
      let password: string | undefined;

      // 尝试从 auth 字段解码（base64 编码的 username:password）
      if (auth?.auth) {
        try {
          const decodedAuth = atob(auth.auth);
          const [u, p] = decodedAuth.split(':');
          username = u;
          password = p;
        } catch {
          // 解码失败，尝试直接获取
          username = auth?.username;
          password = auth?.password;
        }
      } else {
        // 如果没有 auth 字段，尝试直接从 username/password 获取
        username = auth?.username;
        password = auth?.password;
      }

      // 即使没有用户名密码，也可以返回 credential（无认证仓库）
      return {
        name: secret?.metadata?.name,
        namespace: secret?.metadata?.namespace,
        server,
        username: username || undefined,
        password: password || undefined,
        insecure: server.includes('172.16.3.79') || !server.startsWith('https://'),
      };
    } catch {
      // 解析失败，静默跳过
      return null;
    }
  }, []);

  /**
   * 将仓库转换为 RegistryBrowser 需要的 credential 格式
   */
  const registryToCredential = useCallback((registry: any) => {
    if (!registry) return null;

    return {
      name: registry.name,
      namespace: 'default',
      server: registry.server,
      username: registry.username,
      password: registry.password,
      insecure: registry.insecure,
    };
  }, []);

  /**
   * 合并 Secrets 和 localStorage 仓库列表
   */
  const allRegistries = useMemo(() => {
    const registries: any[] = [];

    // 添加 localStorage 仓库列表
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

    // 添加 Kubernetes Secrets
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

  // 编辑模式：初始化表单数据
  useEffect(() => {
    if (editData) {
      const spec = editData?.spec || {};
      const metadata = editData?.metadata || {};
      const template = spec?.template || {};
      const container = template?.spec?.containers?.[0] || {};
      
      // 提取标签
      const labels = Object.entries(metadata?.labels || {}).map(([key, value]) => ({ key, value }));
      
      // 提取端口
      const ports = (container?.ports || []).map((p: any) => ({
        containerPort: p.containerPort,
        protocol: p.protocol || 'TCP',
        name: p.name,
      }));
      
      // 提取环境变量
      const env = (container?.env || []).map((e: any) => ({
        name: e.name,
        value: e.value,
      }));
      
      // 提取资源限制
      const resources = {
        requests: {
          cpu: container?.resources?.requests?.cpu,
          memory: container?.resources?.requests?.memory,
        },
        limits: {
          cpu: container?.resources?.limits?.cpu,
          memory: container?.resources?.limits?.memory,
        },
      };
      
      // 提取镜像拉取密钥
      const imagePullSecrets = (template?.spec?.imagePullSecrets || []).map((s: any) => s.name);
      
      // 提取节点选择器
      const nodeSelector = Object.entries(spec?.template?.spec?.nodeSelector || {}).map(([key, value]) => ({ key, value }));
      
      // 提取健康检查
      const parseProbe = (probe: any) => {
        if (!probe) return undefined;
        return {
          enabled: true,
          type: probe.httpGet ? 'httpGet' : probe.tcpSocket ? 'tcpSocket' : 'exec',
          httpGet: probe.httpGet ? { path: probe.httpGet.path, port: probe.httpGet.port } : undefined,
          tcpSocket: probe.tcpSocket ? { port: probe.tcpSocket.port } : undefined,
          exec: probe.exec ? { command: probe.exec.command } : undefined,
          initialDelaySeconds: probe.initialDelaySeconds || 0,
          periodSeconds: probe.periodSeconds || 10,
        };
      };
      
      // 设置表单值
      form.setFieldsValue({
        workloadType: editData?.kind?.toLowerCase() || defaultType,
        name: metadata?.name || '',
        namespace: metadata?.namespace || 'default',
        labels,
        image: container?.image || '',
        containerName: container?.name || '',
        imagePullPolicy: container?.imagePullPolicy || 'IfNotPresent',
        ports,
        env,
        resources,
        command: container?.command,
        args: container?.args,
        replicas: spec?.replicas || 1,
        imagePullSecrets,
        nodeSelector,
        livenessProbe: parseProbe(container?.livenessProbe),
        readinessProbe: parseProbe(container?.readinessProbe),
      });
      
      // 设置 YAML 内容（过滤掉 managedFields，避免干扰用户编辑）
      const cleanData = {
        ...editData,
        metadata: {
          ...editData.metadata,
          managedFields: undefined, // 不展示内部管理字段
        },
      };
      const yamlStr = yaml.dump(cleanData, { indent: 2 });
      setYamlContent(yamlStr);
    }
  }, [editData, defaultType, form]);
  
  // 监听工作负载类型变化
  const workloadType = Form.useWatch('workloadType', form) || defaultType;
  
  // 获取 API 路径
  const getApiPath = useCallback((type: WorkloadType): string => {
    switch (type) {
      case 'deployment':
        return '/apis/apps/v1/deployments';
      case 'statefulset':
        return '/apis/apps/v1/statefulsets';
      case 'daemonset':
        return '/apis/apps/v1/daemonsets';
      default:
        return '/apis/apps/v1/deployments';
    }
  }, []);
  
  // 根据工作负载类型获取默认 YAML
  const getDefaultYaml = useCallback((type: WorkloadType): string => {
    switch (type) {
      case 'deployment':
        return DEFAULT_DEPLOYMENT_YAML;
      case 'statefulset':
        return DEFAULT_STATEFULSET_YAML;
      case 'daemonset':
        return DEFAULT_DAEMONSET_YAML;
      default:
        return DEFAULT_DEPLOYMENT_YAML;
    }
  }, []);
  
  // 构建 Kubernetes 资源定义
  const buildK8sResource = useCallback((values: WorkloadFormValues): any => {
    const {
      name,
      namespace,
      workloadType,
      labels,
      containerName,
      image,
      imagePullPolicy,
      ports,
      env,
      resources,
      command,
      args,
      replicas,
      imagePullSecrets: pullSecrets,
      nodeSelector,
      livenessProbe,
      readinessProbe,
    } = values;
    
    // 构建标签
    const labelsMap: Record<string, string> = { app: name };
    (labels || []).forEach((item) => {
      if (item.key && item.value) {
        labelsMap[item.key] = item.value;
      }
    });
    
    // 构建环境变量
    const envList = (env || []).map((item) => ({
      name: item.name,
      value: item.value,
    }));
    
    // 构建端口
    const portsList = (ports || []).map((item) => ({
      name: item.name || `port-${item.containerPort}`,
      containerPort: item.containerPort,
      protocol: item.protocol,
    }));
    
    // 构建资源限制
    const resourceRequirements: any = {};
    if (resources?.requests?.cpu || resources?.requests?.memory) {
      resourceRequirements.requests = {};
      if (resources.requests.cpu) resourceRequirements.requests.cpu = resources.requests.cpu;
      if (resources.requests.memory) resourceRequirements.requests.memory = resources.requests.memory;
    }
    if (resources?.limits?.cpu || resources?.limits?.memory) {
      resourceRequirements.limits = {};
      if (resources.limits.cpu) resourceRequirements.limits.cpu = resources.limits.cpu;
      if (resources.limits.memory) resourceRequirements.limits.memory = resources.limits.memory;
    }
    
    // 构建探针
    const buildProbe = (probe?: WorkloadFormValues['livenessProbe']) => {
      if (!probe?.enabled) return undefined;
      
      let probeConfig: any = {
        initialDelaySeconds: probe.initialDelaySeconds || 30,
        periodSeconds: probe.periodSeconds || 10,
      };
      
      if (probe.type === 'httpGet' && probe.httpGet) {
        probeConfig.httpGet = {
          path: probe.httpGet.path || '/health',
          port: probe.httpGet.port,
        };
      } else if (probe.type === 'tcpSocket' && probe.tcpSocket) {
        probeConfig.tcpSocket = {
          port: probe.tcpSocket.port,
        };
      } else if (probe.type === 'exec' && probe.exec?.command) {
        probeConfig.exec = {
          command: probe.exec.command,
        };
      }
      
      return probeConfig;
    };
    
    // 构建容器定义
    const container: any = {
      name: containerName || name,
      image,
      imagePullPolicy,
      ports: portsList.length > 0 ? portsList : undefined,
      env: envList.length > 0 ? envList : undefined,
      resources: Object.keys(resourceRequirements).length > 0 ? resourceRequirements : undefined,
      command: command?.length ? command : undefined,
      args: args?.length ? args : undefined,
      livenessProbe: buildProbe(livenessProbe),
      readinessProbe: buildProbe(readinessProbe),
    };
    
    // 构建节点选择器
    const nodeSelectorMap: Record<string, string> = {};
    (nodeSelector || []).forEach((item) => {
      if (item.key && item.value) {
        nodeSelectorMap[item.key] = item.value;
      }
    });
    
    // 构建镜像拉取凭证
    const imagePullSecretsList = (pullSecrets || []).map((secretName) => ({
      name: secretName,
    }));
    
    // 构建完整资源
    const resource: any = {
      apiVersion: 'apps/v1',
      kind: workloadType === 'deployment' ? 'Deployment' 
          : workloadType === 'statefulset' ? 'StatefulSet' 
          : 'DaemonSet',
      metadata: {
        name,
        namespace,
        labels: labelsMap,
      },
      spec: {
        selector: {
          matchLabels: { app: name },
        },
        template: {
          metadata: {
            labels: labelsMap,
          },
          spec: {
            containers: [container],
            imagePullSecrets: imagePullSecretsList.length > 0 ? imagePullSecretsList : undefined,
            nodeSelector: Object.keys(nodeSelectorMap).length > 0 ? nodeSelectorMap : undefined,
          },
        },
      },
    };
    
    // 根据类型添加特定配置
    if (workloadType !== 'daemonset') {
      resource.spec.replicas = replicas || 1;
    }
    
    return resource;
  }, []);
  
  // 表单数据转 YAML
  const formToYaml = useCallback((values: WorkloadFormValues): string => {
    const resource = buildK8sResource(values);
    return yaml.dump(resource, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });
  }, [buildK8sResource]);
  
  // YAML 转表单数据
  const yamlToForm = useCallback((yamlStr: string): WorkloadFormValues | null => {
    try {
      const resource = yaml.load(yamlStr) as any;
      if (!resource) return null;
      
      // 提取基本信息
      const name = resource.metadata?.name || '';
      const namespace = resource.metadata?.namespace || 'default';
      const labels = resource.metadata?.labels || {};
      const kind = resource.kind?.toLowerCase();
      const workloadType = kind === 'statefulset' ? 'statefulset' 
                        : kind === 'daemonset' ? 'daemonset' 
                        : 'deployment';
      
      // 提取容器配置
      const container = resource.spec?.template?.spec?.containers?.[0] || {};
      const ports = (container.ports || []).map((p: any) => ({
        name: p.name,
        containerPort: p.containerPort,
        protocol: p.protocol || 'TCP',
      }));
      const env = (container.env || []).map((e: any) => ({
        name: e.name,
        value: e.value || '',
      }));
      
      // 提取高级配置
      const replicas = resource.spec?.replicas || 1;
      const nodeSelector = resource.spec?.template?.spec?.nodeSelector || {};
      const imagePullSecrets = (resource.spec?.template?.spec?.imagePullSecrets || []).map((s: any) => s.name);
      
      return {
        name,
        namespace,
        workloadType,
        labels: Object.entries(labels).filter(([k]) => k !== 'app').map(([key, value]) => ({ key, value: String(value) })),
        containerName: container.name || name,
        image: container.image || '',
        imagePullPolicy: container.imagePullPolicy || 'IfNotPresent',
        ports,
        env,
        resources: {
          requests: container.resources?.requests || {},
          limits: container.resources?.limits || {},
        },
        command: container.command,
        args: container.args,
        replicas,
        imagePullSecrets,
        nodeSelector: Object.entries(nodeSelector).map(([key, value]) => ({ key, value: String(value) })),
        livenessProbe: container.livenessProbe ? {
          enabled: true,
          type: container.livenessProbe.httpGet ? 'httpGet' : 
                container.livenessProbe.tcpSocket ? 'tcpSocket' : 'exec',
          httpGet: container.livenessProbe.httpGet,
          tcpSocket: container.livenessProbe.tcpSocket,
          exec: container.livenessProbe.exec,
          initialDelaySeconds: container.livenessProbe.initialDelaySeconds || 30,
          periodSeconds: container.livenessProbe.periodSeconds || 10,
        } : { enabled: false, type: 'httpGet', initialDelaySeconds: 30, periodSeconds: 10 },
        readinessProbe: container.readinessProbe ? {
          enabled: true,
          type: container.readinessProbe.httpGet ? 'httpGet' : 
                container.readinessProbe.tcpSocket ? 'tcpSocket' : 'exec',
          httpGet: container.readinessProbe.httpGet,
          tcpSocket: container.readinessProbe.tcpSocket,
          exec: container.readinessProbe.exec,
          initialDelaySeconds: container.readinessProbe.initialDelaySeconds || 5,
          periodSeconds: container.readinessProbe.periodSeconds || 10,
        } : { enabled: false, type: 'httpGet', initialDelaySeconds: 5, periodSeconds: 10 },
      };
    } catch (e) {
      console.error('YAML 解析失败:', e);
      return null;
    }
  }, []);
  
  // 切换到 YAML 模式时，将表单数据转换为 YAML
  const handleModeChange = useCallback((newMode: 'form' | 'yaml') => {
    if (newMode === 'yaml' && mode === 'form') {
      // 表单 → YAML
      try {
        const currentFormValues = form.getFieldsValue();
        
        if (isEditMode && editData) {
          // 编辑模式：合并当前表单值和 editData 中的原始值
          // 从 editData 提取完整表单值作为基础
          const spec = editData?.spec || {};
          const metadata = editData?.metadata || {};
          const template = spec?.template || {};
          const container = template?.spec?.containers?.[0] || {};
          
          const baseValues: WorkloadFormValues = {
            name: metadata.name || '',
            namespace: metadata.namespace || 'default',
            workloadType: (editData?.kind?.toLowerCase() || defaultType) as WorkloadType,
            labels: Object.entries(metadata?.labels || {})
              .filter(([k]) => k !== 'app')
              .map(([key, value]) => ({ key, value: String(value) })),
            containerName: container.name || metadata.name || '',
            image: container.image || '',
            imagePullPolicy: container.imagePullPolicy || 'IfNotPresent',
            ports: (container.ports || []).map((p: any) => ({
              name: p.name,
              containerPort: p.containerPort,
              protocol: p.protocol || 'TCP',
            })),
            env: (container.env || []).map((e: any) => ({
              name: e.name,
              value: e.value || '',
            })),
            resources: {
              requests: container.resources?.requests || {},
              limits: container.resources?.limits || {},
            },
            command: container.command,
            args: container.args,
            replicas: spec.replicas || 1,
            imagePullSecrets: (template.spec?.imagePullSecrets || []).map((s: any) => s.name),
            nodeSelector: Object.entries(spec.template?.spec?.nodeSelector || {}).map(([key, value]) => ({
              key,
              value: String(value),
            })),
            livenessProbe: container.livenessProbe ? {
              enabled: true,
              type: container.livenessProbe.httpGet ? 'httpGet' :
                    container.livenessProbe.tcpSocket ? 'tcpSocket' : 'exec',
              httpGet: container.livenessProbe.httpGet,
              tcpSocket: container.livenessProbe.tcpSocket,
              exec: container.livenessProbe.exec,
              initialDelaySeconds: container.livenessProbe.initialDelaySeconds || 30,
              periodSeconds: container.livenessProbe.periodSeconds || 10,
            } : { enabled: false, type: 'httpGet', initialDelaySeconds: 30, periodSeconds: 10 },
            readinessProbe: container.readinessProbe ? {
              enabled: true,
              type: container.readinessProbe.httpGet ? 'httpGet' :
                    container.readinessProbe.tcpSocket ? 'tcpSocket' : 'exec',
              httpGet: container.readinessProbe.httpGet,
              tcpSocket: container.readinessProbe.tcpSocket,
              exec: container.readinessProbe.exec,
              initialDelaySeconds: container.readinessProbe.initialDelaySeconds || 5,
              periodSeconds: container.readinessProbe.periodSeconds || 10,
            } : { enabled: false, type: 'httpGet', initialDelaySeconds: 5, periodSeconds: 10 },
          };
          
          // 合并：当前表单值覆盖 baseValues（只覆盖有值的字段）
          const mergedValues = { ...baseValues };
          Object.keys(currentFormValues).forEach((key) => {
            const value = currentFormValues[key];
            if (value !== undefined && value !== '' && 
                !(Array.isArray(value) && value.length === 0)) {
              (mergedValues as any)[key] = value;
            }
          });
          
          // 构建完整的 K8s 资源
          const k8sResource = buildK8sResource(mergedValues);
          // 保留原始 metadata 字段
          k8sResource.metadata = {
            ...editData.metadata,
            name: mergedValues.name,
            namespace: mergedValues.namespace,
            labels: {
              ...editData.metadata?.labels,
              ...(mergedValues.labels || []).reduce((acc: any, l: any) => {
                if (l.key) acc[l.key] = l.value;
                return acc;
              }, {}),
            },
          };
          
          const yamlStr = yaml.dump(k8sResource, { indent: 2, lineWidth: -1, noRefs: true });
          setYamlContent(yamlStr);
        } else {
          // 创建模式：将当前表单数据转换为 YAML
          const yamlStr = formToYaml(currentFormValues as WorkloadFormValues);
          setYamlContent(yamlStr);
        }
        setYamlError('');
      } catch (e: any) {
        message.warning('数据转换失败，将使用默认模板');
        setYamlContent(getDefaultYaml(workloadType));
      }
    } else if (newMode === 'form' && mode === 'yaml') {
      // YAML → 表单：尝试解析 YAML 并填充表单
      try {
        const values = yamlToForm(yamlContent);
        if (values) {
          form.setFieldsValue(values);
          setYamlError('');
        }
      } catch (e: any) {
        message.warning('YAML 解析失败，请检查格式');
      }
    }
    setMode(newMode);
  }, [mode, form, formToYaml, yamlToForm, yamlContent, message, getDefaultYaml, workloadType, isEditMode, editData, buildK8sResource, defaultType]);
  
  // 验证 YAML 格式
  const validateYaml = useCallback((content: string): boolean => {
    try {
      yaml.load(content);
      setYamlError('');
      return true;
    } catch (e: any) {
      setYamlError(`YAML 格式错误: ${e.message}`);
      return false;
    }
  }, []);
  
  // YAML 内容变化处理
  const handleYamlChange = useCallback((value: string) => {
    setYamlContent(value);
    validateYaml(value);
  }, [validateYaml]);
  
  // 提交表单
  const handleSubmit = useCallback(async () => {
    try {
      let resource: any;
      let apiPath: string;
      let namespace: string;
      let name: string;
      
      if (mode === 'yaml') {
        // YAML 模式提交
        if (!validateYaml(yamlContent)) {
          message.error('请修正 YAML 格式错误');
          return;
        }
        
        resource = yaml.load(yamlContent) as any;
        const kind = resource?.kind?.toLowerCase();
        apiPath = getApiPath(
          kind === 'statefulset' ? 'statefulset' :
          kind === 'daemonset' ? 'daemonset' : 'deployment'
        );
        namespace = resource?.metadata?.namespace || 'default';
        name = resource?.metadata?.name || '';
        
        // 编辑模式下，确保保留原有元数据
        if (isEditMode && editData?.metadata) {
          resource.metadata = {
            ...resource.metadata,
            uid: editData.metadata.uid,
            resourceVersion: editData.metadata.resourceVersion,
            creationTimestamp: editData.metadata.creationTimestamp,
            managedFields: editData.metadata.managedFields,
          };
        }
      } else {
        // 表单模式提交 - 显式验证所有字段（分步骤表单需要）
        const values = await form.validateFields([
          'workloadType', 'name', 'namespace', 'labels',
          'image', 'containerName', 'imagePullPolicy',
          'ports', 'env', 'resources', 'command', 'args',
          'replicas', 'imagePullSecrets', 'nodeSelector',
          'livenessProbe', 'readinessProbe'
        ]);
        
        resource = buildK8sResource(values);
        apiPath = getApiPath(values.workloadType);
        namespace = values.namespace;
        name = values.name;
        
        // 编辑模式下，保留原有元数据
        if (isEditMode && editData?.metadata) {
          resource.metadata.uid = editData.metadata.uid;
          resource.metadata.resourceVersion = editData.metadata.resourceVersion;
          resource.metadata.creationTimestamp = editData.metadata.creationTimestamp;
          resource.metadata.managedFields = editData.metadata.managedFields;
          // 保留原有 annotations
          if (editData.metadata.annotations) {
            resource.metadata.annotations = editData.metadata.annotations;
          }
        }
      }
      
      setLoading(true);
      
      if (isEditMode) {
        // 编辑模式：调用更新 API
        await updateHarvesterContainerResource(cloudId, apiPath, namespace, name, resource);
        message.success('工作负载更新成功');
      } else {
        // 创建模式：调用创建 API
        await createHarvesterContainerResource(cloudId, apiPath, namespace, resource);
        message.success('工作负载创建成功');
      }
      
      onSuccess();
    } catch (error: any) {
      console.error(isEditMode ? '更新工作负载失败:' : '创建工作负载失败:', error);
      message.error(error?.message || (isEditMode ? '更新工作负载失败' : '创建工作负载失败'));
    } finally {
      setLoading(false);
    }
  }, [mode, yamlContent, validateYaml, form, buildK8sResource, getApiPath, cloudId, message, onSuccess, isEditMode]);
  
  // 下一步
  const handleNext = useCallback(async () => {
    try {
      await form.validateFields();
      setCurrentStep((prev) => prev + 1);
    } catch {
      // 验证失败，不跳转
    }
  }, [form]);
  
  // 上一步
  const handlePrev = useCallback(() => {
    setCurrentStep((prev) => prev - 1);
  }, []);
  
  // 步骤配置
  const steps = [
    { title: '基本信息', description: '名称、命名空间、类型' },
    { title: '容器配置', description: '镜像、端口、资源' },
    { title: '高级配置', description: '副本、存储、调度' },
  ];
  
  // 渲染步骤内容
  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div>
            <Form.Item
              name="workloadType"
              label="工作负载类型"
              rules={[{ required: true, message: '请选择工作负载类型' }]}
              initialValue={defaultType}
            >
              <Select
                disabled={isEditMode}
                options={WORKLOAD_TYPE_OPTIONS}
                optionRender={(option) => (
                  <div>
                    <div style={{ fontWeight: 500 }}>{option.label}</div>
                    <div style={{ fontSize: 12, color: '#999' }}>
                      {WORKLOAD_TYPE_OPTIONS.find(o => o.value === option.value)?.desc}
                    </div>
                  </div>
                )}
              />
            </Form.Item>
            
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="name"
                  label="名称"
                  rules={[
                    { required: true, message: '请输入名称' },
                    { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '只允许小写字母、数字和中划线' },
                    { max: 63, message: '名称不能超过63个字符' },
                  ]}
                >
                  <Input placeholder="例如: my-app" disabled={isEditMode} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="namespace"
                  label="命名空间"
                  rules={[{ required: true, message: '请选择命名空间' }]}
                  initialValue={defaultNamespace}
                >
                  <Select
                    showSearch
                    disabled={isEditMode}
                    optionFilterProp="label"
                    placeholder="选择命名空间"
                    options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            
            <LabelEditor name="labels" label="标签" />
          </div>
        );
        
      case 1:
        return (
          <div>
            <Form.Item
              name="image"
              label="镜像地址"
              rules={[{ required: true, message: '请输入镜像地址' }]}
              extra={<span style={{ color: '#999' }}>例如: nginx:latest 或 harbor.example.com/library/nginx:v1.0</span>}
            >
              <Input
                placeholder="镜像地址"
                addonAfter={
                  <Button
                    type="text"
                    size="small"
                    icon={<FolderOutlined />}
                    onClick={() => {
                      if (allRegistries.length > 0) {
                        // 尝试根据当前镜像地址智能选择仓库
                        const currentImage = form.getFieldValue('image');
                        let targetCredential = registryToCredential(allRegistries[0]);

                        if (currentImage) {
                          // 从镜像地址中提取服务器地址
                          const serverMatch = currentImage.match(/^([^/]+):?\d*\//);
                          if (serverMatch) {
                            const serverFromImage = serverMatch[1];
                            // 查找匹配的仓库
                            const matchingRegistry = allRegistries.find(r => r.server === serverFromImage);
                            if (matchingRegistry) {
                              targetCredential = registryToCredential(matchingRegistry);
                            }
                          }
                        }

                        if (targetCredential) {
                          setBrowserCredential(targetCredential);
                          setBrowserVisible(true);
                        } else {
                          message.error('解析镜像凭证失败，请检查凭证配置');
                        }
                      } else {
                        message.warning('请先在镜像仓库中添加仓库或创建凭证');
                      }
                    }}
                  >
                    浏览仓库
                  </Button>
                }
              />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="containerName"
                  label="容器名称"
                  extra="默认与工作负载名称相同"
                >
                  <Input placeholder="容器名称 (可选)" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="imagePullPolicy"
                  label="镜像拉取策略"
                  initialValue="IfNotPresent"
                >
                  <Select options={IMAGE_PULL_POLICY_OPTIONS} />
                </Form.Item>
              </Col>
            </Row>
            
            <Divider orientation="left">端口配置</Divider>
            <PortsEditor />
            
            <Divider orientation="left">环境变量</Divider>
            <EnvEditor />
            
            <Divider orientation="left">资源限制</Divider>
            <Row gutter={16}>
              <Col span={6}>
                <Form.Item name={['resources', 'requests', 'cpu']} label="CPU 请求">
                  <Input placeholder="如: 100m" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name={['resources', 'requests', 'memory']} label="内存请求">
                  <Input placeholder="如: 128Mi" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name={['resources', 'limits', 'cpu']} label="CPU 限制">
                  <Input placeholder="如: 500m" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name={['resources', 'limits', 'memory']} label="内存限制">
                  <Input placeholder="如: 512Mi" />
                </Form.Item>
              </Col>
            </Row>
            
            <Divider orientation="left">启动命令 (可选)</Divider>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="command" label="启动命令" extra="多个命令用逗号分隔">
                  <Select
                    mode="tags"
                    placeholder="如: /bin/sh"
                    style={{ width: '100%' }}
                    tokenSeparators={[',']}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="args" label="启动参数" extra="多个参数用逗号分隔">
                  <Select
                    mode="tags"
                    placeholder="如: -c, script.sh"
                    style={{ width: '100%' }}
                    tokenSeparators={[',']}
                  />
                </Form.Item>
              </Col>
            </Row>
          </div>
        );
        
      case 2:
        return (
          <div>
            {workloadType !== 'daemonset' && (
              <Form.Item
                name="replicas"
                label="副本数"
                initialValue={1}
              >
                <InputNumber min={0} max={1000} style={{ width: 200 }} />
              </Form.Item>
            )}
            
            {workloadType === 'daemonset' && (
              <div style={{ marginBottom: 16 }}>
                <Tag color="blue">
                  <InfoCircleOutlined /> DaemonSet 会在每个节点上运行一个 Pod，无需设置副本数
                </Tag>
              </div>
            )}
            
            <Form.Item
              name="imagePullSecrets"
              label="镜像拉取凭证"
              extra="选择已创建的 Docker 镜像仓库凭证"
            >
              <Select
                mode="multiple"
                placeholder="选择镜像拉取凭证"
                allowClear
                options={imagePullSecrets.map((secret) => ({
                  label: `${secret.metadata.name} (${secret.metadata.namespace})`,
                  value: secret.metadata.name,
                }))}
              />
            </Form.Item>
            
            <Divider orientation="left">调度策略</Divider>
            <LabelEditor name="nodeSelector" label="节点选择器" />
            
            <Divider orientation="left">健康检查</Divider>
            <ProbeEditor name="livenessProbe" label="存活探针 (Liveness Probe)" />
            <ProbeEditor name="readinessProbe" label="就绪探针 (Readiness Probe)" />
          </div>
        );
        
      default:
        return null;
    }
  };
  
  // YAML 编辑器视图
  const renderYamlEditor = () => (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="YAML 编辑模式"
        description="直接编辑 Kubernetes 资源定义，支持完整的 K8s API 规范。"
      />
      
      {yamlError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={yamlError}
        />
      )}
      
      <YamlEditor
        value={yamlContent}
        onChange={handleYamlChange}
        minHeight={400}
        maxHeight={600}
      />
    </div>
  );
  
  return (
    <div>
      {/* 模式切换 */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={mode}
          onChange={(v) => handleModeChange(v as 'form' | 'yaml')}
          options={[
            { value: 'form', label: <span><FormOutlined /> 表单模式</span> },
            { value: 'yaml', label: <span><CodeOutlined /> YAML 模式</span> },
          ]}
        />
      </div>

      {/* 仓库浏览器抽屉 */}
      <RegistryBrowserDrawer
        visible={browserVisible}
        cloudId={cloudId}
        credential={browserCredential}
        registries={allRegistries}
        onRegistryChange={setBrowserCredential}
        currentImage={form.getFieldValue('image')}
        onClose={() => {
          setBrowserVisible(false);
        }}
        onSelectImage={(image) => {
          form.setFieldsValue({ image });
          setBrowserVisible(false);
          message.success(`已选择镜像: ${image}`);
        }}
      />

      {mode === 'form' ? (
        <>
          <Steps current={currentStep} items={steps} style={{ marginBottom: 24 }} />
          
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              workloadType: defaultType,
              namespace: defaultNamespace,
              imagePullPolicy: 'IfNotPresent',
              replicas: 1,
              labels: [],
              ports: [],
              env: [],
              imagePullSecrets: [],
              nodeSelector: [],
              resources: { requests: {}, limits: {} },
              livenessProbe: { enabled: false, type: 'httpGet' as const, initialDelaySeconds: 30, periodSeconds: 10 },
              readinessProbe: { enabled: false, type: 'httpGet' as const, initialDelaySeconds: 5, periodSeconds: 10 },
            }}
          >
            {renderStepContent()}
          </Form>
          
          <div style={{ marginTop: 24, textAlign: 'right' }}>
            <Space>
              <Button onClick={onCancel}>取消</Button>
              {currentStep > 0 && (
                <Button onClick={handlePrev}>上一步</Button>
              )}
              {currentStep < 2 ? (
                <Button type="primary" onClick={handleNext}>
                  下一步
                </Button>
              ) : (
                <Button type="primary" loading={loading} onClick={handleSubmit}>
                  {isEditMode ? '更新' : '创建'}
                </Button>
              )}
            </Space>
          </div>
        </>
      ) : (
        <>
          {renderYamlEditor()}
          
          <div style={{ marginTop: 24, textAlign: 'right' }}>
            <Space>
              <Button onClick={onCancel}>取消</Button>
              <Button type="primary" loading={loading} onClick={handleSubmit}>
                {isEditMode ? '更新' : '创建'}
              </Button>
            </Space>
          </div>
        </>
      )}

      {/* 仓库浏览器抽屉 */}
      <RegistryBrowserDrawer
        visible={browserVisible}
        cloudId={cloudId}
        credential={browserCredential}
        registries={allRegistries}
        onRegistryChange={setBrowserCredential}
        currentImage={form.getFieldValue('image')}
        onClose={() => {
          setBrowserVisible(false);
        }}
        onSelectImage={(image) => {
          form.setFieldsValue({ image });
          setBrowserVisible(false);
          message.success(`已选择镜像: ${image}`);
        }}
      />
    </div>
  );
};

export default WorkloadForm;
