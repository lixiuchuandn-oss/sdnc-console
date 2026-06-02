/**
 * ==============================================================================
 * 模块名称: 工作负载创建表单 (WorkloadForm)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/WorkloadForm.tsx
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
 * 步骤3: 网络配置 - 网络类型、子网选择、静态IP
 * 步骤4: 存储配置 - 存储卷定义、卷挂载
 * 步骤5: 高级配置 - 副本数、调度、健康检查
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Space,
  Card,
  Tag,
  Divider,
  Row,
  Col,
  App,
  Segmented,
  Alert,
  Collapse,
  Radio,
  Checkbox,
  Spin,
  Modal,
} from 'antd';
import {
  PlusOutlined,
  CodeOutlined,
  FormOutlined,
  FolderOutlined,
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import yaml from 'js-yaml';
import { createHarvesterContainerResource, updateHarvesterContainerResource, checkSubnetStaticIP } from '../../../../../../services/harvesterApi';
import YamlEditor from '../../../../../../components/YamlEditor';
import '../../ecs/modals/VmCreateWizard/InstanceWizard.css';
import { 
  RegistryBrowserDrawer, 
  QuickCreateRegistrySecretModal,
  QuickCreateConfigMapModal,
  QuickCreateSecretModal,
} from './index';
import { generateVmWizardStyleDisplayName, isSystemNamespace } from '../../../../../../utils/harvesterUtils';

import type {
  WorkloadType,
  WorkloadFormValues,
  WorkloadFormProps,
  WorkloadContainerFormValue,
  NodeAffinityConfig,
  PodAffinityConfig,
  VolumeConfig,
} from './workloadForm/types';

import {
  CPU_UNITS,
  MEMORY_UNITS,
  WORKLOAD_TYPE_OPTIONS,
  IMAGE_PULL_POLICY_OPTIONS,
  WORKLOAD_STEPS,
  DEFAULT_DEPLOYMENT_YAML,
  DEFAULT_STATEFULSET_YAML,
  DEFAULT_DAEMONSET_YAML,
} from './workloadForm/constants';

import {
  compareCpuResources,
  compareMemoryResources,
} from './workloadForm/resourceUtils';

import { parseK8sError } from './workloadForm/k8sErrors';

import { isIpInCidr, checkIpAvailability } from './workloadForm/networkIpUtils';

import { createEmptyContainer, toContainerEditorFields } from './workloadForm/containerDefaults';
import { buildK8sResource } from './workloadForm/buildK8sResource';
import { useWorkloadFormNetworkOptions } from './workloadForm/hooks/useWorkloadFormNetworkOptions';


import {
  ResourceInput,
  LabelEditor,
  PortsEditor,
  EnvEditor,
  VolumesEditor,
  ProbeEditor,
  NodeAffinityEditor,
  PodAffinityEditor,
  TolerationsEditor,
  HostAliasesEditor,
  DnsConfigEditor,
} from './workloadForm/editors';
import type {
  NodeAffinityEditorHandle,
  PodAffinityEditorHandle,
  TolerationsEditorHandle,
} from './workloadForm/editors';

const WorkloadForm: React.FC<WorkloadFormProps> = ({
  cloudId,
  namespacesOptions,
  imagePullSecrets,
  secretsWithCredentials,
  onRefreshImagePullSecrets,
  onSuccess,
  onCancel,
  defaultNamespace,
  defaultType = 'deployment',
  editData,
  // ConfigMap 和 Secret 相关 props
  configMaps = [],
  secrets = [],
  onRefreshConfigMaps,
  onRefreshSecrets,
  // PVC 相关 props
  persistentVolumeClaims = [],
  onRefreshPVCs: _onRefreshPVCs,
  // 网络配置相关 props
  hideFlatSubnet = false,
}) => {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const isEditMode = !!editData;
  const [activeContainerIndex, setActiveContainerIndex] = useState(0);
  
  // YAML 模式状态
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const [yamlContent, setYamlContent] = useState<string>(DEFAULT_DEPLOYMENT_YAML);
  const [yamlError, setYamlError] = useState<string>('');
  
  // 仓库浏览器状态
  const [browserVisible, setBrowserVisible] = useState(false);
  const [browserCredential, setBrowserCredential] = useState<any>(null);
  
  // 快速创建镜像凭证弹窗状态
  const [showQuickCreateRegistry, setShowQuickCreateRegistry] = useState(false);
  
  // 快速创建 ConfigMap/Secret 弹窗状态
  const [showQuickCreateConfigMap, setShowQuickCreateConfigMap] = useState(false);
  const [showQuickCreateSecret, setShowQuickCreateSecret] = useState(false);
  
  // 网络配置数据状态
  
  // 静态 IP 检测状态
  const [checkingStaticIP, setCheckingStaticIP] = useState(false);
  const [staticIPCheckResult, setStaticIPCheckResult] = useState<{
    checked: boolean;
    available: boolean;
    reason: string;
  } | null>(null);
  
  // 监听表单字段变化
  const enableStaticIPWatch = Form.useWatch('enableStaticIP', form);

  const [, setContainersVersion] = useState(0);
  
  const editMetadata = editData?.metadata;
  const syncingContainerRef = useRef(false);
  const nodeAffinityEditorRef = useRef<NodeAffinityEditorHandle>(null);
  const nodeAntiAffinityEditorRef = useRef<NodeAffinityEditorHandle>(null);
  const podAffinityEditorRef = useRef<PodAffinityEditorHandle>(null);
  const podAntiAffinityEditorRef = useRef<PodAffinityEditorHandle>(null);
  const tolerationsEditorRef = useRef<TolerationsEditorHandle>(null);
  const watchedImagePullSecretsValue = Form.useWatch('imagePullSecrets', form);
  const watchedImagePullSecrets = useMemo<string[]>(() => watchedImagePullSecretsValue || [], [watchedImagePullSecretsValue]);
  Form.useWatch('containers', form);
  Form.useWatch('nodeAffinity', form);
  Form.useWatch('nodeAntiAffinity', form);
  Form.useWatch('podAffinity', form);
  Form.useWatch('podAntiAffinity', form);
  Form.useWatch('tolerations', form);
  
  // 存储配置刷新标记，用于通知 VolumesEditor 重新读取数据
  const [volumeRefreshKey, setVolumeRefreshKey] = useState(0);

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

  const syncContainerEditorToForm = useCallback((container: Partial<WorkloadContainerFormValue> | undefined) => {
    syncingContainerRef.current = true;
    form.setFieldsValue(toContainerEditorFields(container));
    // 刷新 VolumesEditor 数据
    setVolumeRefreshKey(v => v + 1);
    queueMicrotask(() => {
      syncingContainerRef.current = false;
    });
  }, [form]);

  const buildActiveContainerFromEditor = useCallback((values: WorkloadFormValues): WorkloadContainerFormValue => {
    const fallbackName = values.name || 'container';
    return {
      containerName: values.containerName || fallbackName,
      image: values.image || '',
      imagePullPolicy: values.imagePullPolicy || 'IfNotPresent',
      ports: values.ports || [],
      env: values.env || [],
      resources: values.resources || { requests: {}, limits: {} },
      command: values.command || [],
      args: values.args || [],
      livenessProbe: values.livenessProbe,
      readinessProbe: values.readinessProbe,
      volumeMounts: values.volumeMounts || [],
      imagePullSecrets: values.imagePullSecrets || [],
    };
  }, []);

  const persistActiveContainerToForm = useCallback(() => {
    const values = form.getFieldsValue(true) as WorkloadFormValues;
    const containers = [...(values.containers || [])];
    const activeContainer = buildActiveContainerFromEditor(values);

    if (containers.length === 0) {
      containers.push(activeContainer);
    } else {
      containers[activeContainerIndex] = activeContainer;
    }

    syncingContainerRef.current = true;
    form.setFieldValue('containers', containers);
    queueMicrotask(() => {
      syncingContainerRef.current = false;
    });

    return containers;
  }, [activeContainerIndex, buildActiveContainerFromEditor, form]);

  const getSyncedFormValues = useCallback((): WorkloadFormValues => {
    const values = form.getFieldsValue(true) as WorkloadFormValues;
    const containers = [...(values.containers || [])];
    const activeContainer = buildActiveContainerFromEditor(values);
    const latestImagePullSecrets = watchedImagePullSecrets.length > 0
      ? watchedImagePullSecrets
      : ((form.getFieldValue('imagePullSecrets') as string[] | undefined) || values.imagePullSecrets || []);

    if (containers.length === 0) {
      containers.push(activeContainer);
    } else {
      containers[activeContainerIndex] = activeContainer;
    }

    return {
      ...values,
      containers,
      imagePullSecrets: latestImagePullSecrets,
    };
  }, [activeContainerIndex, buildActiveContainerFromEditor, form, watchedImagePullSecrets]);

  const handleSelectContainer = useCallback((index: number) => {
    const containers = persistActiveContainerToForm();
    const target = containers?.[index];
    setActiveContainerIndex(index);
    syncContainerEditorToForm(target);
  }, [persistActiveContainerToForm, syncContainerEditorToForm]);

  const handleAddContainer = useCallback(() => {
    const syncedValues = getSyncedFormValues();
    const nextContainers = [...(syncedValues.containers || [])];
    const fallbackName = syncedValues.name ? `${syncedValues.name}-${nextContainers.length + 1}` : `container-${nextContainers.length + 1}`;
    nextContainers.push(createEmptyContainer(fallbackName));
    form.setFieldsValue({ containers: nextContainers });
    setActiveContainerIndex(nextContainers.length - 1);
    syncContainerEditorToForm(nextContainers[nextContainers.length - 1]);
    setContainersVersion((v) => v + 1);
  }, [form, getSyncedFormValues, syncContainerEditorToForm]);

  const _handleDuplicateContainer = useCallback(() => {
    const syncedValues = getSyncedFormValues();
    const nextContainers = [...(syncedValues.containers || [])];
    const current = nextContainers[activeContainerIndex];
    if (!current) return;
    nextContainers.splice(activeContainerIndex + 1, 0, {
      ...current,
      containerName: current.containerName ? `${current.containerName}-copy` : `container-${nextContainers.length + 1}`,
      ports: [...(current.ports || [])],
      env: [...(current.env || [])],
      resources: {
        requests: { ...(current.resources?.requests || {}) },
        limits: { ...(current.resources?.limits || {}) },
      },
      command: [...(current.command || [])],
      args: [...(current.args || [])],
      volumeMounts: [...(current.volumeMounts || [])],
    });
    form.setFieldsValue({ containers: nextContainers });
    setActiveContainerIndex(activeContainerIndex + 1);
    syncContainerEditorToForm(nextContainers[activeContainerIndex + 1]);
    setContainersVersion((v) => v + 1);
  }, [activeContainerIndex, form, getSyncedFormValues, syncContainerEditorToForm]);

  const _handleRemoveContainer = useCallback(() => {
    const syncedValues = getSyncedFormValues();
    const nextContainers = [...(syncedValues.containers || [])];
    if (nextContainers.length <= 1) {
      message.warning('至少需要保留一个容器');
      return;
    }
    nextContainers.splice(activeContainerIndex, 1);
    const nextIndex = Math.max(0, activeContainerIndex - 1);
    form.setFieldsValue({ containers: nextContainers });
    setActiveContainerIndex(nextIndex);
    syncContainerEditorToForm(nextContainers[nextIndex]);
    setContainersVersion((v) => v + 1);
  }, [activeContainerIndex, form, getSyncedFormValues, message, syncContainerEditorToForm]);

  // 编辑模式：初始化表单数据
  useEffect(() => {
    if (!editData) return;
    try {
      const spec = editData?.spec || {};
      const metadata = editData?.metadata || {};
      const template = spec?.template || {};
      const rawContainers = template?.spec?.containers || [];
      const firstContainer = rawContainers[0] || {};
      
      // 提取标签
      const labels = Object.entries(metadata?.labels || {}).map(([key, value]) => ({ key, value }));
      
      // 提取健康检查（必须在 parseContainer 之前定义）
      const parseProbe = (probe: any) => {
        if (!probe) return undefined;
        const probeType: 'httpGet' | 'tcpSocket' | 'exec' = probe.httpGet ? 'httpGet' : probe.tcpSocket ? 'tcpSocket' : 'exec';
        return {
          enabled: true,
          type: probeType,
          httpGet: probe.httpGet ? { path: probe.httpGet.path, port: probe.httpGet.port } : undefined,
          tcpSocket: probe.tcpSocket ? { port: probe.tcpSocket.port } : undefined,
          exec: probe.exec ? { command: probe.exec.command } : undefined,
          initialDelaySeconds: probe.initialDelaySeconds || 0,
          periodSeconds: probe.periodSeconds || 10,
        };
      };
      
      // 提取端口
      const parseContainer = (container: any): WorkloadContainerFormValue => ({
        containerName: container?.name || '',
        image: container?.image || '',
        imagePullPolicy: container?.imagePullPolicy || 'IfNotPresent',
        ports: (container?.ports || []).map((p: any) => ({
          containerPort: p.containerPort,
          protocol: p.protocol || 'TCP',
          name: p.name,
        })),
        env: (container?.env || []).map((e: any) => ({
          type: e?.valueFrom?.configMapKeyRef ? 'configMapKeyRef' : e?.valueFrom?.secretKeyRef ? 'secretKeyRef' : 'keyValue',
          name: e.name,
          value: e.value,
          configMapName: e?.valueFrom?.configMapKeyRef?.name,
          configMapKey: e?.valueFrom?.configMapKeyRef?.key,
          secretName: e?.valueFrom?.secretKeyRef?.name,
          secretKey: e?.valueFrom?.secretKeyRef?.key,
        })),
        resources: {
          requests: {
            cpu: container?.resources?.requests?.cpu,
            memory: container?.resources?.requests?.memory,
          },
          limits: {
            cpu: container?.resources?.limits?.cpu,
            memory: container?.resources?.limits?.memory,
          },
        },
        command: container?.command,
        args: container?.args,
        livenessProbe: parseProbe(container?.livenessProbe),
        readinessProbe: parseProbe(container?.readinessProbe),
        volumeMounts: (container?.volumeMounts || []).map((mount: any) => ({
          name: mount.name,
          mountPath: mount.mountPath,
          subPath: mount.subPath,
          readOnly: mount.readOnly,
        })),
      });
      
      const containers = rawContainers.length > 0 ? rawContainers.map(parseContainer) : [createEmptyContainer(metadata?.name || 'container')];

      // 提取镜像拉取密钥
      const imagePullSecrets = (template?.spec?.imagePullSecrets || []).map((s: any) => s.name);
      
      // 提取节点选择器
      const nodeSelector = Object.entries(spec?.template?.spec?.nodeSelector || {}).map(([key, value]) => ({ key, value }));
      
      // 提取亲和性配置
      const parseNodeAffinity = (affinity: any): NodeAffinityConfig | undefined => {
        if (!affinity) return undefined;
        
        const result: NodeAffinityConfig = {};
        
        // 解析 required 规则
        if (affinity.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms) {
          result.required = {
            nodeSelectorTerms: affinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms.map((term: any) => ({
              matchExpressions: (term.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
              matchFields: (term.matchFields || []).map((field: any) => ({
                key: field.key,
                operator: field.operator,
                values: field.values,
              })),
            })),
          };
        }
        
        // 解析 preferred 规则
        if (affinity.preferredDuringSchedulingIgnoredDuringExecution) {
          result.preferred = affinity.preferredDuringSchedulingIgnoredDuringExecution.map((pref: any) => ({
            weight: pref.weight,
            preference: {
              matchExpressions: (pref.preference.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
              matchFields: (pref.preference.matchFields || []).map((field: any) => ({
                key: field.key,
                operator: field.operator,
                values: field.values,
              })),
            },
          }));
        }
        
        return Object.keys(result).length > 0 ? result : undefined;
      };
      
      // 解析 Pod 亲和性配置
      const parsePodAffinity = (podAffinity: any): PodAffinityConfig | undefined => {
        if (!podAffinity) return undefined;
        
        const result: PodAffinityConfig = {};
        
        // 解析 required 规则
        if (podAffinity.requiredDuringSchedulingIgnoredDuringExecution?.length) {
          result.required = podAffinity.requiredDuringSchedulingIgnoredDuringExecution.map((term: any) => ({
            labelSelector: term.labelSelector ? {
              matchLabels: term.labelSelector.matchLabels || {},
              matchExpressions: (term.labelSelector.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
            } : undefined,
            namespaces: term.namespaces,
            topologyKey: term.topologyKey,
          }));
        }
        
        // 解析 preferred 规则
        if (podAffinity.preferredDuringSchedulingIgnoredDuringExecution?.length) {
          result.preferred = podAffinity.preferredDuringSchedulingIgnoredDuringExecution.map((pref: any) => ({
            weight: pref.weight,
            podAffinityTerm: {
              labelSelector: pref.podAffinityTerm?.labelSelector ? {
                matchLabels: pref.podAffinityTerm.labelSelector.matchLabels || {},
                matchExpressions: (pref.podAffinityTerm.labelSelector.matchExpressions || []).map((expr: any) => ({
                  key: expr.key,
                  operator: expr.operator,
                  values: expr.values,
                })),
              } : undefined,
              namespaces: pref.podAffinityTerm?.namespaces,
              topologyKey: pref.podAffinityTerm?.topologyKey,
            },
          }));
        }
        
        return Object.keys(result).length > 0 ? result : undefined;
      };
      
      const affinity = template?.spec?.affinity;
      
      // 提取污点容忍
      const tolerations = (template?.spec?.tolerations || []).map((t: any) => ({
        key: t.key,
        operator: t.operator || 'Equal',
        value: t.value,
        effect: t.effect,
        tolerationSeconds: t.tolerationSeconds,
      }));

      // 提取域名映射
      const hostAliases = (template?.spec?.hostAliases || []).map((ha: any) => ({
        ip: ha.ip || '',
        hostnames: ha.hostnames || [],
      }));

      // 提取 DNS 配置
      const dnsPolicy = template?.spec?.dnsPolicy;
      const dnsConfigRaw = template?.spec?.dnsConfig;
      const dnsConfig = dnsConfigRaw
        ? {
            nameservers: dnsConfigRaw.nameservers || [],
            searches: dnsConfigRaw.searches || [],
            options: (dnsConfigRaw.options || []).map((opt: any) => ({
              name: opt.name,
              value: opt.value,
            })),
          }
        : undefined;
      
      // 提取存储卷定义
      const rawVolumes = template?.spec?.volumes || [];
      const volumes: VolumeConfig[] = rawVolumes.map((vol: any) => {
        const result: VolumeConfig = {
          name: vol.name,
          type: 'emptyDir', // 默认类型
        };
        
        if (vol.configMap) {
          result.type = 'configMap';
          result.configMapName = vol.configMap.name;
          result.configMapOptional = vol.configMap.optional;
        } else if (vol.secret) {
          result.type = 'secret';
          result.secretName = vol.secret.secretName;
          result.secretOptional = vol.secret.optional;
        } else if (vol.persistentVolumeClaim) {
          result.type = 'persistentVolumeClaim';
          result.claimName = vol.persistentVolumeClaim.claimName;
        } else if (vol.emptyDir) {
          result.type = 'emptyDir';
          result.emptyDirMedium = vol.emptyDir.medium === 'Memory' ? 'Memory' : 'default';
          result.emptyDirSizeLimit = vol.emptyDir.sizeLimit;
        } else if (vol.hostPath) {
          result.type = 'hostPath';
          result.hostPath = vol.hostPath.path;
          result.hostPathType = vol.hostPath.type;
        }
        
        return result;
      });
      
      // 解析网络配置
      const templateAnnotations = template?.metadata?.annotations || {};
      const networksAnnotation = templateAnnotations['k8s.v1.cni.cncf.io/networks'];
      const logicalSwitch = templateAnnotations['ovn.kubernetes.io/logical_switch'];
      const staticIPAnnotation = templateAnnotations['ovn.kubernetes.io/ip_address'];
      
      // 解析网络类型和值
      let networkType = 'default';
      let flatSubnet: string | undefined;
      let vpcSubnet: string | undefined;
      let customNad: string | undefined;
      let vpcName: string | undefined;
      
      if (networksAnnotation) {
        // networksAnnotation 格式: namespace/name 或 name
        if (logicalSwitch) {
          // 有 logical_switch 注解，说明是 VPC 子网
          networkType = 'vpc';
          vpcSubnet = networksAnnotation;
          // VPC 名称需要等网络数据加载后才能确定
        } else {
          // 没有 logical_switch，可能是扁平子网或自定义 NAD
          // 扁平子网的判断需要查询子网数据，这里先假设为扁平子网
          // 如果不是扁平子网，用户可以在网络数据加载后手动调整
          networkType = 'flat_subnet';
          flatSubnet = networksAnnotation;
        }
      }
      
      const enableStaticIP = !!staticIPAnnotation;
      const staticIP = staticIPAnnotation || undefined;
      
      // 设置表单值
      const kind = editData?.kind?.toLowerCase();
      const type = editData?.type?.toLowerCase();
      
      // 根据 kind/type 字段识别工作负载类型
      const workloadTypeValue = kind === 'daemonset' || type === 'daemonset' ? 'daemonset'
        : kind === 'statefulset' || type === 'statefulset' ? 'statefulset'
        : kind === 'deployment' || type === 'deployment' ? 'deployment'
        : defaultType;
      
      form.setFieldsValue({
        workloadType: workloadTypeValue,
        name: metadata?.annotations?.['tower.io/alias'] || metadata?.name || '',
        namespace: metadata?.namespace || 'default',
        labels,
        containers,
        ...toContainerEditorFields(containers[0] || parseContainer(firstContainer)),
        replicas: spec?.replicas || 1,
        imagePullSecrets,
        nodeSelector,
        nodeAffinity: parseNodeAffinity(affinity?.nodeAffinity),
        nodeAntiAffinity: undefined, // 反亲和性从UI层配置，K8s不区分
        podAffinity: parsePodAffinity(affinity?.podAffinity),
        podAntiAffinity: parsePodAffinity(affinity?.podAntiAffinity),
        tolerations: tolerations.length > 0 ? tolerations : undefined,
        hostAliases: hostAliases.length > 0 ? hostAliases : undefined,
        dnsPolicy,
        dnsConfig,
        volumes: volumes, // 始终设置数组，确保 VolumesEditor 能正确读取
        // 网络配置
        networkType,
        flatSubnet,
        vpcSubnet,
        vpcName,
        customNad,
        enableStaticIP,
        staticIP,
      });
      setActiveContainerIndex(0);
      
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
    } catch (err) {
      console.error('编辑模式初始化表单数据失败:', err);
    }
  }, [editData, defaultType, form]);
  
  // 步骤切换时同步容器数据到顶级字段（特别是步骤3存储配置）
  useEffect(() => {
    if (currentStep === 3) {
      const containers = form.getFieldValue('containers') || [];
      const activeContainer = containers[activeContainerIndex];
      if (activeContainer) {
        syncContainerEditorToForm(activeContainer);
      }
    }
  }, [currentStep, activeContainerIndex, form, syncContainerEditorToForm]);
  
  const {
    kubeSubnets,
    loadingNetworkData,
    isFlatVpc,
    flatSubnetOptions,
    vpcOptions,
    vpcSubnetOptions,
    selectedVpc,
    allNadOptions,
    reloadNads,
  } = useWorkloadFormNetworkOptions({
    cloudId,
    form,
    defaultNamespace,
    editData,
  });

  // 静态 IP 检测函数（调用后端API）
  const handleCheckStaticIP = useCallback(async () => {
    const staticIP = form.getFieldValue('staticIP');
    const networkType = form.getFieldValue('networkType');
    
    if (!staticIP) {
      message.warning('请先输入静态 IP 地址');
      return;
    }
    
    // 验证 IP 格式
    const ipPattern = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    if (!ipPattern.test(staticIP)) {
      message.error('请输入有效的 IPv4 地址');
      return;
    }
    
    // 获取当前子网信息
    let subnetName: string | undefined;
    let subnetNs = 'default';
    
    if (networkType === 'flat_subnet') {
      const flatSubnetValue = form.getFieldValue('flatSubnet');
      if (flatSubnetValue) {
        const parts = flatSubnetValue.split('/');
        if (parts.length === 2) {
          subnetNs = parts[0];
          subnetName = parts[1];
        } else {
          subnetName = flatSubnetValue;
        }
      }
    } else if (networkType === 'vpc') {
      const vpcSubnetValue = form.getFieldValue('vpcSubnet');
      if (vpcSubnetValue) {
        const parts = vpcSubnetValue.split('/');
        if (parts.length === 2) {
          subnetNs = parts[0];
          subnetName = parts[1];
        } else {
          subnetName = vpcSubnetValue;
        }
      }
    }
    
    if (!subnetName) {
      message.warning('请先选择子网');
      return;
    }
    
    setCheckingStaticIP(true);
    
    try {
      // 调用后端API检测IP是否已被使用
      const res = await checkSubnetStaticIP(cloudId, subnetNs, subnetName, staticIP);
      const data = res?.data || res;
      const used = data?.used === true;
      const usedBy = data?.usedBy || '';
      
      setStaticIPCheckResult({
        checked: true,
        available: !used,
        reason: used
          ? `IP 已被使用（被 ${usedBy} 占用）`
          : 'IP 可用，未被其他工作负载使用',
      });
      
      if (used) {
        message.error(`IP ${staticIP} 已被使用（被 ${usedBy} 占用）`);
      } else {
        message.success('IP 可用');
      }
    } catch (e: any) {
      // API调用失败，回退到本地检测
      console.warn('静态IP检测API调用失败，回退到本地检测:', e);
      let currentSubnet: any = null;
      
      if (networkType === 'flat_subnet') {
        const flatSubnetValue = form.getFieldValue('flatSubnet');
        const flatSubnetOption = flatSubnetOptions.find(opt => opt.value === flatSubnetValue);
        currentSubnet = flatSubnetOption?.subnet;
      } else if (networkType === 'vpc') {
        const vpcSubnetValue = form.getFieldValue('vpcSubnet');
        if (vpcSubnetValue) {
          const parts = vpcSubnetValue.split('/');
          const sn = parts.length === 2 ? parts[1] : parts[0];
          currentSubnet = kubeSubnets.find(s => 
            (s.name || s?.metadata?.name) === sn && 
            (s.vpc || s?.spec?.vpc) === selectedVpc
          );
        }
      }
      
      if (currentSubnet) {
        const result = checkIpAvailability(staticIP, currentSubnet);
        setStaticIPCheckResult({
          checked: true,
          available: result.available,
          reason: result.reason,
        });
        if (!result.available) {
          message.error(result.reason);
        } else {
          message.success(result.reason);
        }
      } else {
        setStaticIPCheckResult({
          checked: true,
          available: false,
          reason: '检测失败：无法获取子网信息',
        });
        message.error('IP检测失败：无法获取子网信息');
      }
    } finally {
      setCheckingStaticIP(false);
    }
  }, [cloudId, form, flatSubnetOptions, kubeSubnets, selectedVpc, message]);
  
  
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
  
  const buildWorkloadK8sResource = useCallback(
    (values: WorkloadFormValues) => buildK8sResource(values, allNadOptions),
    [allNadOptions],
  );

  // 表单数据转 YAML
  const formToYaml = useCallback((values: WorkloadFormValues): string => {
    const resource = buildWorkloadK8sResource(values);
    return yaml.dump(resource, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });
  }, [buildWorkloadK8sResource]);
  
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
      const podImagePullSecrets = (resource.spec?.template?.spec?.imagePullSecrets || []).map((s: any) => s.name);
      const parseContainer = (container: any, index: number): WorkloadContainerFormValue => ({
        containerName: container.name || '',
        image: container.image || '',
        imagePullPolicy: container.imagePullPolicy || 'IfNotPresent',
        ports: (container.ports || []).map((p: any) => ({
          name: p.name,
          containerPort: p.containerPort,
          protocol: p.protocol || 'TCP',
        })),
        env: (container.env || []).map((e: any) => ({
          type: e?.valueFrom?.configMapKeyRef ? 'configMapKeyRef' : e?.valueFrom?.secretKeyRef ? 'secretKeyRef' : 'keyValue',
          name: e.name,
          value: e.value || '',
          configMapName: e?.valueFrom?.configMapKeyRef?.name,
          configMapKey: e?.valueFrom?.configMapKeyRef?.key,
          secretName: e?.valueFrom?.secretKeyRef?.name,
          secretKey: e?.valueFrom?.secretKeyRef?.key,
        })),
        resources: {
          requests: container.resources?.requests || {},
          limits: container.resources?.limits || {},
        },
        command: container.command,
        args: container.args,
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
        volumeMounts: (container.volumeMounts || []).map((mount: any) => ({
          name: mount.name,
          mountPath: mount.mountPath,
          subPath: mount.subPath,
          readOnly: mount.readOnly,
        })),
        imagePullSecrets: index === 0 ? podImagePullSecrets : [],
      });

      const containers = (resource.spec?.template?.spec?.containers || []).map((c: any, i: number) => parseContainer(c, i));
      const firstContainer = containers[0] || createEmptyContainer(name);
      
      // 提取高级配置
      const replicas = resource.spec?.replicas || 1;
      const nodeSelector = resource.spec?.template?.spec?.nodeSelector || {};
      
      // 提取亲和性配置
      const affinity = resource.spec?.template?.spec?.affinity;
      const parseNodeAffinityFromYaml = (nodeAffinity: any): NodeAffinityConfig | undefined => {
        if (!nodeAffinity) return undefined;
        
        const result: NodeAffinityConfig = {};
        
        if (nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms) {
          result.required = {
            nodeSelectorTerms: nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms.map((term: any) => ({
              matchExpressions: (term.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
              matchFields: (term.matchFields || []).map((field: any) => ({
                key: field.key,
                operator: field.operator,
                values: field.values,
              })),
            })),
          };
        }
        
        if (nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution) {
          result.preferred = nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution.map((pref: any) => ({
            weight: pref.weight,
            preference: {
              matchExpressions: (pref.preference.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
              matchFields: (pref.preference.matchFields || []).map((field: any) => ({
                key: field.key,
                operator: field.operator,
                values: field.values,
              })),
            },
          }));
        }
        
        return Object.keys(result).length > 0 ? result : undefined;
      };
      
      // 解析 Pod 亲和性配置
      const parsePodAffinityFromYaml = (podAffinity: any): PodAffinityConfig | undefined => {
        if (!podAffinity) return undefined;
        
        const result: PodAffinityConfig = {};
        
        // 解析 required 规则
        if (podAffinity.requiredDuringSchedulingIgnoredDuringExecution?.length) {
          result.required = podAffinity.requiredDuringSchedulingIgnoredDuringExecution.map((term: any) => ({
            labelSelector: term.labelSelector ? {
              matchLabels: term.labelSelector.matchLabels || {},
              matchExpressions: (term.labelSelector.matchExpressions || []).map((expr: any) => ({
                key: expr.key,
                operator: expr.operator,
                values: expr.values,
              })),
            } : undefined,
            namespaces: term.namespaces,
            topologyKey: term.topologyKey,
          }));
        }
        
        // 解析 preferred 规则
        if (podAffinity.preferredDuringSchedulingIgnoredDuringExecution?.length) {
          result.preferred = podAffinity.preferredDuringSchedulingIgnoredDuringExecution.map((pref: any) => ({
            weight: pref.weight,
            podAffinityTerm: {
              labelSelector: pref.podAffinityTerm?.labelSelector ? {
                matchLabels: pref.podAffinityTerm.labelSelector.matchLabels || {},
                matchExpressions: (pref.podAffinityTerm.labelSelector.matchExpressions || []).map((expr: any) => ({
                  key: expr.key,
                  operator: expr.operator,
                  values: expr.values,
                })),
              } : undefined,
              namespaces: pref.podAffinityTerm?.namespaces,
              topologyKey: pref.podAffinityTerm?.topologyKey,
            },
          }));
        }
        
        return Object.keys(result).length > 0 ? result : undefined;
      };
      
      // 提取污点容忍
      const tolerations = (resource.spec?.template?.spec?.tolerations || []).map((t: any) => ({
        key: t.key,
        operator: t.operator || 'Equal',
        value: t.value,
        effect: t.effect,
        tolerationSeconds: t.tolerationSeconds,
      }));
      
      // 提取域名映射
      const hostAliases = (resource.spec?.template?.spec?.hostAliases || []).map((ha: any) => ({
        ip: ha.ip || '',
        hostnames: ha.hostnames || [],
      }));
      
      // 提取 DNS 配置
      const dnsPolicy = resource.spec?.template?.spec?.dnsPolicy;
      const dnsConfigRaw = resource.spec?.template?.spec?.dnsConfig;
      const dnsConfig = dnsConfigRaw ? {
        nameservers: dnsConfigRaw.nameservers || [],
        searches: dnsConfigRaw.searches || [],
        options: (dnsConfigRaw.options || []).map((opt: any) => ({
          name: opt.name,
          value: opt.value,
        })),
      } : undefined;
      
      return {
        name,
        namespace,
        workloadType,
        labels: Object.entries(labels).filter(([k]) => k !== 'app').map(([key, value]) => ({ key, value: String(value) })),
        containers,
        ...toContainerEditorFields(firstContainer),
        replicas,
        nodeSelector: Object.entries(nodeSelector).map(([key, value]) => ({ key, value: String(value) })),
        nodeAffinity: parseNodeAffinityFromYaml(affinity?.nodeAffinity),
        nodeAntiAffinity: undefined,
        podAffinity: parsePodAffinityFromYaml(affinity?.podAffinity),
        podAntiAffinity: parsePodAffinityFromYaml(affinity?.podAntiAffinity),
        tolerations: tolerations.length > 0 ? tolerations : undefined,
        hostAliases: hostAliases.length > 0 ? hostAliases : undefined,
        dnsPolicy,
        dnsConfig,
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
        const currentFormValues = getSyncedFormValues();
        
        if (isEditMode && editData) {
          const k8sResource = buildWorkloadK8sResource(currentFormValues);
          // 保留原始 metadata 字段
          k8sResource.metadata = {
            ...editData.metadata,
            name: currentFormValues.name,
            namespace: currentFormValues.namespace,
            labels: {
              ...editData.metadata?.labels,
              ...(currentFormValues.labels || []).reduce((acc: any, l: any) => {
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
  }, [mode, form, formToYaml, yamlToForm, yamlContent, message, getDefaultYaml, workloadType, isEditMode, editData, buildWorkloadK8sResource, getSyncedFormValues]);
  
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
        
        // 编辑模式下，使用资源 ID 作为 API 路径参数
        if (isEditMode && editMetadata) {
          name = editMetadata.name;
          resource.metadata = {
            ...resource.metadata,
            uid: editMetadata.uid,
            resourceVersion: editMetadata.resourceVersion,
            creationTimestamp: editMetadata.creationTimestamp,
            managedFields: editMetadata.managedFields,
          };
        } else {
          name = resource?.metadata?.name || '';
        }
      } else {
        // 表单模式提交 - 显式验证所有字段（分步骤表单需要）
        const values = await form.validateFields([
          'workloadType', 'name', 'namespace', 'labels',
          'containers',
          'image', 'containerName', 'imagePullPolicy',
          'ports', 'env', 'resources', 'command', 'args',
          'replicas', 'imagePullSecrets', 'nodeSelector',
          'nodeAffinity', 'nodeAntiAffinity', 'tolerations', 'hostAliases', 'dnsPolicy', 'dnsConfig',
          'livenessProbe', 'readinessProbe',
          'volumes', 'volumeMounts'
        ]);

        const syncedValues = getSyncedFormValues();
        
        // DEBUG: 打印表单中的 volumeMounts
        const invalidContainerIndex = (syncedValues.containers || []).findIndex((container) => !container.image);
        if (invalidContainerIndex >= 0) {
          setCurrentStep(1);
          setActiveContainerIndex(invalidContainerIndex);
          syncContainerEditorToForm(syncedValues.containers[invalidContainerIndex]);
          message.error(`请完善容器 ${invalidContainerIndex + 1} 的镜像地址`);
          setLoading(false);
          return;
        }
        
        // 校验容器名称是否重复
        const containerNames = (syncedValues.containers || [])
          .map(c => c.containerName)
          .filter(name => name && name.trim());
        const duplicateNames = containerNames.filter((name, index) => 
          containerNames.indexOf(name) !== index
        );
        if (duplicateNames.length > 0) {
          setCurrentStep(1); // 跳转到容器配置步骤
          message.error(`容器名称重复: ${[...new Set(duplicateNames)].join(', ')}，请使用不同的容器名称`);
          setLoading(false);
          return;
        }
        
        // 校验存储卷挂载：如果定义了存储卷，则必须配置至少一个卷挂载
        const volumes = syncedValues.volumes || [];
        const volumeMounts = syncedValues.volumeMounts || [];
        if (volumes.length > 0 && volumeMounts.length === 0) {
          setCurrentStep(3); // 跳转到存储配置步骤
          message.warning('已定义存储卷，请配置至少一个卷挂载');
          setLoading(false);
          return;
        }
        
        // 校验静态 IP 是否在子网 CIDR 范围内
        if (syncedValues.enableStaticIP && syncedValues.staticIP) {
          const networkType = syncedValues.networkType;
          let subnetCidr: string | undefined;
          
          if (networkType === 'flat_subnet' && syncedValues.flatSubnet) {
            // 扁平子网：从 flatSubnetOptions 中查找 CIDR
            const flatSubnetOption = flatSubnetOptions.find(opt => opt.value === syncedValues.flatSubnet);
            subnetCidr = flatSubnetOption?.subnet?.cidr || flatSubnetOption?.subnet?.spec?.cidrBlock;
          } else if (networkType === 'vpc' && syncedValues.vpcSubnet) {
            // VPC 子网：从 kubeSubnets 中查找 CIDR
            // vpcSubnet 格式为 namespace/name 或 name
            const parts = syncedValues.vpcSubnet.split('/');
            const subnetName = parts.length === 2 ? parts[1] : parts[0];
            const subnet = kubeSubnets.find(s => 
              (s.name || s?.metadata?.name) === subnetName && 
              (s.vpc || s?.spec?.vpc) === syncedValues.vpcName
            );
            subnetCidr = subnet?.cidr || subnet?.spec?.cidrBlock;
          }
          
          if (subnetCidr && !isIpInCidr(syncedValues.staticIP, subnetCidr)) {
            setCurrentStep(2); // 跳转到网络配置步骤
            message.error(`静态 IP ${syncedValues.staticIP} 不在子网 CIDR 范围 ${subnetCidr} 内，请检查`);
            setLoading(false);
            return;
          }
          
          // 校验静态 IP 是否可用（调用后端API）
          let subnetName: string | undefined;
          let subnetNs = 'default';
          
          if (networkType === 'flat_subnet' && syncedValues.flatSubnet) {
            const flatParts = syncedValues.flatSubnet.split('/');
            if (flatParts.length === 2) {
              subnetNs = flatParts[0];
              subnetName = flatParts[1];
            } else {
              subnetName = syncedValues.flatSubnet;
            }
          } else if (networkType === 'vpc' && syncedValues.vpcSubnet) {
            const vpcParts = syncedValues.vpcSubnet.split('/');
            if (vpcParts.length === 2) {
              subnetNs = vpcParts[0];
              subnetName = vpcParts[1];
            } else {
              subnetName = syncedValues.vpcSubnet;
            }
          }
          
          if (subnetName) {
            try {
              const ipCheckRes = await checkSubnetStaticIP(cloudId, subnetNs, subnetName, syncedValues.staticIP);
              const ipCheckData = ipCheckRes?.data || ipCheckRes;
              if (ipCheckData?.used === true) {
                setCurrentStep(2);
                message.error(`静态 IP ${syncedValues.staticIP} 已被使用（被 ${ipCheckData.usedBy || '其他工作负载'} 占用）`);
                setLoading(false);
                return;
              }
            } catch (e: any) {
              // API调用失败，弹出确认框让用户确认
              console.warn('静态IP检测API调用失败:', e);
              const confirmed = await new Promise<boolean>((resolve) => {
                modal.confirm({
                  title: '静态 IP 冲突风险',
                  content: (
                    <div>
                      <p>无法自动检测 IP <strong>{syncedValues.staticIP}</strong> 是否已被使用。</p>
                      <p style={{ color: '#faad14', marginTop: 8 }}>
                        ⚠️ 请确认该 IP 未被其他工作负载使用，否则可能导致网络冲突。
                      </p>
                    </div>
                  ),
                  okText: '确认未使用，继续提交',
                  cancelText: '取消',
                  onOk: () => resolve(true),
                  onCancel: () => resolve(false),
                });
              });
              if (!confirmed) {
                setCurrentStep(2);
                setLoading(false);
                return;
              }
            }
          }
        }
        
        // 校验节点亲和性/反亲和性的标签键输入错误
        const nodeAffinityHasErrors = nodeAffinityEditorRef.current?.getHasLabelErrors();
        const nodeAntiAffinityHasErrors = nodeAntiAffinityEditorRef.current?.getHasLabelErrors();
        if (nodeAffinityHasErrors || nodeAntiAffinityHasErrors) {
          setCurrentStep(4);
          setLoading(false);
          return;
        }
        
        // 校验 Pod 亲和性/反亲和性的 matchLabels 输入错误
        const podAffinityHasErrors = podAffinityEditorRef.current?.getHasLabelErrors();
        const podAntiAffinityHasErrors = podAntiAffinityEditorRef.current?.getHasLabelErrors();
        if (podAffinityHasErrors || podAntiAffinityHasErrors) {
          setCurrentStep(4);
          setLoading(false);
          return;
        }
        
        // 校验污点容忍的键/值输入错误
        const tolerationsHasErrors = tolerationsEditorRef.current?.getHasLabelErrors();
        if (tolerationsHasErrors) {
          setCurrentStep(4);
          setLoading(false);
          return;
        }
        
        resource = buildWorkloadK8sResource(syncedValues);
        apiPath = getApiPath(values.workloadType);

        // 防御性检查：编辑模式下若表单 workloadType 与资源类型不一致，自动纠正
        if (isEditMode) {
          const editKind = editData?.kind?.toLowerCase()
            || (editMetadata?.name && (() => {
              if (editMetadata.name.startsWith('id-ds-')) return 'daemonset';
              if (editMetadata.name.startsWith('id-sts-')) return 'statefulset';
              if (editMetadata.name.startsWith('id-dep-')) return 'deployment';
              return null;
            })());
          if (editKind) {
            const formType = values.workloadType?.toLowerCase();
            if (editKind !== formType) {
              console.warn('[WorkloadForm 提交] workloadType 不一致，自动纠正:', { formType, editKind, name: editMetadata?.name });
              values.workloadType = editKind;
              syncedValues.workloadType = editKind;
              resource = buildWorkloadK8sResource(syncedValues);
              apiPath = getApiPath(editKind as WorkloadType);
            }
          }
        }

        namespace = values.namespace;
        
        // 编辑模式下，保留原有元数据，使用资源 ID 作为 API 路径参数
        if (isEditMode && editMetadata) {
          name = editMetadata.name; // 使用资源 ID
          resource.metadata.name = editMetadata.name; // 保持资源名称不变
          resource.metadata.uid = editMetadata.uid;
          resource.metadata.resourceVersion = editMetadata.resourceVersion;
          resource.metadata.creationTimestamp = editMetadata.creationTimestamp;
          resource.metadata.managedFields = editMetadata.managedFields;
          // 保留原有 annotations 并更新 alias
          resource.metadata.annotations = {
            ...editMetadata.annotations,
            'tower.io/alias': values.name, // 更新显示名称
          };
          // 保留原有的 selector，避免 Pod 不匹配
          if (editData?.spec?.selector) {
            resource.spec.selector = editData.spec.selector;
          }
          // 保留原有的 template.labels，确保与 selector 匹配
          if (editData?.spec?.template?.metadata?.labels) {
            resource.spec.template.metadata.labels = editData.spec.template.metadata.labels;
          }
        } else {
          name = values.name; // 创建模式使用表单名称
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
      
      // 检测版本冲突（409 Conflict）
      const isConflict = error?.response?.status === 409
        || error?.status === 409
        || /conflict/i.test(error?.message || '')
        || /resourceVersion/i.test(error?.message || '');
      
      if (isConflict) {
        Modal.confirm({
          title: '版本冲突',
          content: '该资源已被其他用户修改，请刷新后重新编辑。',
          okText: '确认刷新',
          cancelText: '取消',
          onOk: () => {
            onSuccess(); // 刷新列表并关闭抽屉
          },
        });
      } else {
        const friendlyMsg = parseK8sError(error);
        message.error(friendlyMsg);
      }
    } finally {
      setLoading(false);
    }
  }, [mode, yamlContent, validateYaml, form, buildWorkloadK8sResource, getApiPath, cloudId, message, modal, onSuccess, isEditMode, getSyncedFormValues, syncContainerEditorToForm, editMetadata, editData?.kind, editData?.spec?.selector, editData?.spec?.template?.metadata?.labels, flatSubnetOptions, kubeSubnets]);
  
  // 下一步
  const handleNext = useCallback(async () => {
    try {
      await form.validateFields();
      // 切换步骤前持久化当前容器数据（包括 volumeMounts）
      persistActiveContainerToForm();
      
      // 在存储配置页面（步骤3）点击下一步时，检查是否有存储卷但没有卷挂载
      if (currentStep === 3) {
        const volumes = form.getFieldValue('volumes') || [];
        const containers = form.getFieldValue('containers') || [];
        let hasVolumeMounts = false;
        
        for (const container of containers) {
          if ((container.volumeMounts || []).length > 0) {
            hasVolumeMounts = true;
            break;
          }
        }
        
        if (volumes.length > 0 && !hasVolumeMounts) {
          message.warning('已定义存储卷，请配置至少一个卷挂载');
          return;
        }
      }
      
      setCurrentStep((prev) => prev + 1);
    } catch {
      // 验证失败，不跳转
    }
  }, [form, persistActiveContainerToForm, currentStep, message]);
  
  // 上一步
  const handlePrev = useCallback(() => {
    // 切换步骤前持久化当前容器数据（包括 volumeMounts）
    persistActiveContainerToForm();
    setCurrentStep((prev) => prev - 1);
  }, [persistActiveContainerToForm]);

  const handleStepClick = useCallback(async (targetStep: number) => {
    if (targetStep === currentStep) return;
    
    // 切换步骤前持久化当前容器数据（包括 volumeMounts）
    persistActiveContainerToForm();
    
    if (targetStep < currentStep) {
      setCurrentStep(targetStep);
      return;
    }

    try {
      await form.validateFields();
      setCurrentStep(targetStep);
    } catch {
      // 当前步骤校验失败，不允许前进
    }
  }, [currentStep, form, persistActiveContainerToForm]);


  const getFormSummary = useCallback(() => {
    const values = getSyncedFormValues();
    const containers = values.containers || [];
    
    // 网络配置摘要
    let networkSummary = '默认网络';
    if (values.networkType === 'flat_subnet') {
      networkSummary = values.flatSubnet ? `扁平子网: ${values.flatSubnet}` : '扁平子网';
    } else if (values.networkType === 'vpc') {
      networkSummary = values.vpcSubnet ? `VPC: ${values.vpcName || '-'}/${values.vpcSubnet}` : 'VPC子网';
    } else if (values.networkType === 'custom_nad') {
      networkSummary = values.customNad ? `NAD: ${values.customNad}` : '自定义NAD';
    }
    if (values.enableStaticIP && values.staticIP && values.networkType !== 'custom_nad') {
      networkSummary += ` (静态IP: ${values.staticIP})`;
    }
    
    return {
      name: values.name || '-',
      namespace: values.namespace || '-',
      workloadType: values.workloadType || '-',
      replicas: values.workloadType === 'daemonset' ? '每节点 1 个' : String(values.replicas || 1),
      imagePullSecrets: values.imagePullSecrets?.length || 0,
      volumes: values.volumes?.length || 0,
      network: networkSummary,
      containers: containers.map((container, index) => ({
        key: `${container.containerName || 'container'}-${index}`,
        name: container.containerName || `container-${index + 1}`,
        image: container.image || '-',
        ports: container.ports?.length || 0,
        env: container.env?.length || 0,
        mounts: container.volumeMounts?.length || 0,
      })),
    };
  }, [getSyncedFormValues]);

  const [summary, setSummary] = useState(getFormSummary());

  useEffect(() => {
    setSummary(getFormSummary());
  }, [currentStep, activeContainerIndex, getFormSummary]);
  
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
                {isEditMode ? (
                  <>
                    <Form.Item label="资源 ID">
                      <Input 
                        value={editMetadata?.name || ''} 
                        disabled 
                        style={{ color: 'rgba(0,0,0,0.45)' }}
                      />
                    </Form.Item>
                    <Form.Item
                      name="name"
                      label="显示名称"
                      rules={[
                        { required: true, message: '请输入显示名称' },
                        { max: 63, message: '名称不能超过63个字符' },
                      ]}
                    >
                      <Input placeholder="例如: my-app" />
                    </Form.Item>
                  </>
                ) : (
                  <Form.Item
                    name="name"
                    label="名称"
                    rules={[
                      { required: true, message: '请输入名称' },
                      { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '只允许小写字母、数字和中划线' },
                      { max: 63, message: '名称不能超过63个字符' },
                    ]}
                  >
                    <Input placeholder="例如: my-app" />
                  </Form.Item>
                )}
              </Col>
              <Col span={12}>
                <Form.Item
                  name="namespace"
                  label="项目"
                  rules={[{ required: true, message: '请选择项目' }]}
                  initialValue={defaultNamespace}
                >
                  <Select
                    showSearch
                    disabled={isEditMode}
                    optionFilterProp="label"
                    placeholder="选择项目"
                    options={namespacesOptions
                      .filter((ns) => !isSystemNamespace(ns))
                      .map((ns) => ({ label: ns, value: ns }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            
            <LabelEditor name="labels" label="标签" />
            
            {workloadType !== 'daemonset' && (
              <Form.Item
                name="replicas"
                label="副本数"
                initialValue={1}
                rules={[{ required: true, message: '请输入副本数' }]}
              >
                <InputNumber min={1} max={1000} style={{ width: '100%' }} />
              </Form.Item>
            )}
          </div>
        );
        
      case 1:
        const containers = getSyncedFormValues().containers || [];
        return (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="容器配置"
              description={
                <div>
                  <div>每个容器独立配置镜像、端口、环境变量、资源限制、启动命令和健康检查。点击容器卡片可展开详细配置。</div>
                  <div style={{ marginTop: 8, color: '#faad14' }}>
                    <strong>注意：</strong>Kubernetes 限制镜像拉取凭证只能在 Pod 级别配置。如果您在多个容器中配置了不同的凭证，系统会自动合并去重后应用到 Pod。
                  </div>
                </div>
              }
            />
            {containers.map((container, index) => {
              const isActive = index === activeContainerIndex;
              const portsCount = container.ports?.length || 0;
              const envCount = container.env?.length || 0;
              const resourcesCount = (container.resources?.requests?.cpu || container.resources?.requests?.memory || container.resources?.limits?.cpu || container.resources?.limits?.memory) ? 1 : 0;
              const commandCount = (container.command?.length || container.args?.length) ? 1 : 0;
              const probeCount = (container.livenessProbe?.enabled ? 1 : 0) + (container.readinessProbe?.enabled ? 1 : 0);
              
              return (
                <Card
                  key={`container-${index}`}
                  size="small"
                  style={{ marginBottom: 16, border: isActive ? '2px solid #1677ff' : '1px solid #f0f0f0' }}
                  title={
                    <Space>
                      <Tag color={isActive ? 'blue' : 'default'}>{`容器 ${index + 1}`}</Tag>
                      <span style={{ fontWeight: 500 }}>{container.containerName || `container-${index + 1}`}</span>
                      {isActive && <Tag color="processing">编辑中</Tag>}
                    </Space>
                  }
                  extra={
                    <Space>
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          const syncedValues = getSyncedFormValues();
                          const nextContainers = [...(syncedValues.containers || [])];
                          const current = nextContainers[index];
                          if (!current) return;
                          nextContainers.splice(index + 1, 0, {
                            ...current,
                            containerName: current.containerName ? `${current.containerName}-copy` : `container-${nextContainers.length + 1}`,
                            ports: [...(current.ports || [])],
                            env: [...(current.env || [])],
                            resources: {
                              requests: { ...(current.resources?.requests || {}) },
                              limits: { ...(current.resources?.limits || {}) },
                            },
                            command: [...(current.command || [])],
                            args: [...(current.args || [])],
                            volumeMounts: [...(current.volumeMounts || [])],
                          });
                          form.setFieldsValue({ containers: nextContainers });
                          setActiveContainerIndex(index + 1);
                          syncContainerEditorToForm(nextContainers[index + 1]);
                          setContainersVersion((v) => v + 1);
                        }}
                      >
                        复制
                      </Button>
                      {containers.length > 1 && (
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            const syncedValues = getSyncedFormValues();
                            const nextContainers = [...(syncedValues.containers || [])];
                            if (nextContainers.length <= 1) {
                              message.warning('至少需要保留一个容器');
                              return;
                            }
                            nextContainers.splice(index, 1);
                            const nextIndex = Math.max(0, index - 1);
                            form.setFieldsValue({ containers: nextContainers });
                            setActiveContainerIndex(nextIndex);
                            syncContainerEditorToForm(nextContainers[nextIndex]);
                            setContainersVersion((v) => v + 1);
                          }}
                        >
                          删除
                        </Button>
                      )}
                    </Space>
                  }
                >
                  {isActive ? (
                    <>
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
                                  const currentImage = form.getFieldValue('image');
                                  let targetCredential = registryToCredential(allRegistries[0]);
                                  if (currentImage) {
                                    const serverMatch = currentImage.match(/^([^/]+):?\d*\//);
                                    if (serverMatch) {
                                      const serverFromImage = serverMatch[1];
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
                            extra="默认与工作负载名称相同，仅支持小写字母、数字和连字符"
                            rules={[
                              {
                                pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
                                message: '容器名称只能包含小写字母、数字和连字符，且开头结尾必须是字母或数字',
                              },
                            ]}
                          >
                            <Input placeholder="容器名称 (可选)" />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item name="imagePullPolicy" label="镜像拉取策略" initialValue="IfNotPresent">
                            <Select options={IMAGE_PULL_POLICY_OPTIONS} />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item
                        name="imagePullSecrets"
                        label="镜像拉取凭证"
                        extra={<span style={{ color: '#999' }}>选择此容器使用的镜像仓库凭证</span>}
                      >
                        <Select
                          mode="multiple"
                          placeholder="选择镜像拉取凭证"
                          allowClear
                          options={(imagePullSecrets || []).map((secret) => {
                            const alias = secret?.metadata?.annotations?.['tower.io/alias'];
                            const name = secret?.metadata?.name;
                            return {
                              label: alias ? `${alias} (${name})` : name,
                              value: name,
                            };
                          })}
                        />
                      </Form.Item>
                      <Collapse ghost defaultActiveKey={[]} items={[
                        {
                          key: 'ports',
                          label: `端口配置 (${portsCount})`,
                          children: <PortsEditor />,
                        },
                        {
                          key: 'env',
                          label: `环境变量 (${envCount})`,
                          children: (
                            <EnvEditor
                              cloudId={cloudId}
                              namespacesOptions={namespacesOptions}
                              selectedNamespace={form.getFieldValue('namespace') || defaultNamespace || 'default'}
                              configMaps={configMaps}
                              secrets={secrets}
                              onRefreshConfigMaps={() => onRefreshConfigMaps?.()}
                              onRefreshSecrets={() => onRefreshSecrets?.()}
                              onOpenQuickCreateConfigMap={() => setShowQuickCreateConfigMap(true)}
                              onOpenQuickCreateSecret={() => setShowQuickCreateSecret(true)}
                            />
                          ),
                        },
                        {
                          key: 'resources',
                          label: `资源限制 (${resourcesCount})`,
                          children: (
                            <>
                              <Row gutter={16}>
                                <Col span={12}>
                                  <Form.Item
                                    name={['resources', 'requests', 'cpu']}
                                    label="CPU 请求"
                                    dependencies={[['resources', 'limits', 'cpu']]}
                                    rules={[
                                      {
                                        validator: (_, value) => {
                                          if (!value) return Promise.resolve();
                                          const limit = form.getFieldValue(['resources', 'limits', 'cpu']);
                                          if (limit && compareCpuResources(value, limit) > 0) {
                                            return Promise.reject(new Error('请求值不能超过限制值'));
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <ResourceInput placeholder="如: 100" units={CPU_UNITS} defaultUnit="m" unitTooltip="m: 毫核(1000m=1核)；核: 支持小数如0.5" />
                                  </Form.Item>
                                </Col>
                                <Col span={12}>
                                  <Form.Item
                                    name={['resources', 'limits', 'cpu']}
                                    label="CPU 限制"
                                    dependencies={[['resources', 'requests', 'cpu']]}
                                    rules={[
                                      {
                                        validator: (_, value) => {
                                          if (!value) return Promise.resolve();
                                          const request = form.getFieldValue(['resources', 'requests', 'cpu']);
                                          if (request && compareCpuResources(request, value) > 0) {
                                            return Promise.reject(new Error('限制值不能小于请求值'));
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <ResourceInput placeholder="如: 500" units={CPU_UNITS} defaultUnit="m" unitTooltip="m: 毫核(1000m=1核)；核: 支持小数如0.5" />
                                  </Form.Item>
                                </Col>
                              </Row>
                              <Row gutter={16}>
                                <Col span={12}>
                                  <Form.Item
                                    name={['resources', 'requests', 'memory']}
                                    label="内存请求"
                                    dependencies={[['resources', 'limits', 'memory']]}
                                    rules={[
                                      {
                                        validator: (_, value) => {
                                          if (!value) return Promise.resolve();
                                          const limit = form.getFieldValue(['resources', 'limits', 'memory']);
                                          if (limit && compareMemoryResources(value, limit) > 0) {
                                            return Promise.reject(new Error('请求值不能超过限制值'));
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <ResourceInput placeholder="如: 128" units={MEMORY_UNITS} defaultUnit="Mi" unitTooltip="MiB/GiB: 二进制单位(1GiB=1024MiB)，任意数值均可" />
                                  </Form.Item>
                                </Col>
                                <Col span={12}>
                                  <Form.Item
                                    name={['resources', 'limits', 'memory']}
                                    label="内存限制"
                                    dependencies={[['resources', 'requests', 'memory']]}
                                    rules={[
                                      {
                                        validator: (_, value) => {
                                          if (!value) return Promise.resolve();
                                          const request = form.getFieldValue(['resources', 'requests', 'memory']);
                                          if (request && compareMemoryResources(request, value) > 0) {
                                            return Promise.reject(new Error('限制值不能小于请求值'));
                                          }
                                          return Promise.resolve();
                                        },
                                      },
                                    ]}
                                  >
                                    <ResourceInput placeholder="如: 512" units={MEMORY_UNITS} defaultUnit="Mi" unitTooltip="MiB/GiB: 二进制单位(1GiB=1024MiB)，任意数值均可" />
                                  </Form.Item>
                                </Col>
                              </Row>
                            </>
                          ),
                        },
                        {
                          key: 'command',
                          label: `启动命令 (${commandCount})`,
                          children: (
                            <Row gutter={16}>
                              <Col span={12}>
                                <Form.Item 
                                  name="command" 
                                  label="启动命令" 
                                  extra="覆盖容器默认入口点，多个命令用逗号分隔"
                                  rules={[
                                    {
                                      validator: (_, value) => {
                                        if (!value || !Array.isArray(value)) return Promise.resolve();
                                        const chineseRegex = /[\u4e00-\u9fa5]/;
                                        for (let i = 0; i < value.length; i++) {
                                          if (chineseRegex.test(value[i])) {
                                            return Promise.reject(new Error('不能包含中文字符'));
                                          }
                                        }
                                        return Promise.resolve();
                                      },
                                    },
                                  ]}
                                >
                                  <Select mode="tags" placeholder="如: /bin/sh" style={{ width: '100%' }} tokenSeparators={[',']} />
                                </Form.Item>
                              </Col>
                              <Col span={12}>
                                <Form.Item 
                                  name="args" 
                                  label="启动参数" 
                                  extra="传递给入口点的参数，多个参数用逗号分隔"
                                  rules={[
                                    {
                                      validator: (_, value) => {
                                        if (!value || !Array.isArray(value)) return Promise.resolve();
                                        const chineseRegex = /[\u4e00-\u9fa5]/;
                                        for (let i = 0; i < value.length; i++) {
                                          if (chineseRegex.test(value[i])) {
                                            return Promise.reject(new Error('不能包含中文字符'));
                                          }
                                        }
                                        return Promise.resolve();
                                      },
                                    },
                                  ]}
                                >
                                  <Select mode="tags" placeholder="如: -c, script.sh" style={{ width: '100%' }} tokenSeparators={[',']} />
                                </Form.Item>
                              </Col>
                            </Row>
                          ),
                        },
                        {
                          key: 'probes',
                          label: `健康检查 (${probeCount})`,
                          children: (
                            <>
                              <ProbeEditor name="livenessProbe" label="存活探针 (Liveness Probe)" />
                              <ProbeEditor name="readinessProbe" label="就绪探针 (Readiness Probe)" />
                            </>
                          ),
                        },
                      ]} />
                    </>
                  ) : (
                    <div
                      onClick={() => handleSelectContainer(index)}
                      style={{ cursor: 'pointer', padding: '8px 0' }}
                    >
                      <div style={{ color: '#666', fontSize: 13 }}>{container.image || '未配置镜像'}</div>
                      <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                        端口 {portsCount} / 环境变量 {envCount} / 挂载 {container.volumeMounts?.length || 0}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={handleAddContainer}
              style={{ marginBottom: 16 }}
            >
              添加容器
            </Button>
          </div>
        );
        
      case 2:
        // 网络配置步骤
        const networkType = form.getFieldValue('networkType') || 'default';
        
        return (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="网络配置"
              description={
                <div>
                  <div>配置 Pod 的网络连接方式。默认使用 Pod 网络，也可以选择扁平子网、VPC 子网或自定义 NAD。</div>
                  <div style={{ marginTop: 8, color: '#faad14' }}>
                    💡 提示：如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再创建工作负载。
                  </div>
                </div>
              }
            />
            
            {loadingNetworkData ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Spin tip="加载网络数据..." />
              </div>
            ) : (
              <>
                <Form.Item
                  name="networkType"
                  label="网络类型"
                  initialValue="default"
                  extra="选择 Pod 使用的网络类型"
                >
                  <Radio.Group>
                    <Radio value="default">默认网络（Pod网络）</Radio>
                    {!hideFlatSubnet && <Radio value="flat_subnet">扁平子网</Radio>}
                    <Radio value="vpc">VPC子网</Radio>
                    <Radio value="custom_nad">自定义NAD</Radio>
                  </Radio.Group>
                </Form.Item>
                
                {networkType === 'flat_subnet' && (
                  <>
                    {flatSubnetOptions.length === 0 && !loadingNetworkData && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message="未找到扁平子网"
                        description={
                          <div>
                            <div>请确保已在资源池中创建扁平子网（Kube-OVN 子网，VPC 为 ovn-internal，注解 tower.io/subnet-type=flat）</div>
                            <div style={{ marginTop: 8 }}>当前加载了 {kubeSubnets.length} 个子网，{kubeSubnets.filter(s => isFlatVpc(s?.vpc || s?.spec?.vpc)).length} 个属于扁平 VPC</div>
                            <div style={{ marginTop: 8, color: '#1677ff' }}>💡 如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再重试。</div>
                          </div>
                        }
                      />
                    )}
                    {flatSubnetOptions.length > 0 && (
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message="子网选择提示"
                        description="如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再创建工作负载，否则可能出现 NAD 未找到的错误。"
                      />
                    )}
                    <Form.Item
                      name="flatSubnet"
                      label="选择子网"
                      rules={[{ required: true, message: '请选择扁平子网' }]}
                      extra="扁平子网提供 Underlay 网络连接，将自动生成 NAD 引用"
                    >
                      <Select
                        placeholder="选择扁平子网"
                        showSearch
                        optionFilterProp="label"
                        options={flatSubnetOptions}
                      />
                    </Form.Item>
                  </>
                )}
                
                {networkType === 'vpc' && (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message="子网选择提示"
                      description="如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再创建工作负载，否则可能出现 NAD 未找到的错误。"
                    />
                    <Form.Item
                      name="vpcName"
                      label="选择VPC"
                      rules={[{ required: true, message: '请选择VPC' }]}
                    >
                      <Select
                        placeholder="选择VPC"
                        showSearch
                        optionFilterProp="label"
                        options={vpcOptions}
                        onChange={() => {
                          // VPC 变化时清空子网选择
                          form.setFieldsValue({ vpcSubnet: undefined });
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      name="vpcSubnet"
                      label="选择子网"
                      rules={[{ required: true, message: '请选择子网' }]}
                    >
                      <Select
                        placeholder={selectedVpc ? "选择子网" : "请先选择VPC"}
                        showSearch
                        optionFilterProp="label"
                        options={vpcSubnetOptions.map(opt => {
                          // 查找子网对象生成 NAD 引用
                          const subnet = (kubeSubnets || []).find(s => 
                            (s.name || s?.metadata?.name) === opt.value && 
                            (s.vpc || s?.spec?.vpc) === selectedVpc
                          );
                          
                          let nadRef = opt.value;
                          if (subnet) {
                            let subnetNs = subnet?.namespace || subnet?.metadata?.namespace;
                            if (!subnetNs) {
                              const provider = subnet?.provider || subnet?.spec?.provider;
                              if (provider) {
                                const parts = provider.split('.');
                                if (parts.length >= 2) subnetNs = parts[parts.length - 2];
                              }
                            }
                            subnetNs = subnetNs || 'default';
                            nadRef = `${subnetNs}/${opt.value}`;
                          }
                          
                          return {
                            ...opt,
                            value: nadRef,
                          };
                        })}
                        disabled={!selectedVpc}
                      />
                    </Form.Item>
                  </>
                )}
                
                {networkType === 'custom_nad' && (
                  <Form.Item
                    name="customNad"
                    label="选择NAD"
                    rules={[{ required: true, message: '请选择NAD' }]}
                    extra="选择已创建的网络附件定义（NetworkAttachmentDefinition）"
                  >
                    <Select
                      placeholder="选择NAD网络"
                      options={allNadOptions}
                      showSearch
                      optionFilterProp="label"
                      allowClear
                      onDropdownVisibleChange={(open) => {
                        if (open) {
                          void reloadNads();
                        }
                      }}
                    />
                  </Form.Item>
                )}
                
                <Divider />
                
                {networkType !== 'default' && networkType !== 'custom_nad' && (() => {
                  // 获取当前子网的 CIDR 信息
                  let currentCidr: string | undefined;
                  
                  if (networkType === 'flat_subnet') {
                    const flatSubnetValue = form.getFieldValue('flatSubnet');
                    const flatSubnetOption = flatSubnetOptions.find(opt => opt.value === flatSubnetValue);
                    currentCidr = flatSubnetOption?.subnet?.cidr || flatSubnetOption?.subnet?.spec?.cidrBlock;
                  } else if (networkType === 'vpc') {
                    const vpcSubnetValue = form.getFieldValue('vpcSubnet');
                    if (vpcSubnetValue) {
                      const parts = vpcSubnetValue.split('/');
                      const subnetName = parts.length === 2 ? parts[1] : parts[0];
                      const subnet = kubeSubnets.find(s => 
                         (s.name || s?.metadata?.name) === subnetName && 
                         (s.vpc || s?.spec?.vpc) === selectedVpc
                       );
                       currentCidr = subnet?.cidr || subnet?.spec?.cidrBlock;
                     }
                   }
                   
return (
                      <Form.Item label="静态IP配置">
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Form.Item name="enableStaticIP" valuePropName="checked" noStyle>
                            <Checkbox>启用静态IP</Checkbox>
                          </Form.Item>
                          {(enableStaticIPWatch ?? form.getFieldValue('enableStaticIP')) && (
                           <>
                             {currentCidr && (
                               <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
                                 子网 CIDR: <Tag color="blue">{currentCidr}</Tag>
                               </div>
                             )}
                            <Form.Item
                              name="staticIP"
                              label="静态IP地址"
                              rules={[
                                { required: true, message: '请输入静态IP地址' },
                                {
                                  pattern: /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
                                  message: '请输入有效的IPv4地址'
                                },
                                ...(currentCidr ? [{
                                  validator: (_: any, value: string) => {
                                    if (!value || isIpInCidr(value, currentCidr!)) {
                                      return Promise.resolve();
                                    }
                                    return Promise.reject(new Error(`IP 地址不在子网 CIDR 范围 ${currentCidr} 内`));
                                  }
                                } as any] : []),
                                {
                                  validator: () => {
                                    if (staticIPCheckResult && !staticIPCheckResult.available) {
                                      return Promise.reject(new Error(staticIPCheckResult.reason));
                                    }
                                    return Promise.resolve();
                                  }
                                }
                              ]}
                              extra={currentCidr ? `子网 CIDR: ${currentCidr}` : '请先选择子网以获取 CIDR 范围'}
                            >
                              <Input 
                                placeholder="例如: 192.168.1.100" 
                                addonAfter={
                                  <Button 
                                    type="link" 
                                    size="small"
                                    loading={checkingStaticIP}
                                    onClick={handleCheckStaticIP}
                                    style={{ padding: '0 8px' }}
                                  >
                                    检测
                                  </Button>
                                }
                                onChange={() => {
                                  setStaticIPCheckResult(null);
                                }}
                              />
                            </Form.Item>
                            {staticIPCheckResult && (
                              <Alert
                                type={staticIPCheckResult.available ? 'success' : 'error'}
                                showIcon
                                style={{ marginBottom: 16 }}
                                message={staticIPCheckResult.available ? 'IP 可用' : 'IP 不可用'}
                                description={staticIPCheckResult.reason}
                              />
                            )}
                            {!staticIPCheckResult && (
                              <Alert
                                type="warning"
                                showIcon
                                style={{ marginBottom: 16 }}
                                message="建议点击「检测」按钮验证 IP 是否可用后再提交"
                              />
                            )}
                           </>
                         )}
                       </Space>
                     </Form.Item>
                   );
                 })()}
                
                {networkType !== 'default' && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 16 }}
                    message="注意"
                    description={
                      <div>
                        <div>选择非默认网络类型时，请确保集群已正确配置对应的网络插件（如 Kube-OVN）。</div>
                        {networkType === 'flat_subnet' && (
                          <div style={{ marginTop: 8 }}>扁平子网需要 Pod 所在节点配置对应的物理网络接口。</div>
                        )}
                        {networkType === 'vpc' && (
                          <div style={{ marginTop: 8 }}>VPC 子网由 Kube-OVN 提供，支持网络隔离和高级网络功能。</div>
                        )}
                        {networkType === 'custom_nad' && (
                          <div style={{ marginTop: 8 }}>自定义 NAD 仅展示当前命名空间下混杂模式已开启的网络。Kube-OVN 类型的 NAD 将自动补充子网注解。非 Kube-OVN 类型（如 macvlan/bridge）的 NAD 需在 NAD 配置中设置 IPAM（如 DHCP 或静态 IP）才能为容器分配 IP 地址。</div>
                        )}
                      </div>
                    }
                  />
                )}
              </>
            )}
          </div>
        );
        
      case 3:
        const containersForStorage = getSyncedFormValues().containers || [];
        return (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="存储配置"
              description="先定义工作负载共享的存储卷，再为当前选中的容器配置卷挂载。卷定义共享，卷挂载属于当前容器。"
            />
            {containersForStorage.map((container, index) => {
              const isActive = index === activeContainerIndex;
              return (
                <Card
                  key={`storage-container-${index}`}
                  size="small"
                  style={{ marginBottom: 16, border: isActive ? '2px solid #1677ff' : '1px solid #f0f0f0' }}
                  title={
                    <Space>
                      <Tag color={isActive ? 'blue' : 'default'}>{`容器 ${index + 1}`}</Tag>
                      <span style={{ fontWeight: 500 }}>{container.containerName || `container-${index + 1}`}</span>
                    </Space>
                  }
                >
                  {isActive ? (
                    <VolumesEditor
                      cloudId={cloudId}
                      namespacesOptions={namespacesOptions}
                      selectedNamespace={form.getFieldValue('namespace') || defaultNamespace || 'default'}
                      configMaps={configMaps}
                      secrets={secrets}
                      persistentVolumeClaims={persistentVolumeClaims}
                      onRefreshConfigMaps={() => onRefreshConfigMaps?.()}
                      onRefreshSecrets={() => onRefreshSecrets?.()}
                      onOpenQuickCreateConfigMap={() => setShowQuickCreateConfigMap(true)}
                      onOpenQuickCreateSecret={() => setShowQuickCreateSecret(true)}
                      refreshKey={volumeRefreshKey}
                      onVolumeChange={() => setVolumeRefreshKey(v => v + 1)}
                    />
                  ) : (
                    <div
                      onClick={() => handleSelectContainer(index)}
                      style={{ cursor: 'pointer', padding: '8px 0' }}
                    >
                      <div style={{ color: '#999' }}>点击切换到此容器</div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        );

      case 4:
        const nodeAffinity = form.getFieldValue('nodeAffinity');
        const nodeAntiAffinity = form.getFieldValue('nodeAntiAffinity');
        const podAffinity = form.getFieldValue('podAffinity');
        const podAntiAffinity = form.getFieldValue('podAntiAffinity');
        const tolerations = form.getFieldValue('tolerations') || [];
        const hostAliases = form.getFieldValue('hostAliases') || [];
        
        const nodeAffinityCount = (nodeAffinity?.required?.nodeSelectorTerms?.length || 0) + (nodeAffinity?.preferred?.length || 0);
        const nodeAntiAffinityCount = (nodeAntiAffinity?.required?.nodeSelectorTerms?.length || 0) + (nodeAntiAffinity?.preferred?.length || 0);
        const podAffinityCount = (podAffinity?.required?.length || 0) + (podAffinity?.preferred?.length || 0);
        const podAntiAffinityCount = (podAntiAffinity?.required?.length || 0) + (podAntiAffinity?.preferred?.length || 0);
        const tolerationsCount = tolerations.length;
        const hostAliasesCount = hostAliases.length;
        
        return (
          <div>
            <Divider orientation="left">调度策略</Divider>
            <LabelEditor name="nodeSelector" label="节点选择器" />
            
            <Collapse ghost defaultActiveKey={[]} items={[
              {
                key: 'nodeAffinity',
                label: `节点亲和性 (${nodeAffinityCount})`,
                children: <NodeAffinityEditor ref={nodeAffinityEditorRef} name="nodeAffinity" label="节点亲和性" />,
              },
              {
                key: 'nodeAntiAffinity',
                label: `节点反亲和性 (${nodeAntiAffinityCount})`,
                children: <NodeAffinityEditor ref={nodeAntiAffinityEditorRef} name="nodeAntiAffinity" label="节点反亲和性" />,
              },
              {
                key: 'podAffinity',
                label: `Pod 亲和性 (${podAffinityCount})`,
                children: (
                  <PodAffinityEditor 
                    ref={podAffinityEditorRef}
                    name="podAffinity" 
                    label="Pod 亲和性" 
                    namespacesOptions={namespacesOptions}
                  />
                ),
              },
              {
                key: 'podAntiAffinity',
                label: `Pod 反亲和性 (${podAntiAffinityCount})`,
                children: (
                  <PodAffinityEditor 
                    ref={podAntiAffinityEditorRef}
                    name="podAntiAffinity" 
                    label="Pod 反亲和性" 
                    namespacesOptions={namespacesOptions}
                  />
                ),
              },
              {
                key: 'tolerations',
                label: `污点容忍 (${tolerationsCount})`,
                children: <TolerationsEditor ref={tolerationsEditorRef} />,
              },
              {
                key: 'hostAliases',
                label: `域名映射 (${hostAliasesCount})`,
                children: <HostAliasesEditor />,
              },
              {
                key: 'dnsConfig',
                label: `DNS 配置`,
                children: <DnsConfigEditor />,
              },
            ]} />
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
        key={`registry-browser-${activeContainerIndex}-${form.getFieldValue('image') || 'empty'}`}
        visible={browserVisible}
        cloudId={cloudId}
        credential={browserCredential}
        registries={allRegistries}
        onRegistryChange={setBrowserCredential}
        currentImage={form.getFieldValue('image')}
        onClose={() => {
          setBrowserVisible(false);
        }}
        onSelectImage={(image, secret) => {
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
          setBrowserVisible(false);
        }}
      />

      {mode === 'form' ? (
        <>
          <Form
            form={form}
            layout="vertical"
            onValuesChange={() => {
              if (!syncingContainerRef.current) {
                persistActiveContainerToForm();
              }
              setSummary(getFormSummary());
            }}
            initialValues={{
              workloadType: defaultType,
              name: generateVmWizardStyleDisplayName('app'),
              namespace: defaultNamespace,
              containers: [createEmptyContainer(defaultType === 'daemonset' ? 'daemonset-container' : 'main-container')],
              imagePullPolicy: 'IfNotPresent',
              replicas: 1,
              labels: [],
              ports: [],
              env: [],
              imagePullSecrets: [],
              nodeSelector: [],
              nodeAffinity: { required: undefined, preferred: undefined },
              nodeAntiAffinity: { required: undefined, preferred: undefined },
              podAffinity: { required: undefined, preferred: undefined },
              podAntiAffinity: { required: undefined, preferred: undefined },
              tolerations: [],
              resources: { requests: {}, limits: {} },
              livenessProbe: { enabled: false, type: 'httpGet' as const, initialDelaySeconds: 30, periodSeconds: 10 },
              readinessProbe: { enabled: false, type: 'httpGet' as const, initialDelaySeconds: 5, periodSeconds: 10 },
              volumes: [],
              volumeMounts: [],
              // 网络配置默认值
              networkType: 'default',
              enableStaticIP: false,
            }}
          >
            <Row gutter={[0, 0]} style={{ height: '100%' }}>
              <Col span={5}>
                <div className="wizard-sidebar" style={{ padding: '0 8px 0 0', minHeight: 'calc(80vh - 24px)' }}>
                  <div>
                    {WORKLOAD_STEPS.map((step, idx) => {
                      const isActive = currentStep === idx;
                      const isCompleted = currentStep > idx;
                      return (
                        <div
                          key={step.key}
                          className={`wizard-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                          onClick={() => handleStepClick(idx)}
                        >
                          <div className="wizard-step-icon">
                            {isCompleted ? <CheckOutlined /> : step.icon}
                          </div>
                          <span className="wizard-step-text">{step.title}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Col>

              <Col span={12} style={{ height: '100%' }}>
                <div style={{ height: 'calc(80vh - 24px)', overflowY: 'auto', padding: '0 30px', scrollbarGutter: 'stable' }}>
                  {renderStepContent()}
                </div>
              </Col>

              <Col span={7} style={{ height: '100%' }}>
                <div style={{ background: '#fff', border: '1px solid #eaeaea', borderRadius: 8, padding: 16, height: 'calc(80vh - 24px)', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 12, marginBottom: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>配置预览</span>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>名称</span>
                        <span style={{ color: '#333', fontWeight: 500 }}>{summary.name}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>项目</span>
                        <span style={{ color: '#333' }}>{summary.namespace}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>类型</span>
                        <span style={{ color: '#333' }}>{summary.workloadType}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>副本</span>
                        <span style={{ color: '#333' }}>{summary.replicas}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>镜像凭证</span>
                        <span style={{ color: '#333' }}>{summary.imagePullSecrets} 个</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>存储卷</span>
                        <span style={{ color: '#333' }}>{summary.volumes} 个</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                        <span style={{ color: '#888' }}>网络</span>
                        <span style={{ color: '#333', maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all' }}>{summary.network}</span>
                      </div>
                      <div style={{ padding: '8px 0' }}>
                        <div style={{ color: '#888', marginBottom: 8 }}>容器列表</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {summary.containers.map((container, index) => (
                            <div key={container.key} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10, background: index === activeContainerIndex ? '#f8fbff' : '#fff' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ fontWeight: 500 }}>{container.name}</span>
                                <Tag color={index === activeContainerIndex ? 'blue' : 'default'}>{`容器 ${index + 1}`}</Tag>
                              </div>
                              <div style={{ fontSize: 12, color: '#666', wordBreak: 'break-all' }}>{container.image}</div>
                              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                                端口 {container.ports} / 环境变量 {container.env} / 挂载 {container.mounts}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <Button htmlType="button" onClick={onCancel}>取消</Button>
                      {currentStep > 0 && (
                        <Button htmlType="button" onClick={handlePrev}>上一步</Button>
                      )}
                      {currentStep < WORKLOAD_STEPS.length - 1 ? (
                        <Button type="primary" htmlType="button" onClick={handleNext}>
                          下一步
                        </Button>
                      ) : (
                        <Button type="primary" htmlType="button" loading={loading} onClick={handleSubmit}>
                          {isEditMode ? '更新' : '创建'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Col>
            </Row>
          </Form>
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

      {/* 快速创建镜像拉取凭证弹窗 */}
      <QuickCreateRegistrySecretModal
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        defaultNamespace={form.getFieldValue('namespace') || defaultNamespace}
        visible={showQuickCreateRegistry}
        onSuccess={(secret) => {
          setShowQuickCreateRegistry(false);
          // 刷新凭证列表
          if (onRefreshImagePullSecrets) {
            onRefreshImagePullSecrets();
          }
          // 自动选中新创建的凭证
          const currentSecrets = form.getFieldValue('imagePullSecrets') || [];
          if (!currentSecrets.includes(secret.name)) {
            form.setFieldsValue({ imagePullSecrets: [...currentSecrets, secret.name] });
          }
        }}
        onCancel={() => setShowQuickCreateRegistry(false)}
      />

      {/* 快速创建 ConfigMap 弹窗 */}
      <QuickCreateConfigMapModal
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        defaultNamespace={form.getFieldValue('namespace') || defaultNamespace}
        visible={showQuickCreateConfigMap}
        onSuccess={(configMap) => {
          setShowQuickCreateConfigMap(false);
          // 刷新 ConfigMap 列表
          if (onRefreshConfigMaps) {
            onRefreshConfigMaps();
          }
          message.success(`ConfigMap "${configMap.name}" 创建成功，请在下拉列表中选择`);
        }}
        onCancel={() => setShowQuickCreateConfigMap(false)}
      />

      {/* 快速创建 Secret 弹窗 */}
      <QuickCreateSecretModal
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        defaultNamespace={form.getFieldValue('namespace') || defaultNamespace}
        visible={showQuickCreateSecret}
        onSuccess={(secret) => {
          setShowQuickCreateSecret(false);
          // 刷新 Secret 列表
          if (onRefreshSecrets) {
            onRefreshSecrets();
          }
          message.success(`Secret "${secret.name}" 创建成功，请在下拉列表中选择`);
        }}
        onCancel={() => setShowQuickCreateSecret(false)}
      />
    </div>
  );
};

export type {
  WorkloadType,
  WorkloadFormValues,
  WorkloadFormProps,
} from './workloadForm/types';

export default WorkloadForm;
