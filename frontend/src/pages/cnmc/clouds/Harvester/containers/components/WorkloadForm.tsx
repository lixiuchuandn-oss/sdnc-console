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
import { Form, Button, Space, Tag, Row, Col, App, Segmented } from 'antd';
import { CodeOutlined, FormOutlined, CheckOutlined } from '@ant-design/icons';
import yaml from 'js-yaml';
import '../../ecs/modals/VmCreateWizard/InstanceWizard.css';
import {
  RegistryBrowserDrawer,
  QuickCreateRegistrySecretModal,
  QuickCreateConfigMapModal,
  QuickCreateSecretModal,
} from './index';
import { generateVmWizardStyleDisplayName } from '../../../../../../utils/harvesterUtils';

import type {
  WorkloadFormValues,
  WorkloadFormProps,
  WorkloadContainerFormValue,
  NodeAffinityConfig,
  PodAffinityConfig,
} from './workloadForm/types';

import { WORKLOAD_STEPS, DEFAULT_DEPLOYMENT_YAML } from './workloadForm/constants';

import { getDefaultWorkloadYaml } from './workloadForm/workloadTypeUtils';
import {
  applyWorkloadSubmitFailure,
  executeWorkloadSubmit,
  handleWorkloadSubmitError,
  prepareWorkloadSubmit,
} from './workloadForm/submitWorkload';
import { confirmHighRiskOperation } from '../../shared/lib/highRiskConfirm';

import { createEmptyContainer, toContainerEditorFields } from './workloadForm/containerDefaults';
import { buildK8sResource } from './workloadForm/buildK8sResource';
import { buildActiveContainerFromEditor } from './workloadForm/containerFormSync';
import { parseEditWorkloadFormInit } from './workloadForm/parseEditWorkloadFormInit';
import {
  buildMergedRegistryList,
  loadHarvesterRegistriesFromLocalStorage,
  localRegistryToCredential,
} from './workloadForm/registryCredentials';
import { useWorkloadFormNetworkOptions } from './workloadForm/hooks/useWorkloadFormNetworkOptions';

import { WorkloadFormStepContent } from './workloadForm/steps';
import WorkloadFormYamlPanel from './workloadForm/WorkloadFormYamlPanel';
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
  const { message } = App.useApp();
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

  const [, setContainersVersion] = useState(0);

  const editMetadata = editData?.metadata;
  const syncingContainerRef = useRef(false);
  const nodeAffinityEditorRef = useRef<NodeAffinityEditorHandle>(null);
  const nodeAntiAffinityEditorRef = useRef<NodeAffinityEditorHandle>(null);
  const podAffinityEditorRef = useRef<PodAffinityEditorHandle>(null);
  const podAntiAffinityEditorRef = useRef<PodAffinityEditorHandle>(null);
  const tolerationsEditorRef = useRef<TolerationsEditorHandle>(null);
  const watchedImagePullSecretsValue = Form.useWatch('imagePullSecrets', form);
  const watchedImagePullSecrets = useMemo<string[]>(
    () => watchedImagePullSecretsValue || [],
    [watchedImagePullSecretsValue],
  );
  Form.useWatch('containers', form);
  Form.useWatch('nodeAffinity', form);
  Form.useWatch('nodeAntiAffinity', form);
  Form.useWatch('podAffinity', form);
  Form.useWatch('podAntiAffinity', form);
  Form.useWatch('tolerations', form);

  // 存储配置刷新标记，用于通知 VolumesEditor 重新读取数据
  const [volumeRefreshKey, setVolumeRefreshKey] = useState(0);

  const localStorageRegistries = useMemo(() => loadHarvesterRegistriesFromLocalStorage(), []);

  const allRegistries = useMemo(
    () => buildMergedRegistryList(localStorageRegistries, secretsWithCredentials),
    [localStorageRegistries, secretsWithCredentials],
  );

  const handleBrowseRegistry = useCallback(() => {
    if (allRegistries.length > 0) {
      const currentImage = form.getFieldValue('image');
      let targetCredential = localRegistryToCredential(allRegistries[0]);
      if (currentImage) {
        const serverMatch = currentImage.match(/^([^/]+):?\d*\//);
        if (serverMatch) {
          const serverFromImage = serverMatch[1];
          const matchingRegistry = allRegistries.find((r) => r.server === serverFromImage);
          if (matchingRegistry) {
            targetCredential = localRegistryToCredential(matchingRegistry);
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
  }, [allRegistries, form, message]);

  const syncContainerEditorToForm = useCallback(
    (container: Partial<WorkloadContainerFormValue> | undefined) => {
      syncingContainerRef.current = true;
      form.setFieldsValue(toContainerEditorFields(container));
      // 刷新 VolumesEditor 数据
      setVolumeRefreshKey((v) => v + 1);
      queueMicrotask(() => {
        syncingContainerRef.current = false;
      });
    },
    [form],
  );

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
  }, [activeContainerIndex, form]);

  const getSyncedFormValues = useCallback((): WorkloadFormValues => {
    const values = form.getFieldsValue(true) as WorkloadFormValues;
    const containers = [...(values.containers || [])];
    const activeContainer = buildActiveContainerFromEditor(values);
    const latestImagePullSecrets =
      watchedImagePullSecrets.length > 0
        ? watchedImagePullSecrets
        : (form.getFieldValue('imagePullSecrets') as string[] | undefined) ||
          values.imagePullSecrets ||
          [];

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
  }, [activeContainerIndex, form, watchedImagePullSecrets]);

  const handleSelectContainer = useCallback(
    (index: number) => {
      const containers = persistActiveContainerToForm();
      const target = containers?.[index];
      setActiveContainerIndex(index);
      syncContainerEditorToForm(target);
    },
    [persistActiveContainerToForm, syncContainerEditorToForm],
  );

  const handleAddContainer = useCallback(() => {
    const syncedValues = getSyncedFormValues();
    const nextContainers = [...(syncedValues.containers || [])];
    const fallbackName = syncedValues.name
      ? `${syncedValues.name}-${nextContainers.length + 1}`
      : `container-${nextContainers.length + 1}`;
    nextContainers.push(createEmptyContainer(fallbackName));
    form.setFieldsValue({ containers: nextContainers });
    setActiveContainerIndex(nextContainers.length - 1);
    syncContainerEditorToForm(nextContainers[nextContainers.length - 1]);
    setContainersVersion((v) => v + 1);
  }, [form, getSyncedFormValues, syncContainerEditorToForm]);

  const handleDuplicateContainer = useCallback(
    (index: number) => {
      const syncedValues = getSyncedFormValues();
      const nextContainers = [...(syncedValues.containers || [])];
      const current = nextContainers[index];
      if (!current) return;
      nextContainers.splice(index + 1, 0, {
        ...current,
        containerName: current.containerName
          ? `${current.containerName}-copy`
          : `container-${nextContainers.length + 1}`,
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
    },
    [form, getSyncedFormValues, syncContainerEditorToForm],
  );

  const handleRemoveContainer = useCallback(
    (index: number) => {
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
    },
    [form, getSyncedFormValues, message, syncContainerEditorToForm],
  );

  // 编辑模式：初始化表单数据
  useEffect(() => {
    if (!editData) return;
    try {
      const init = parseEditWorkloadFormInit(editData, defaultType);
      if (!init) return;
      form.setFieldsValue(init.formValues);
      setActiveContainerIndex(0);
      setYamlContent(init.yamlContent);
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

  // 监听工作负载类型变化
  const workloadType = Form.useWatch('workloadType', form) || defaultType;

  const buildWorkloadK8sResource = useCallback(
    (values: WorkloadFormValues) => buildK8sResource(values, allNadOptions),
    [allNadOptions],
  );

  // 表单数据转 YAML
  const formToYaml = useCallback(
    (values: WorkloadFormValues): string => {
      const resource = buildWorkloadK8sResource(values);
      return yaml.dump(resource, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
      });
    },
    [buildWorkloadK8sResource],
  );

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
      const workloadType =
        kind === 'statefulset' ? 'statefulset' : kind === 'daemonset' ? 'daemonset' : 'deployment';

      // 提取容器配置
      const podImagePullSecrets = (resource.spec?.template?.spec?.imagePullSecrets || []).map(
        (s: any) => s.name,
      );
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
          type: e?.valueFrom?.configMapKeyRef
            ? 'configMapKeyRef'
            : e?.valueFrom?.secretKeyRef
              ? 'secretKeyRef'
              : 'keyValue',
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
        livenessProbe: container.livenessProbe
          ? {
              enabled: true,
              type: container.livenessProbe.httpGet
                ? 'httpGet'
                : container.livenessProbe.tcpSocket
                  ? 'tcpSocket'
                  : 'exec',
              httpGet: container.livenessProbe.httpGet,
              tcpSocket: container.livenessProbe.tcpSocket,
              exec: container.livenessProbe.exec,
              initialDelaySeconds: container.livenessProbe.initialDelaySeconds || 30,
              periodSeconds: container.livenessProbe.periodSeconds || 10,
            }
          : { enabled: false, type: 'httpGet', initialDelaySeconds: 30, periodSeconds: 10 },
        readinessProbe: container.readinessProbe
          ? {
              enabled: true,
              type: container.readinessProbe.httpGet
                ? 'httpGet'
                : container.readinessProbe.tcpSocket
                  ? 'tcpSocket'
                  : 'exec',
              httpGet: container.readinessProbe.httpGet,
              tcpSocket: container.readinessProbe.tcpSocket,
              exec: container.readinessProbe.exec,
              initialDelaySeconds: container.readinessProbe.initialDelaySeconds || 5,
              periodSeconds: container.readinessProbe.periodSeconds || 10,
            }
          : { enabled: false, type: 'httpGet', initialDelaySeconds: 5, periodSeconds: 10 },
        volumeMounts: (container.volumeMounts || []).map((mount: any) => ({
          name: mount.name,
          mountPath: mount.mountPath,
          subPath: mount.subPath,
          readOnly: mount.readOnly,
        })),
        imagePullSecrets: index === 0 ? podImagePullSecrets : [],
      });

      const containers = (resource.spec?.template?.spec?.containers || []).map(
        (c: any, i: number) => parseContainer(c, i),
      );
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
            nodeSelectorTerms:
              nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms.map(
                (term: any) => ({
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
                }),
              ),
          };
        }

        if (nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution) {
          result.preferred = nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution.map(
            (pref: any) => ({
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
            }),
          );
        }

        return Object.keys(result).length > 0 ? result : undefined;
      };

      // 解析 Pod 亲和性配置
      const parsePodAffinityFromYaml = (podAffinity: any): PodAffinityConfig | undefined => {
        if (!podAffinity) return undefined;

        const result: PodAffinityConfig = {};

        // 解析 required 规则
        if (podAffinity.requiredDuringSchedulingIgnoredDuringExecution?.length) {
          result.required = podAffinity.requiredDuringSchedulingIgnoredDuringExecution.map(
            (term: any) => ({
              labelSelector: term.labelSelector
                ? {
                    matchLabels: term.labelSelector.matchLabels || {},
                    matchExpressions: (term.labelSelector.matchExpressions || []).map(
                      (expr: any) => ({
                        key: expr.key,
                        operator: expr.operator,
                        values: expr.values,
                      }),
                    ),
                  }
                : undefined,
              namespaces: term.namespaces,
              topologyKey: term.topologyKey,
            }),
          );
        }

        // 解析 preferred 规则
        if (podAffinity.preferredDuringSchedulingIgnoredDuringExecution?.length) {
          result.preferred = podAffinity.preferredDuringSchedulingIgnoredDuringExecution.map(
            (pref: any) => ({
              weight: pref.weight,
              podAffinityTerm: {
                labelSelector: pref.podAffinityTerm?.labelSelector
                  ? {
                      matchLabels: pref.podAffinityTerm.labelSelector.matchLabels || {},
                      matchExpressions: (
                        pref.podAffinityTerm.labelSelector.matchExpressions || []
                      ).map((expr: any) => ({
                        key: expr.key,
                        operator: expr.operator,
                        values: expr.values,
                      })),
                    }
                  : undefined,
                namespaces: pref.podAffinityTerm?.namespaces,
                topologyKey: pref.podAffinityTerm?.topologyKey,
              },
            }),
          );
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

      return {
        name,
        namespace,
        workloadType,
        labels: Object.entries(labels)
          .filter(([k]) => k !== 'app')
          .map(([key, value]) => ({ key, value: String(value) })),
        containers,
        ...toContainerEditorFields(firstContainer),
        replicas,
        nodeSelector: Object.entries(nodeSelector).map(([key, value]) => ({
          key,
          value: String(value),
        })),
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
  const handleModeChange = useCallback(
    (newMode: 'form' | 'yaml') => {
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
          setYamlContent(getDefaultWorkloadYaml(workloadType));
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
    },
    [
      mode,
      form,
      formToYaml,
      yamlToForm,
      yamlContent,
      message,
      workloadType,
      isEditMode,
      editData,
      buildWorkloadK8sResource,
      getSyncedFormValues,
    ],
  );

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
  const handleYamlChange = useCallback(
    (value: string) => {
      setYamlContent(value);
      validateYaml(value);
    },
    [validateYaml],
  );

  const confirmStaticIpRisk = useCallback(
    (staticIP: string) =>
      new Promise<boolean>((resolve) => {
        void confirmHighRiskOperation({
          title: '静态 IP 冲突风险',
          description: (
            <div>
              <p>
                无法自动检测 IP <strong>{staticIP}</strong> 是否已被使用。
              </p>
            </div>
          ),
          riskItems: [
            '若该 IP 已被其他工作负载占用，可能导致网络冲突或服务不可达。',
            '请确认该 IP 在目标子网内空闲且符合网络规划后再继续提交。',
          ],
          requireTypeConfirm: false,
          operationSummary: `使用静态 IP ${staticIP} 提交工作负载`,
          confirmText: '确认未使用，继续提交',
          onConfirm: () => {
            resolve(true);
          },
        }).catch(() => resolve(false));
      }),
    [],
  );

  // 提交表单
  const handleSubmit = useCallback(async () => {
    try {
      const isYamlValid = mode !== 'yaml' || validateYaml(yamlContent);

      const prepared = await prepareWorkloadSubmit({
        mode,
        yamlContent,
        isYamlValid,
        form,
        getSyncedFormValues,
        buildResource: buildWorkloadK8sResource,
        isEditMode,
        editMetadata: editMetadata ?? null,
        editData,
        cloudId,
        flatSubnetOptions,
        kubeSubnets,
        editorRefs: {
          nodeAffinity: nodeAffinityEditorRef.current?.getHasLabelErrors(),
          nodeAntiAffinity: nodeAntiAffinityEditorRef.current?.getHasLabelErrors(),
          podAffinity: podAffinityEditorRef.current?.getHasLabelErrors(),
          podAntiAffinity: podAntiAffinityEditorRef.current?.getHasLabelErrors(),
          tolerations: tolerationsEditorRef.current?.getHasLabelErrors(),
        },
        confirmStaticIpRisk,
      });

      if (!prepared.ok) {
        applyWorkloadSubmitFailure(prepared.failure, {
          message,
          setCurrentStep,
          setActiveContainerIndex,
          syncContainerEditorToForm,
        });
        return;
      }

      setLoading(true);
      await executeWorkloadSubmit({
        cloudId,
        isEditMode,
        payload: prepared.payload,
        message,
        onSuccess,
      });
    } catch (error: unknown) {
      handleWorkloadSubmitError({ error, isEditMode, message, onSuccess });
    } finally {
      setLoading(false);
    }
  }, [
    mode,
    yamlContent,
    validateYaml,
    form,
    buildWorkloadK8sResource,
    cloudId,
    message,
    onSuccess,
    isEditMode,
    getSyncedFormValues,
    syncContainerEditorToForm,
    editMetadata,
    editData,
    flatSubnetOptions,
    kubeSubnets,
    confirmStaticIpRisk,
  ]);

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

  const handleStepClick = useCallback(
    async (targetStep: number) => {
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
    },
    [currentStep, form, persistActiveContainerToForm],
  );

  const getFormSummary = useCallback(() => {
    const values = getSyncedFormValues();
    const containers = values.containers || [];

    // 网络配置摘要
    let networkSummary = '默认网络';
    if (values.networkType === 'flat_subnet') {
      networkSummary = values.flatSubnet ? `扁平子网: ${values.flatSubnet}` : '扁平子网';
    } else if (values.networkType === 'vpc') {
      networkSummary = values.vpcSubnet
        ? `VPC: ${values.vpcName || '-'}/${values.vpcSubnet}`
        : 'VPC子网';
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

  const syncedContainers = getSyncedFormValues().containers || [];

  return (
    <div>
      {/* 模式切换 */}
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Segmented
          value={mode}
          onChange={(v) => handleModeChange(v as 'form' | 'yaml')}
          options={[
            {
              value: 'form',
              label: (
                <span>
                  <FormOutlined /> 表单模式
                </span>
              ),
            },
            {
              value: 'yaml',
              label: (
                <span>
                  <CodeOutlined /> YAML 模式
                </span>
              ),
            },
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
              containers: [
                createEmptyContainer(
                  defaultType === 'daemonset' ? 'daemonset-container' : 'main-container',
                ),
              ],
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
              livenessProbe: {
                enabled: false,
                type: 'httpGet' as const,
                initialDelaySeconds: 30,
                periodSeconds: 10,
              },
              readinessProbe: {
                enabled: false,
                type: 'httpGet' as const,
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              volumes: [],
              volumeMounts: [],
              // 网络配置默认值
              networkType: 'default',
              enableStaticIP: false,
            }}
          >
            <Row gutter={[0, 0]} style={{ height: '100%' }}>
              <Col span={5}>
                <div
                  className="wizard-sidebar"
                  style={{ padding: '0 8px 0 0', minHeight: 'calc(80vh - 24px)' }}
                >
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
                <div
                  style={{
                    height: 'calc(80vh - 24px)',
                    overflowY: 'auto',
                    padding: '0 30px',
                    scrollbarGutter: 'stable',
                  }}
                >
                  <WorkloadFormStepContent
                    currentStep={currentStep}
                    basic={{
                      isEditMode,
                      editResourceId: editMetadata?.name,
                      defaultType,
                      defaultNamespace,
                      namespacesOptions,
                      workloadType,
                    }}
                    containers={{
                      containers: syncedContainers,
                      activeContainerIndex,
                      onSelectContainer: handleSelectContainer,
                      onDuplicateContainer: handleDuplicateContainer,
                      onRemoveContainer: handleRemoveContainer,
                      onAddContainer: handleAddContainer,
                      onBrowseRegistry: handleBrowseRegistry,
                      cloudId,
                      defaultNamespace,
                      namespacesOptions,
                      imagePullSecrets,
                      configMaps,
                      secrets,
                      onRefreshConfigMaps: () => onRefreshConfigMaps?.(),
                      onRefreshSecrets: () => onRefreshSecrets?.(),
                      onOpenQuickCreateConfigMap: () => setShowQuickCreateConfigMap(true),
                      onOpenQuickCreateSecret: () => setShowQuickCreateSecret(true),
                    }}
                    network={{
                      cloudId,
                      hideFlatSubnet,
                      loadingNetworkData,
                      isFlatVpc,
                      flatSubnetOptions,
                      vpcOptions,
                      vpcSubnetOptions,
                      selectedVpc,
                      allNadOptions,
                      reloadNads,
                      kubeSubnets,
                    }}
                    storage={{
                      containers: syncedContainers,
                      activeContainerIndex,
                      onSelectContainer: handleSelectContainer,
                      volumeRefreshKey,
                      onVolumeRefresh: () => setVolumeRefreshKey((v) => v + 1),
                      volumesEditorProps: {
                        cloudId,
                        namespacesOptions,
                        selectedNamespace:
                          form.getFieldValue('namespace') || defaultNamespace || 'default',
                        configMaps,
                        secrets,
                        persistentVolumeClaims,
                        onRefreshConfigMaps: () => onRefreshConfigMaps?.(),
                        onRefreshSecrets: () => onRefreshSecrets?.(),
                        onOpenQuickCreateConfigMap: () => setShowQuickCreateConfigMap(true),
                        onOpenQuickCreateSecret: () => setShowQuickCreateSecret(true),
                      },
                    }}
                    advanced={{
                      namespacesOptions,
                      nodeAffinityEditorRef,
                      nodeAntiAffinityEditorRef,
                      podAffinityEditorRef,
                      podAntiAffinityEditorRef,
                      tolerationsEditorRef,
                    }}
                  />
                </div>
              </Col>

              <Col span={7} style={{ height: '100%' }}>
                <div
                  style={{
                    background: '#fff',
                    border: '1px solid #eaeaea',
                    borderRadius: 8,
                    padding: 16,
                    height: 'calc(80vh - 24px)',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      borderBottom: '1px solid #f0f0f0',
                      paddingBottom: 12,
                      marginBottom: 12,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 500 }}>配置预览</span>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '8px 0',
                          borderBottom: '1px dashed #f0f0f0',
                        }}
                      >
                        <span style={{ color: '#888' }}>名称</span>
                        <span style={{ color: '#333', fontWeight: 500 }}>{summary.name}</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '8px 0',
                          borderBottom: '1px dashed #f0f0f0',
                        }}
                      >
                        <span style={{ color: '#888' }}>项目</span>
                        <span style={{ color: '#333' }}>{summary.namespace}</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '8px 0',
                          borderBottom: '1px dashed #f0f0f0',
                        }}
                      >
                        <span style={{ color: '#888' }}>类型</span>
                        <span style={{ color: '#333' }}>{summary.workloadType}</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '8px 0',
                          borderBottom: '1px dashed #f0f0f0',
                        }}
                      >
                        <span style={{ color: '#888' }}>副本</span>
                        <span style={{ color: '#333' }}>{summary.replicas}</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '8px 0',
                          borderBottom: '1px dashed #f0f0f0',
                        }}
                      >
                        <span style={{ color: '#888' }}>镜像凭证</span>
                        <span style={{ color: '#333' }}>{summary.imagePullSecrets} 个</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '8px 0',
                          borderBottom: '1px dashed #f0f0f0',
                        }}
                      >
                        <span style={{ color: '#888' }}>存储卷</span>
                        <span style={{ color: '#333' }}>{summary.volumes} 个</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '8px 0',
                          borderBottom: '1px dashed #f0f0f0',
                        }}
                      >
                        <span style={{ color: '#888' }}>网络</span>
                        <span
                          style={{
                            color: '#333',
                            maxWidth: '60%',
                            textAlign: 'right',
                            wordBreak: 'break-all',
                          }}
                        >
                          {summary.network}
                        </span>
                      </div>
                      <div style={{ padding: '8px 0' }}>
                        <div style={{ color: '#888', marginBottom: 8 }}>容器列表</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {summary.containers.map((container, index) => (
                            <div
                              key={container.key}
                              style={{
                                border: '1px solid #f0f0f0',
                                borderRadius: 8,
                                padding: 10,
                                background: index === activeContainerIndex ? '#f8fbff' : '#fff',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  marginBottom: 4,
                                }}
                              >
                                <span style={{ fontWeight: 500 }}>{container.name}</span>
                                <Tag
                                  color={index === activeContainerIndex ? 'blue' : 'default'}
                                >{`容器 ${index + 1}`}</Tag>
                              </div>
                              <div style={{ fontSize: 12, color: '#666', wordBreak: 'break-all' }}>
                                {container.image}
                              </div>
                              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                                端口 {container.ports} / 环境变量 {container.env} / 挂载{' '}
                                {container.mounts}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #f0f0f0' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <Button htmlType="button" onClick={onCancel}>
                        取消
                      </Button>
                      {currentStep > 0 && (
                        <Button htmlType="button" onClick={handlePrev}>
                          上一步
                        </Button>
                      )}
                      {currentStep < WORKLOAD_STEPS.length - 1 ? (
                        <Button type="primary" htmlType="button" onClick={handleNext}>
                          下一步
                        </Button>
                      ) : (
                        <Button
                          type="primary"
                          htmlType="button"
                          loading={loading}
                          onClick={handleSubmit}
                        >
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
          <WorkloadFormYamlPanel
            yamlContent={yamlContent}
            yamlError={yamlError}
            onYamlChange={handleYamlChange}
          />

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

export type { WorkloadType, WorkloadFormValues, WorkloadFormProps } from './workloadForm/types';

export default WorkloadForm;
