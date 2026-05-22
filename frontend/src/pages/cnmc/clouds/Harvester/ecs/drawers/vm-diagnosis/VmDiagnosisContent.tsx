/** 诊断 UI 与编排；纯逻辑见 `./lib/` */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, Descriptions, Tag, Alert, Space, Button, Spin, Empty, Typography, Collapse, Steps } from 'antd';
import { 
  CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, 
  ReloadOutlined, InfoCircleOutlined, WarningOutlined, LoadingOutlined 
} from '@ant-design/icons';
import { fetchHarvesterVMAggregated } from 'services/harvester/vm';
import { fetchHarvesterNodes, fetchHarvesterVolume } from '../../../../../../../services/harvesterApi';
import { fetchHarvesterResourceByLink } from 'services/harvester/resource';
import { fetchHarvesterVmPod, fetchHarvesterEvents } from '../../../../../../../services/loggingApi';
import type { DiagnosisResult, DiagnosisStep, StepStatus } from "./lib/diagnosisTypes";
import {
  VM_DIAGNOSIS_SECTION_GAP,
  VM_DIAGNOSIS_TEXT_SECONDARY,
  DIAG_STEP_CONTENT_CARD,
  DIAG_DESC_INNER,
  DIAG_PAGE_SHELL_STYLE,
  diagNodeResourceBlock,
} from "./lib/uiTokens";
import { parseCpuToCores, parseMemoryToBytes } from "./lib/parseResourceQuantity";
import { fetchVirtLauncherPodLogSummary } from "./lib/virtLauncherPodLog";
import { analyzeDiagnosticsEvents } from "./lib/analyzeDiagnosticsEvents";
import { analyzeVmMultusNetworkStatus } from "./lib/analyzeVmMultusNetworkStatus";

const { Text } = Typography;
const { Panel } = Collapse;

export interface VmDiagnosisContentProps {
  cloudId?: string;
  record: any;
  active: boolean;
}

const VmDiagnosisContent: React.FC<VmDiagnosisContentProps> = ({
  cloudId,
  record,
  active,
}) => {
  const [loading, setLoading] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState<string>('');
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [steps, setSteps] = useState<DiagnosisStep[]>([]);
  const [refreshingEvents, setRefreshingEvents] = useState(false);
  const stepTimeoutRef = useRef<NodeJS.Timeout[]>([]);
  const animateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  const namespace = record?.metadata?.namespace || record?.namespace || 'default';
  const name = record?.metadata?.name || record?.name || '';

  const loadDiagnosis = useCallback(async () => {
    if (!active || !cloudId || !namespace || !name) return;

    setLoading(true);
    setError('');
    try {
      // 并行获取所有诊断信息
      const [vmAggregatedRes, podRes, vmiEventsRes, nodesRes] = await Promise.allSettled([
        fetchHarvesterVMAggregated(cloudId, namespace, name).catch(() => null),
        fetchHarvesterVmPod(cloudId, namespace, name).catch(() => ({ podName: null })),
        fetchHarvesterEvents(cloudId, namespace, name, 'VirtualMachineInstance').catch(() => ({ data: [] })),
        fetchHarvesterNodes(cloudId).catch(() => null)
      ]);

      const vmAggregated = vmAggregatedRes.status === 'fulfilled' ? vmAggregatedRes.value : null;
      // 处理返回结构：可能是 { vm, related } 或 { data: { vm, related } }
      const aggregatedData = vmAggregated?.data || vmAggregated;
      const vmData = aggregatedData?.vm || vmAggregated || record;
      const vmiData = aggregatedData?.vm?.vmi || vmAggregated?.vmi || null;
      const podData = podRes.status === 'fulfilled' ? podRes.value : null;
      const vmiEventsData = vmiEventsRes.status === 'fulfilled' ? vmiEventsRes.value?.data || [] : [];
      const nodesData = nodesRes.status === 'fulfilled' ? nodesRes.value : null;
      const nodes = (nodesData as any)?.data?.items || (nodesData as any)?.items || [];
      const nodesChecked = Array.isArray(nodes);

      // 判断 VM 运行状态
      const vmStatusObj = vmData?.status || {};
      const vmRunning = vmStatusObj.printableStatus === 'Running' || vmStatusObj.ready === true;
      const podExists = !!podData?.podName;
      
      // 判断 VMI 是否存在：
      // 1. 直接检查 vmiData 是否有有效的 metadata
      // 2. 检查 vmData.status.phase（后端会将 VMI 状态合并到 VM status 中）
      // 3. 如果 VM 状态是 Running，认为 VMI 存在
      // 4. 如果 Pod 存在，也认为 VMI 存在
      const vmiExistsDirect = vmiData && (vmiData.metadata?.name || vmiData.name);
      const vmiPhaseInVmStatus = vmStatusObj.phase; // VMI phase 可能已合并到 VM status
      const effectiveVmiExists = vmiExistsDirect || !!vmiPhaseInVmStatus || vmRunning || podExists;
      
      console.debug('[诊断] VMI 判断:', {
        vmiExistsDirect,
        vmiPhaseInVmStatus,
        vmRunning,
        podExists,
        effectiveVmiExists,
        vmStatus: vmStatusObj.printableStatus,
        vmPhase: vmStatusObj.phase,
        vmReady: vmStatusObj.ready,
        podName: podData?.podName,
        vmiData: vmiData ? 'exists' : 'null',
        vmDataStatus: vmStatusObj
      });

      // 获取 Pod 事件
      // 策略：查询命名空间下所有 Pod 事件，然后过滤出与 VM 相关的 Pod
      // 因为 Pod 创建失败时可能找不到 Pod，所以不能通过 Pod 名称查询
      let podEventsData: any[] = [];
      try {
        // 查询命名空间下所有 Pod 事件
        const allPodEventsRes = await fetchHarvesterEvents(cloudId, namespace, undefined, 'Pod');
        const allPodEvents = allPodEventsRes?.data || [];
        
        // 过滤出与当前 VM 相关的 Pod 事件
        // Pod 名称格式：virt-launcher-{vm-name}-{random}
        const vmNamePattern = new RegExp(`virt-launcher-${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`, 'i');
        podEventsData = allPodEvents.filter((e: any) => {
          const podName = e.involvedObject?.name || '';
          const message = e.message || '';
          // 匹配 Pod 名称或事件消息中包含 VM 相关的 Pod 名称
          return vmNamePattern.test(podName) || vmNamePattern.test(message);
        });
      } catch (e) {
        console.warn('获取 Pod 事件失败:', e);
      }

      // 合并所有事件，按时间排序
      const allEvents = [...vmiEventsData, ...podEventsData].sort((a: any, b: any) => {
        const timeA = new Date(a.lastTimestamp || a.firstTimestamp || 0).getTime();
        const timeB = new Date(b.lastTimestamp || b.firstTimestamp || 0).getTime();
        return timeB - timeA; // 降序
      });

      // 分析节点亲和性
      const nodeAffinity = analyzeNodeAffinity(vmData, nodesChecked ? nodes : null);
      
      // 分析节点选择器
      const nodeSelector = analyzeNodeSelector(vmData, nodesChecked ? nodes : null);
      
      // 构建 VMI 状态对象（先构建，以便后续使用 nodeName）
      // 优先级：1. vmiData.status (原始 VMI 状态) 2. vmData.status (已合并的 VMI 状态) 3. 推断状态
      let vmiStatusObj = null;
      if (effectiveVmiExists) {
        if (vmiData?.status) {
          // 使用实际的 VMI 状态（最准确）
          vmiStatusObj = vmiData.status;
        } else if (vmStatusObj.phase) {
          // VMI 状态已合并到 VM status 中（后端会将 VMI status 合并到 VM status）
          // 这是最常见的情况：VMI 存在时，其 phase、nodeName、interfaces 会合并到 VM.status
          vmiStatusObj = {
            phase: vmStatusObj.phase,
            nodeName: vmStatusObj.nodeName,
            interfaces: vmStatusObj.interfaces || []
          };
        } else if (vmRunning) {
          // VM 状态是 Running，说明 VMI 一定存在且运行中
          // 尝试从 VM status 中提取 VMI 相关信息
          vmiStatusObj = { 
            phase: vmStatusObj.phase || 'Running', // 优先使用已合并的 phase
            nodeName: vmStatusObj.nodeName || null,
            interfaces: vmStatusObj.interfaces || []
          };
        } else if (podExists) {
          // Pod 存在但 VM 状态不是 Running，可能是启动中
          // 但也要检查是否有 phase 信息
          vmiStatusObj = { 
            phase: vmStatusObj.phase || 'Pending',
            nodeName: vmStatusObj.nodeName || null,
            interfaces: vmStatusObj.interfaces || []
          };
        }
      }
      
      console.debug('[诊断] VMI 状态对象:', {
        vmiStatusObj,
        vmStatusPhase: vmStatusObj.phase,
        vmStatusNodeName: vmStatusObj.nodeName,
        vmStatusInterfaces: vmStatusObj.interfaces,
        vmRunning,
        podExists,
        effectiveVmiExists
      });

      // 提取资源需求（在 vmiStatusObj 构建后）
      const resources = await extractResourcesWithNodeCheck(vmData, cloudId, nodesChecked ? nodes : null, vmiStatusObj?.nodeName, nodeAffinity);
      
      // 分析 PVC 状态
      const relatedVolumes = aggregatedData?.related?.volumes || [];
      const pvcStatus = await analyzePVCStatus(vmData, cloudId, namespace, Array.isArray(relatedVolumes) ? relatedVolumes : null);
      
      // 分析网络配置
      const networkStatus = analyzeVmMultusNetworkStatus(vmData);

      const podLogs = podData?.podName ? await fetchVirtLauncherPodLogSummary(cloudId, namespace, podData.podName) : undefined;

      // 分析事件模式，检测 Pod 频繁创建/删除循环（使用合并后的事件）
      // 传入 VM 状态和 Pod 信息，以便正确判断运行状态
      // 传入 VM 对象以便检查是否是克隆的虚拟机
      // 传入 PVC 状态以便检查 PVC 是否存在（对于克隆的虚拟机，PVC 可能未创建）
      const eventAnalysis = analyzeDiagnosticsEvents(allEvents, vmData?.status, podData, vmData, pvcStatus);

      const diagnosisResult: DiagnosisResult = {
        vmStatus: vmData?.status,
        vmiStatus: vmiStatusObj,
        podInfo: podData,
        podLogs,
        events: allEvents.slice(0, 30), // 最近30条事件（包含 Pod 和 VMI 事件）
        nodeAffinity,
        nodeSelector,
        resources,
        pvcStatus,
        networkStatus,
        eventAnalysis, // 使用上面已经分析好的结果
      };

      setDiagnosis(diagnosisResult);
      
      // 启动逐步检查动画
      if (animateTimeoutRef.current) {
        clearTimeout(animateTimeoutRef.current);
      }
      animateTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          animateSteps(diagnosisResult);
        }
      }, 100);
    } catch (e: any) {
      console.error('诊断失败:', e);
      setError(e?.message || '诊断失败');
    } finally {
      setLoading(false);
    }
    // animateSteps / extractResourcesWithNodeCheck 为组件内函数，列入依赖会导致 loadDiagnosis 频繁变化并触发重复拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随 cloudId/namespace/name/active 刷新诊断
  }, [active, cloudId, namespace, name]);

  useEffect(() => {
    isMountedRef.current = true;
    if (active) {
      loadDiagnosis();
    }
    // 清理定时器
    return () => {
      isMountedRef.current = false;
      stepTimeoutRef.current.forEach(timer => clearTimeout(timer));
      stepTimeoutRef.current = [];
      if (animateTimeoutRef.current) {
        clearTimeout(animateTimeoutRef.current);
        animateTimeoutRef.current = null;
      }
    };
  }, [active, loadDiagnosis]);

  // 逐步检查动画效果
  const animateSteps = useCallback((diagnosisData: DiagnosisResult) => {
    // 清理之前的定时器
    stepTimeoutRef.current.forEach(timer => clearTimeout(timer));
    stepTimeoutRef.current = [];
    setCurrentStep(0);

    const vmStatus = diagnosisData.vmStatus;
    const vmiStatus = diagnosisData.vmiStatus;
    const isVMError = vmStatus?.printableStatus === 'ErrorUnschedulable' || 
                      vmStatus?.printableStatus === 'ErrorPvcNotFound' ||
                      vmStatus?.conditions?.some((c: any) => c.status === 'False' && c.type === 'Ready');

    // 定义所有诊断步骤（延迟创建内容，在渲染时再调用）
    const createStepContent = (stepKey: string) => {
      switch (stepKey) {
        case 'vm-status':
          return renderVmStatus(vmStatus, isVMError);
        case 'vmi-status':
          return renderVmiStatus(vmiStatus, diagnosisData);
        case 'pod-info':
          return renderPodInfo(diagnosisData.podInfo, diagnosisData);
        case 'node-affinity':
          return renderNodeAffinity(diagnosisData.nodeAffinity);
        case 'node-selector':
          return renderNodeSelector(diagnosisData.nodeSelector);
        case 'resources':
          return renderResources(diagnosisData.resources);
        case 'pvc-status':
          return renderPvcStatus(diagnosisData.pvcStatus || []);
        case 'network':
          return renderNetworkStatus(diagnosisData.networkStatus);
        case 'events':
          return renderEventAnalysis(diagnosisData.eventAnalysis, diagnosisData.events || []);
        case 'summary':
          return renderSummary(diagnosisData, isVMError, vmiStatus);
        default:
          return null;
      }
    };

    const allSteps: DiagnosisStep[] = [
      {
        key: 'vm-status',
        title: '检查虚拟机状态',
        description: '检查 VM 资源状态和 Ready 条件',
        status: 'wait',
        content: createStepContent('vm-status')
      },
      {
        key: 'vmi-status',
        title: '检查虚拟机实例 (VMI)',
        description: '检查 VMI 是否存在及运行状态',
        status: 'wait',
        content: createStepContent('vmi-status')
      },
      {
        key: 'pod-info',
        title: '检查虚拟机运行容器',
        description: '检查虚拟机运行所需的容器是否正常创建和运行',
        status: 'wait',
        content: createStepContent('pod-info')
      },
      {
        key: 'node-affinity',
        title: '检查节点亲和性',
        description: '检查节点调度约束',
        status: 'wait',
        content: createStepContent('node-affinity')
      },
      {
        key: 'node-selector',
        title: '检查节点选择器',
        description: '检查节点选择器配置',
        status: 'wait',
        content: createStepContent('node-selector')
      },
      {
        key: 'resources',
        title: '检查资源需求',
        description: '检查虚拟机资源需求和节点资源可用性',
        status: 'wait',
        content: createStepContent('resources')
      },
      {
        key: 'pvc-status',
        title: '检查存储卷 (PVC)',
        description: '检查 PVC 绑定状态',
        status: 'wait',
        content: createStepContent('pvc-status')
      },
      {
        key: 'network',
        title: '检查网络配置',
        description: '检查 Multus 网络配置',
        status: 'wait',
        content: createStepContent('network')
      },
      {
        key: 'events',
        title: '分析事件',
        description: '分析最近事件和错误模式',
        status: 'wait',
        content: createStepContent('events')
      },
      {
        key: 'summary',
        title: '诊断总结',
        description: '生成诊断建议',
        status: 'wait',
        content: createStepContent('summary')
      }
    ];

    // 根据检查结果确定步骤状态（移到内部避免闭包问题）
    const getStepStatus = (stepKey: string, diagnosis: DiagnosisResult, isVMError: boolean, vmiStatus: any): StepStatus => {
      switch (stepKey) {
        case 'vm-status':
          return isVMError ? 'error' : 'finish';
        case 'vmi-status':
          return vmiStatus ? 'finish' : 'error';
        case 'pod-info':
          return diagnosis.podInfo?.podName ? 'finish' : 'error';
        case 'node-affinity':
          if (!diagnosis.nodeAffinity?.required) return 'finish';
          if (!diagnosis.nodeAffinity.valid) return 'error';
          if (!diagnosis.nodeAffinity.checked) return 'finish';
          return diagnosis.nodeAffinity.nodesWithLabel > 0 ? 'finish' : 'error';
        case 'node-selector':
          if (!diagnosis.nodeSelector?.configured) return 'finish';
          if (!diagnosis.nodeSelector.checked) return 'finish';
          // 如果配置了节点选择器但没有匹配的节点，返回错误
          const matchedCount = diagnosis.nodeSelector.matchedNodeNames?.length || 0;
          return matchedCount > 0 ? 'finish' : 'error';
        case 'resources': {
          const nodeCheck = diagnosis.resources?.nodeResourceCheck;
          if (nodeCheck?.checked && !nodeCheck.sufficient) return 'error';
          return diagnosis.resources ? 'finish' : 'finish';
        }
        case 'pvc-status': {
          const pvcs: any[] = Array.isArray(diagnosis.pvcStatus) ? diagnosis.pvcStatus : [];
          if (pvcs.length === 0) return 'finish';
          const checked = pvcs.filter((p: any) => p?.checked === true);
          if (checked.some((p: any) => p?.exists === false)) return 'error';
          // 检查是否真正就绪（不仅 Bound，还要没有进行中的操作）
          const allReady = checked.filter((p: any) => p?.exists === true).every((p: any) => p?.isReady === true);
          if (!allReady) {
            // 如果存在但未就绪，检查是否有进行中的操作
            const hasResizing = checked.some((p: any) => p?.isResizing === true);
            const hasFsPending = checked.some((p: any) => p?.isFsResizePending === true);
            if (hasResizing || hasFsPending) return 'process'; // 使用 process 表示进行中
            // 如果未绑定，返回错误
            if (checked.some((p: any) => p?.exists === true && p?.bound === false)) return 'error';
            return 'error'; // 其他未就绪情况返回错误
          }
          return 'finish';
        }
        case 'network':
          return diagnosis.networkStatus ? 'finish' : 'finish';
        case 'events':
          if (diagnosis.eventAnalysis?.podCreateDeleteCycle) return 'error';
          if (diagnosis.eventAnalysis?.recentPattern === '存储卷挂载冲突') return 'error';
          if (diagnosis.eventAnalysis?.recentPattern === 'IP 地址池耗尽') return 'error';
          if (diagnosis.eventAnalysis?.recentPattern === '网络配置错误') return 'error';
          return 'finish';
        case 'summary':
          return 'finish';
        default:
          return 'finish';
      }
    };

    // 逐步显示每个步骤，每个步骤间隔 300ms
    allSteps.forEach((step, index) => {
      const timer = setTimeout(() => {
        if (!isMountedRef.current) return;
        setSteps(prev => {
          const newSteps = [...prev];
          // 将当前步骤设为进行中
          if (newSteps[index]) {
            newSteps[index].status = 'process';
          }
          return newSteps;
        });
        setCurrentStep(index);

        // 300ms 后完成当前步骤
        const finishTimer = setTimeout(() => {
          if (!isMountedRef.current) return;
          setSteps(prev => {
            const newSteps = [...prev];
            if (newSteps[index]) {
              // 根据检查结果设置状态
              const stepStatus = getStepStatus(step.key, diagnosisData, isVMError, vmiStatus);
              newSteps[index].status = stepStatus;
            }
            return newSteps;
          });
        }, 300);
        stepTimeoutRef.current.push(finishTimer);
      }, index * 300);
      stepTimeoutRef.current.push(timer);
    });

    // 初始化所有步骤为等待状态
    if (isMountedRef.current) {
      setSteps(allSteps);
    }
    // createStepContent 依赖的 render* 在每次渲染都会新建，列入依赖会导致步骤动画回调不稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analyzeNodeAffinity = (vm: any, nodes: any[] | null): DiagnosisResult['nodeAffinity'] => {
    if (!vm?.spec?.template?.spec?.affinity?.nodeAffinity) {
      return {
        required: false,
        valid: true,
        checked: false,
        label: '',
        nodesWithLabel: 0,
        totalNodes: Array.isArray(nodes) ? nodes.length : undefined,
        message: '未配置节点亲和性'
      };
    }

    const required = vm.spec.template.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution;
    const terms = Array.isArray(required?.nodeSelectorTerms) ? required.nodeSelectorTerms : [];
    if (terms.length === 0 || !terms.some((t: any) => Array.isArray(t?.matchExpressions) && t.matchExpressions.length > 0)) {
      return {
        required: true,
        valid: false,
        checked: false,
        label: '',
        nodesWithLabel: 0,
        totalNodes: Array.isArray(nodes) ? nodes.length : undefined,
        message: '节点亲和性配置不完整'
      };
    }

    const formatRequirement = (expr: any): string => {
      const key = String(expr?.key || '').trim();
      const op = String(expr?.operator || 'In').trim();
      const values: string[] = Array.isArray(expr?.values) ? expr.values.map((v: any) => String(v)) : [];
      if (!key) return '-';
      if (op === 'Exists') return `${key} 存在`;
      if (op === 'DoesNotExist') return `${key} 不存在`;
      if (op === 'NotIn') return `${key} ∉ [${values.join(', ')}]`;
      if (op === 'Gt') return `${key} > ${values[0] ?? ''}`.trim();
      if (op === 'Lt') return `${key} < ${values[0] ?? ''}`.trim();
      return `${key} ∈ [${values.join(', ')}]`;
    };

    const formatTerm = (term: any): string => {
      const exprs: any[] = Array.isArray(term?.matchExpressions) ? term.matchExpressions : [];
      return exprs.length > 0 ? exprs.map(formatRequirement).join(' 且 ') : '-';
    };

    const label = terms.length === 1 ? formatTerm(terms[0]) : terms.map((t: any) => `(${formatTerm(t)})`).join(' 或 ');

    const getLabels = (node: any): Record<string, string> => {
      const labelsObj = node?.metadata?.labels || node?.labels || {};
      return labelsObj && typeof labelsObj === 'object' ? labelsObj : {};
    };

    const reqMatches = (labelsObj: Record<string, string>, expr: any): boolean => {
      const key = String(expr?.key || '').trim();
      const op = String(expr?.operator || 'In').trim();
      const values: string[] = Array.isArray(expr?.values) ? expr.values.map((v: any) => String(v)) : [];
      if (!key) return false;
      const hasKey = Object.prototype.hasOwnProperty.call(labelsObj, key);
      const val = hasKey ? String((labelsObj as any)[key]) : '';

      if (op === 'Exists') return hasKey;
      if (op === 'DoesNotExist') return !hasKey;
      if (!hasKey) return false;
      if (op === 'In') return values.includes(val);
      if (op === 'NotIn') return !values.includes(val);
      if (op === 'Gt') return Number(val) > Number(values[0]);
      if (op === 'Lt') return Number(val) < Number(values[0]);
      return false;
    };

    const termMatches = (labelsObj: Record<string, string>, term: any): boolean => {
      const exprs: any[] = Array.isArray(term?.matchExpressions) ? term.matchExpressions : [];
      if (exprs.length === 0) return false;
      return exprs.every((e: any) => reqMatches(labelsObj, e));
    };

    const matchedNodeNames =
      Array.isArray(nodes)
        ? nodes
            .filter((n: any) => {
              const labelsObj = getLabels(n);
              return terms.some((t: any) => termMatches(labelsObj, t));
            })
            .map((n: any) => String(n?.name || n?.metadata?.name || '').trim())
            .filter(Boolean)
        : [];

    return {
      required: true,
      valid: true,
      checked: Array.isArray(nodes),
      label,
      nodesWithLabel: matchedNodeNames.length,
      totalNodes: Array.isArray(nodes) ? nodes.length : undefined,
      matchedNodeNames: matchedNodeNames.slice(0, 5),
      message: Array.isArray(nodes) ? '节点亲和性校验完成' : '已识别节点亲和性规则（未自动校验）'
    };
  };

  const analyzeNodeSelector = (vm: any, nodes: any[] | null): DiagnosisResult['nodeSelector'] => {
    const nodeSelector = vm?.spec?.template?.spec?.nodeSelector;
    
    // 如果没有配置节点选择器
    if (!nodeSelector || typeof nodeSelector !== 'object' || Object.keys(nodeSelector).length === 0) {
      return {
        configured: false,
        checked: false,
        selector: {},
        totalNodes: Array.isArray(nodes) ? nodes.length : undefined,
        message: '未配置节点选择器（自动调度）'
      };
    }

    // 获取节点标签
    const getLabels = (node: any): Record<string, string> => {
      const labelsObj = node?.metadata?.labels || node?.labels || {};
      return labelsObj && typeof labelsObj === 'object' ? labelsObj : {};
    };

    // 检查节点是否匹配选择器
    const matchedNodeNames = Array.isArray(nodes)
      ? nodes
          .filter((n: any) => {
            const labelsObj = getLabels(n);
            // 检查所有选择器条件是否都满足
            return Object.entries(nodeSelector).every(([key, value]) => {
              const nodeValue = labelsObj[key];
              return nodeValue !== undefined && String(nodeValue) === String(value);
            });
          })
          .map((n: any) => String(n?.name || n?.metadata?.name || '').trim())
          .filter(Boolean)
      : [];

    // 格式化选择器显示
    const selectorStr = Object.entries(nodeSelector)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');

    return {
      configured: true,
      checked: Array.isArray(nodes),
      selector: nodeSelector,
      matchedNodeNames: matchedNodeNames.slice(0, 10), // 最多显示10个匹配的节点
      totalNodes: Array.isArray(nodes) ? nodes.length : undefined,
      message: Array.isArray(nodes)
        ? matchedNodeNames.length > 0
          ? `找到 ${matchedNodeNames.length} 个匹配的节点（共 ${nodes.length} 个节点）`
          : `未找到匹配的节点（共 ${nodes.length} 个节点）`
        : `已识别节点选择器：${selectorStr}（未自动校验）`
    };
  };

  const extractResources = (vm: any): DiagnosisResult['resources'] => {
    if (!vm?.spec?.template?.spec?.domain?.resources) {
      return undefined;
    }

    const res = vm.spec.template.spec.domain.resources;
    return {
      cpuRequest: res.requests?.cpu || '未设置',
      memoryRequest: res.requests?.memory || '未设置',
      cpuLimit: res.limits?.cpu || '未设置',
      memoryLimit: res.limits?.memory || '未设置',
    };
  };

  // 检查节点是否符合调度策略（节点亲和性、污点容忍等）
  const getEligibleNodes = (vm: any, nodes: any[]): any[] => {
    if (!Array.isArray(nodes) || nodes.length === 0) return [];

    const eligibleNodes: any[] = [];

    // 获取节点选择器（优先级最高）
    const nodeSelector = vm?.spec?.template?.spec?.nodeSelector || {};

    // 获取节点亲和性规则
    const nodeAffinity = vm?.spec?.template?.spec?.affinity?.nodeAffinity;
    const requiredAffinity = nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution;

    // 获取污点容忍
    const tolerations = vm?.spec?.template?.spec?.tolerations || [];

    // 检查节点标签匹配函数（复用 analyzeNodeAffinity 中的逻辑）
    const getLabels = (node: any): Record<string, string> => {
      const labelsObj = node?.metadata?.labels || node?.labels || {};
      return labelsObj && typeof labelsObj === 'object' ? labelsObj : {};
    };

    const reqMatches = (labelsObj: Record<string, string>, expr: any): boolean => {
      const key = String(expr?.key || '').trim();
      const op = String(expr?.operator || 'In').trim();
      const values: string[] = Array.isArray(expr?.values) ? expr.values.map((v: any) => String(v)) : [];
      if (!key) return false;
      const hasKey = Object.prototype.hasOwnProperty.call(labelsObj, key);
      const val = hasKey ? String((labelsObj as any)[key]) : '';

      if (op === 'Exists') return hasKey;
      if (op === 'DoesNotExist') return !hasKey;
      if (!hasKey) return false;
      if (op === 'In') return values.includes(val);
      if (op === 'NotIn') return !values.includes(val);
      if (op === 'Gt') return Number(val) > Number(values[0]);
      if (op === 'Lt') return Number(val) < Number(values[0]);
      return false;
    };

    const termMatches = (labelsObj: Record<string, string>, term: any): boolean => {
      const exprs: any[] = Array.isArray(term?.matchExpressions) ? term.matchExpressions : [];
      if (exprs.length === 0) return false;
      return exprs.every((e: any) => reqMatches(labelsObj, e));
    };

    // 检查污点容忍
    const toleratesTaints = (node: any): boolean => {
      const taints = node?.spec?.taints || [];
      if (taints.length === 0) return true; // 没有污点，所有 Pod 都可以调度
      if (tolerations.length === 0) return taints.length === 0; // 没有容忍，只能调度到无污点的节点

      // 检查每个污点是否被容忍
      for (const taint of taints) {
        if (taint.effect === 'NoSchedule' || taint.effect === 'NoExecute') {
          let tolerated = false;
          for (const toleration of tolerations) {
            // 检查 key、operator、value、effect 是否匹配
            const keyMatch = !toleration.key || toleration.key === taint.key;
            const operatorMatch = !toleration.operator || toleration.operator === 'Equal' || toleration.operator === 'Exists';
            const valueMatch = !toleration.value || toleration.value === taint.value;
            const effectMatch = !toleration.effect || toleration.effect === taint.effect;
            
            if (keyMatch && operatorMatch && valueMatch && effectMatch) {
              tolerated = true;
              break;
            }
          }
          if (!tolerated) return false;
        }
      }
      return true;
    };

    // 检查节点是否符合要求
    for (const node of nodes) {
      const labelsObj = getLabels(node);

      // 优先级1: 检查节点选择器（如果配置了，必须完全匹配）
      let matchesNodeSelector = true;
      if (Object.keys(nodeSelector).length > 0) {
        matchesNodeSelector = Object.entries(nodeSelector).every(([key, value]) => {
          const nodeValue = labelsObj[key];
          return nodeValue !== undefined && String(nodeValue) === String(value);
        });
        // 如果节点选择器不匹配，直接跳过该节点
        if (!matchesNodeSelector) continue;
      }

      // 优先级2: 检查必需节点亲和性
      let matchesRequiredAffinity = true;
      if (requiredAffinity?.nodeSelectorTerms) {
        const terms = Array.isArray(requiredAffinity.nodeSelectorTerms) ? requiredAffinity.nodeSelectorTerms : [];
        if (terms.length > 0) {
          // 至少满足一个 term（OR 关系）
          matchesRequiredAffinity = terms.some((term: any) => termMatches(labelsObj, term));
        }
      }

      // 优先级3: 检查污点容忍
      const tolerates = toleratesTaints(node);

      // 如果满足节点选择器、必需亲和性和污点容忍，则节点符合条件
      if (matchesNodeSelector && matchesRequiredAffinity && tolerates) {
        eligibleNodes.push(node);
      }
    }

    // 如果既没有节点选择器也没有必需亲和性，所有节点都符合（只要满足污点容忍）
    const hasNodeSelector = Object.keys(nodeSelector).length > 0;
    const hasRequiredAffinity = requiredAffinity?.nodeSelectorTerms && requiredAffinity.nodeSelectorTerms.length > 0;
    if (!hasNodeSelector && !hasRequiredAffinity) {
      return nodes.filter((node: any) => toleratesTaints(node));
    }

    return eligibleNodes;
  };

  const extractResourcesWithNodeCheck = async (
    vm: any,
    cloudId: string,
    nodes: any[] | null,
    scheduledNodeName?: string | null,
    nodeAffinityResult?: any
  ): Promise<DiagnosisResult['resources']> => {
    const baseResources = extractResources(vm);
    if (!baseResources) {
      return undefined;
    }

    // 如果没有节点信息，只返回基础资源信息
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return {
        ...baseResources,
        nodeResourceCheck: {
          checked: false,
          sufficient: true,
          message: '无法检查节点资源（节点列表不可用）',
        },
      };
    }

    // 如果 VM 已经运行（已调度到节点），认为资源充足
    if (scheduledNodeName) {
      const scheduledNode = nodes.find((n: any) => {
        const nodeName = n?.metadata?.name || n?.name || '';
        return nodeName === scheduledNodeName;
      });

      if (scheduledNode) {
        // 获取节点资源信息用于显示（兼容多种数据格式）
        const rawData = scheduledNode?.rawData || scheduledNode?.data || scheduledNode;
        const allocatable = rawData?.status?.allocatable || scheduledNode?.status?.allocatable || scheduledNode?.allocatable || {};
        const capacity = rawData?.status?.capacity || scheduledNode?.status?.capacity || scheduledNode?.capacity || {};
        // 尝试多种路径获取资源信息
        const totalCpuStr = allocatable.cpu || capacity.cpu || scheduledNode?.cpu || rawData?.cpu || '';
        const totalMemoryStr = allocatable.memory || capacity.memory || scheduledNode?.memory || rawData?.memory || '';
        
        console.debug('[节点资源检查] 已运行节点资源:', {
          nodeName: scheduledNodeName,
          totalCpuStr,
          totalMemoryStr,
          allocatable,
          capacity,
          scheduledNodeKeys: Object.keys(scheduledNode || {}),
        });

        // 获取节点指标
        let nodeMetricsMap: Record<string, { cpuUsedCores: number; memUsedBytes: number }> = {};
        try {
          const metricsRes = await fetchHarvesterResourceByLink(cloudId, '/apis/metrics.k8s.io/v1beta1/nodes');
          const metricsItems: any[] = Array.isArray((metricsRes as any)?.items) ? (metricsRes as any).items : [];
          for (const item of metricsItems) {
            const name = item?.metadata?.name || '';
            const cpuUsed = parseCpuToCores(item?.usage?.cpu);
            const memUsed = parseMemoryToBytes(item?.usage?.memory);
            if (name) {
              nodeMetricsMap[name] = { cpuUsedCores: cpuUsed, memUsedBytes: memUsed };
            }
          }
        } catch (e) {
          console.warn('获取节点指标失败:', e);
        }

        const formatCpu = (cores: number): string => {
          if (cores >= 1) return `${cores.toFixed(2)} 核`;
          return `${(cores * 1000).toFixed(0)} 毫核`;
        };

        const formatMemory = (bytes: number): string => {
          if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(2)} GiB`;
          if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(2)} MiB`;
          return `${(bytes / 1024).toFixed(2)} KiB`;
        };

        const totalCpuCores = parseCpuToCores(totalCpuStr);
        const totalMemoryBytes = parseMemoryToBytes(totalMemoryStr);
        
        // 如果解析失败（返回0），说明数据格式不对，尝试其他方式
        if (totalCpuCores === 0 && totalCpuStr) {
          console.warn('[节点资源检查] CPU 解析失败:', totalCpuStr);
        }
        if (totalMemoryBytes === 0 && totalMemoryStr) {
          console.warn('[节点资源检查] 内存解析失败:', totalMemoryStr);
        }
        
        const metrics = nodeMetricsMap[scheduledNodeName] || { cpuUsedCores: 0, memUsedBytes: 0 };
        const usedCpuCores = metrics.cpuUsedCores;
        const usedMemoryBytes = metrics.memUsedBytes;
        const availableCpuCores = Math.max(0, totalCpuCores - usedCpuCores); // 确保不为负数
        const availableMemoryBytes = Math.max(0, totalMemoryBytes - usedMemoryBytes); // 确保不为负数
        
        // 如果总资源为0，说明无法获取，显示警告
        if (totalCpuCores === 0 && totalMemoryBytes === 0) {
          return {
            ...baseResources,
            nodeResourceCheck: {
              checked: true,
              sufficient: true, // 已运行，资源肯定充足
              message: `虚拟机已运行在节点 ${scheduledNodeName}，但无法获取节点资源详情`,
              nodes: [],
            },
          };
        }

        return {
          ...baseResources,
          nodeResourceCheck: {
            checked: true,
            sufficient: true, // 已运行，资源肯定充足
            message: `虚拟机已运行在节点 ${scheduledNodeName}，资源充足`,
            nodes: [{
              name: scheduledNodeName,
              totalCpu: formatCpu(totalCpuCores),
              totalMemory: formatMemory(totalMemoryBytes),
              usedCpu: formatCpu(usedCpuCores),
              usedMemory: formatMemory(usedMemoryBytes),
              availableCpu: formatCpu(availableCpuCores),
              availableMemory: formatMemory(availableMemoryBytes),
              cpuSufficient: true,
              memorySufficient: true,
              sufficient: true,
            }],
          },
        };
      }
    }

    // 计算 VM 需要的资源（使用 requests，如果没有则使用 limits）
    const requiredCpuStr = baseResources.cpuRequest !== '未设置' ? baseResources.cpuRequest : baseResources.cpuLimit;
    const requiredMemoryStr = baseResources.memoryRequest !== '未设置' ? baseResources.memoryRequest : baseResources.memoryLimit;

    if (requiredCpuStr === '未设置' && requiredMemoryStr === '未设置') {
      return {
        ...baseResources,
        nodeResourceCheck: {
          checked: true,
          sufficient: true,
          message: '未设置资源需求，无法检查节点资源',
        },
      };
    }

    const requiredCpuCores = parseCpuToCores(requiredCpuStr);
    const requiredMemoryBytes = parseMemoryToBytes(requiredMemoryStr);

    // 根据调度策略找出符合条件的节点
    const eligibleNodes = getEligibleNodes(vm, nodes);
    
    if (eligibleNodes.length === 0) {
      return {
        ...baseResources,
        nodeResourceCheck: {
          checked: true,
          sufficient: false,
          message: nodeAffinityResult?.required 
            ? '没有节点满足节点亲和性要求'
            : '没有符合条件的节点（可能受污点限制）',
          nodes: [],
        },
      };
    }

    // 获取节点指标（使用量）
    let nodeMetricsMap: Record<string, { cpuUsedCores: number; memUsedBytes: number }> = {};
    try {
      const metricsRes = await fetchHarvesterResourceByLink(cloudId, '/apis/metrics.k8s.io/v1beta1/nodes');
      const metricsItems: any[] = Array.isArray((metricsRes as any)?.items) ? (metricsRes as any).items : [];
      for (const item of metricsItems) {
        const name = item?.metadata?.name || '';
        const cpuUsed = parseCpuToCores(item?.usage?.cpu);
        const memUsed = parseMemoryToBytes(item?.usage?.memory);
        if (name) {
          nodeMetricsMap[name] = { cpuUsedCores: cpuUsed, memUsedBytes: memUsed };
        }
      }
    } catch (e) {
      console.warn('获取节点指标失败:', e);
    }

    // 格式化资源
    const formatCpu = (cores: number): string => {
      if (cores >= 1) return `${cores.toFixed(2)} 核`;
      return `${(cores * 1000).toFixed(0)} 毫核`;
    };

    const formatMemory = (bytes: number): string => {
      if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(2)} GiB`;
      if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(2)} MiB`;
      return `${(bytes / 1024).toFixed(2)} KiB`;
    };

    // 检查每个符合条件的节点是否有足够的资源
    const nodeDetails: Array<{
      name: string;
      totalCpu: string;
      totalMemory: string;
      usedCpu: string;
      usedMemory: string;
      availableCpu: string;
      availableMemory: string;
      cpuSufficient: boolean;
      memorySufficient: boolean;
      sufficient: boolean;
    }> = [];

    let sufficient = false;
    let message = '';

    for (const node of eligibleNodes) {
      const nodeNameStr = node?.metadata?.name || node?.name || '';
      // 兼容多种数据格式
      const rawData = node?.rawData || node?.data || node;
      const allocatable = rawData?.status?.allocatable || node?.status?.allocatable || node?.allocatable || {};
      const capacity = rawData?.status?.capacity || node?.status?.capacity || node?.capacity || {};
      
      // 尝试多种路径获取资源信息
      const totalCpuStr = allocatable.cpu || capacity.cpu || node?.cpu || rawData?.cpu || '';
      const totalMemoryStr = allocatable.memory || capacity.memory || node?.memory || rawData?.memory || '';

      if (!totalCpuStr && !totalMemoryStr) {
        console.warn('[节点资源检查] 节点无资源信息:', nodeNameStr, node);
        continue;
      }

      const totalCpuCores = parseCpuToCores(totalCpuStr);
      const totalMemoryBytes = parseMemoryToBytes(totalMemoryStr);
      
      // 如果解析失败，记录警告
      if (totalCpuCores === 0 && totalCpuStr) {
        console.warn('[节点资源检查] CPU 解析失败:', nodeNameStr, totalCpuStr);
      }
      if (totalMemoryBytes === 0 && totalMemoryStr) {
        console.warn('[节点资源检查] 内存解析失败:', nodeNameStr, totalMemoryStr);
      }
      
      // 如果总资源为0，跳过该节点
      if (totalCpuCores === 0 && totalMemoryBytes === 0) {
        continue;
      }

      const metrics = nodeMetricsMap[nodeNameStr] || { cpuUsedCores: 0, memUsedBytes: 0 };
      const usedCpuCores = metrics.cpuUsedCores;
      const usedMemoryBytes = metrics.memUsedBytes;
      const availableCpuCores = Math.max(0, totalCpuCores - usedCpuCores); // 确保不为负数
      const availableMemoryBytes = Math.max(0, totalMemoryBytes - usedMemoryBytes); // 确保不为负数

      // 检查是否有足够的资源（留 10% 的缓冲）
      const cpuSufficient = availableCpuCores >= requiredCpuCores * 1.1;
      const memorySufficient = availableMemoryBytes >= requiredMemoryBytes * 1.1;
      const nodeSufficient = cpuSufficient && memorySufficient;

      if (nodeSufficient) {
        sufficient = true;
      }

      nodeDetails.push({
        name: nodeNameStr,
        totalCpu: formatCpu(totalCpuCores),
        totalMemory: formatMemory(totalMemoryBytes),
        usedCpu: formatCpu(usedCpuCores),
        usedMemory: formatMemory(usedMemoryBytes),
        availableCpu: formatCpu(availableCpuCores),
        availableMemory: formatMemory(availableMemoryBytes),
        cpuSufficient,
        memorySufficient,
        sufficient: nodeSufficient,
      });
    }

    // 生成消息
    if (sufficient) {
      const sufficientNodes = nodeDetails.filter(n => n.sufficient);
      message = `有 ${sufficientNodes.length} 个符合条件的节点资源充足（共检查 ${nodeDetails.length} 个节点）`;
    } else {
      const allCpuInsufficient = nodeDetails.every(n => !n.cpuSufficient);
      const allMemoryInsufficient = nodeDetails.every(n => !n.memorySufficient);
      const issues: string[] = [];
      if (allCpuInsufficient) issues.push('CPU');
      if (allMemoryInsufficient) issues.push('内存');
      message = `所有符合条件的节点（${nodeDetails.length} 个）都缺少 ${issues.join(' 或 ')} 资源`;
    }

    return {
      ...baseResources,
      nodeResourceCheck: {
        checked: true,
        sufficient,
        message,
        requiredCpu: requiredCpuStr !== '未设置' ? (requiredCpuCores >= 1 ? `${requiredCpuCores.toFixed(2)} 核` : `${(requiredCpuCores * 1000).toFixed(0)} 毫核`) : '未设置',
        requiredMemory: requiredMemoryStr !== '未设置' ? (requiredMemoryBytes >= 1024 ** 3 ? `${(requiredMemoryBytes / (1024 ** 3)).toFixed(2)} GiB` : requiredMemoryBytes >= 1024 ** 2 ? `${(requiredMemoryBytes / (1024 ** 2)).toFixed(2)} MiB` : `${(requiredMemoryBytes / 1024).toFixed(2)} KiB`) : '未设置',
        nodes: nodeDetails,
      },
    };
  };

  const analyzePVCStatus = async (vm: any, cid: string, vmNamespace: string, relatedVolumes: any[] | null): Promise<any[]> => {
    const volumes: any[] = Array.isArray(vm?.spec?.template?.spec?.volumes) ? vm.spec.template.spec.volumes : [];
    if (volumes.length === 0) return [];

    // 识别系统盘（启动盘）
    const disks = Array.isArray(vm?.spec?.template?.spec?.domain?.devices?.disks) ? vm.spec.template.spec.domain.devices.disks : [];
    let systemDiskVolumeName = '';
    
    // 优先级1: bootOrder === 1 且不是 CDROM
    let bootDisk = disks.find((d: any) => d.bootOrder === 1 && !d.cdrom);
    
    // 优先级2: 名称为 'disk-0' 且不是 CDROM
    if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'disk-0' && !d.cdrom);
    
    // 优先级3: 名称为 'rootdisk' 且不是 CDROM
    if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'rootdisk' && !d.cdrom);
    
    // 优先级4: 第一个非 CDROM 磁盘
    if (!bootDisk && disks.length > 0) bootDisk = disks.find((d: any) => !d.cdrom);
    
    if (bootDisk) {
      systemDiskVolumeName = bootDisk.name || '';
    }

    const claims = volumes
      .filter((v: any) => v?.persistentVolumeClaim?.claimName)
      .map((v: any) => ({
        name: v.name,
        pvcName: String(v.persistentVolumeClaim.claimName),
        namespace: vmNamespace, // 保存命名空间信息
        isSystemDisk: v.name === systemDiskVolumeName, // 标记是否为系统盘
      }));

    if (claims.length === 0) return [];

    // 检查 VM 的 volumeClaimTemplates annotation，判断是否是动态生成的 PVC
    const volumeClaimTemplatesStr = vm?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
    let volumeClaimTemplates: any[] = [];
    if (volumeClaimTemplatesStr) {
      try {
        volumeClaimTemplates = JSON.parse(volumeClaimTemplatesStr);
        if (!Array.isArray(volumeClaimTemplates)) {
          volumeClaimTemplates = [];
        }
      } catch (e) {
        console.warn('Failed to parse volumeClaimTemplates annotation', e);
      }
    }

    const normalizePhase = (obj: any): string => {
      const source = obj?.rawData || obj?.data || obj || {};
      return source?.status?.phase || source?.status?.state || obj?.phase || obj?.state || 'Unknown';
    };

    // 总是通过 API 实际检查 PVC 是否真实存在，而不依赖 relatedVolumes 中的数据
    const results = await Promise.allSettled(
      claims.map(async (c) => {
        // 检查这个 PVC 是否在 volumeClaimTemplates 中（动态生成的 PVC）
        const isFromTemplate = volumeClaimTemplates.some((t: any) => {
          const templateName = t?.metadata?.name || t?.name || '';
          return templateName === c.pvcName;
        });

        try {
          // 调用 API 验证 PVC 是否真实存在
          // 使用 silent: true 静默处理 404 错误（PVC 不存在是预期情况，不应该在控制台显示错误）
          // 使用 skipCache: true 强制刷新，不使用缓存（对于诊断功能，需要获取最新的PVC状态）
          const detail: any = await fetchHarvesterVolume(cid, c.namespace, c.pvcName, { silent: true, skipCache: true });
          
          // 严格验证返回的数据是否真的是我们要查找的 PVC
          // 检查返回的数据结构
          if (!detail || (typeof detail !== 'object') || Array.isArray(detail)) {
            // 返回的数据无效
            throw new Error('API 返回了无效的数据结构');
          }
          
          // 检查是否为空对象（对于克隆的虚拟机，API可能返回空对象但不会抛出错误）
          const keys = Object.keys(detail);
          if (keys.length === 0) {
            throw new Error('API 返回了空对象，PVC 不存在');
          }
          
          const source = detail?.rawData || detail?.data || detail || {};
          const metadata = source?.metadata || detail?.metadata || {};
          
          // 严格验证 metadata 是否存在且是对象
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new Error('API 返回的数据中缺少有效的 metadata');
          }
          
          const returnedName = String(metadata?.name || detail?.name || '').trim();
          const returnedNamespace = String(metadata?.namespace || detail?.namespace || c.namespace || '').trim();
          
          // 验证名称是否存在（如果名称为空，说明返回的数据无效）
          if (!returnedName) {
            throw new Error('API 返回的数据中没有 PVC 名称');
          }
          
          // 验证名称和命名空间是否匹配
          if (returnedName !== c.pvcName || returnedNamespace !== c.namespace) {
            // 返回的数据不匹配，认为 PVC 不存在
            const suggestions: string[] = [];
            if (isFromTemplate) {
              suggestions.push('这个 PVC 是通过 VolumeClaimTemplate 动态生成的，但创建失败了');
              suggestions.push('可能的原因：');
              suggestions.push('  1. 存储类（StorageClass）配置错误或不存在');
              suggestions.push('  2. 资源配额（ResourceQuota）不足');
              suggestions.push('  3. 存储后端无法创建卷');
              suggestions.push('  4. 镜像（VMImage）不存在或不可用');
              suggestions.push('建议操作：');
              suggestions.push('  1. 检查 VM 事件中是否有 PVC 创建失败的错误');
              suggestions.push('  2. 检查存储类配置是否正确');
              suggestions.push('  3. 检查命名空间的资源配额');
              suggestions.push('  4. 检查镜像是否存在且可用');
            } else {
              suggestions.push('这个 PVC 在 VM 配置中被引用，但实际不存在');
              suggestions.push('可能的原因：');
              suggestions.push('  1. PVC 已被删除');
              suggestions.push('  2. PVC 名称配置错误');
              suggestions.push('  3. PVC 在不同的命名空间');
              suggestions.push('建议操作：');
              suggestions.push('  1. 检查 PVC 是否在其他命名空间');
              suggestions.push('  2. 如果 PVC 已删除，需要重新创建或修改 VM 配置');
            }
            
            return { 
              ...c, 
              exists: false, 
              checked: true, 
              phase: 'NotFound', 
              bound: false, 
              error: `PVC "${c.pvcName}" 在命名空间 "${c.namespace}" 中不存在（API 返回的数据不匹配）`,
              isFromTemplate,
              suggestions,
              apiPath: `/api/clouds/${cid}/resources/harvester/volumes/${c.namespace}/${c.pvcName}`,
              rawError: `API 返回了数据，但名称不匹配：期望 "${c.pvcName}"，实际 "${returnedName}"`
            };
          }
          
          // 数据验证通过，提取状态
          // 再次验证 status 字段是否存在（对于克隆的虚拟机，即使PVC不存在，API也可能返回部分数据）
          const status = source?.status || detail?.status;
          if (!status || typeof status !== 'object' || Array.isArray(status)) {
            // status 不存在或无效，认为 PVC 不存在或状态异常
            const suggestions: string[] = [];
            if (isFromTemplate) {
              suggestions.push('这个 PVC 是通过 VolumeClaimTemplate 动态生成的，但创建失败了');
              suggestions.push('可能的原因：');
              suggestions.push('  1. 存储类（StorageClass）配置错误或不存在');
              suggestions.push('  2. 资源配额（ResourceQuota）不足');
              suggestions.push('  3. 存储后端无法创建卷');
              suggestions.push('  4. 镜像（VMImage）不存在或不可用');
              suggestions.push('建议操作：');
              suggestions.push('  1. 检查 VM 事件中是否有 PVC 创建失败的错误');
              suggestions.push('  2. 检查存储类配置是否正确');
              suggestions.push('  3. 检查命名空间的资源配额');
              suggestions.push('  4. 检查镜像是否存在且可用');
            } else {
              suggestions.push('这个 PVC 在 VM 配置中被引用，但状态信息不完整');
              suggestions.push('可能的原因：');
              suggestions.push('  1. PVC 正在创建中');
              suggestions.push('  2. PVC 创建失败');
              suggestions.push('  3. PVC 已被删除但配置未更新');
              suggestions.push('建议操作：');
              suggestions.push('  1. 检查 PVC 的实际状态');
              suggestions.push('  2. 如果 PVC 已删除，需要重新创建或修改 VM 配置');
            }
            
            return { 
              ...c, 
              exists: false, 
              checked: true, 
              phase: 'NotFound', 
              bound: false, 
              error: `PVC "${c.pvcName}" 在命名空间 "${c.namespace}" 中不存在或状态不完整（缺少 status 信息）`,
              isFromTemplate,
              suggestions,
              apiPath: `/api/clouds/${cid}/resources/harvester/volumes/${c.namespace}/${c.pvcName}`,
              rawError: 'API 返回了数据，但缺少有效的 status 字段'
            };
          }
          
          const phase = normalizePhase(detail);
          const bound = String(phase).toLowerCase() === 'bound';
          
          // 检查是否为克隆卷（有 dataSource 或 dataSourceRef）
          const spec = source?.spec || detail?.spec || {};
          const hasDataSource = !!(spec.dataSource || spec.dataSourceRef);
          const dataSourceName = spec.dataSource?.name || spec.dataSourceRef?.name || '';
          const isClonedVolume = hasDataSource && !!dataSourceName;
          
          // 检查 PVC 的 conditions，判断是否真正就绪
          const conditions = source?.status?.conditions || detail?.status?.conditions || [];
          const isResizing = conditions.some((cond: any) => 
            cond.type === 'Resizing' && cond.status === 'True'
          );
          const isFsResizePending = conditions.some((cond: any) => 
            cond.type === 'FileSystemResizePending' && cond.status === 'True'
          );
          
          // PVC 真正就绪的条件：
          // 1. phase 为 Bound
          // 2. 没有 Resizing 条件
          // 3. 没有 FileSystemResizePending 条件
          const isReady = bound && !isResizing && !isFsResizePending;
          
          // 构建状态描述
          let readyStatus = '';
          if (!bound) {
            readyStatus = `PVC 未绑定（当前状态: ${phase}）`;
          } else if (isResizing) {
            readyStatus = 'PVC 已绑定，但正在扩容中（Resizing）';
          } else if (isFsResizePending) {
            readyStatus = 'PVC 已绑定，但等待文件系统扩容（FileSystemResizePending）';
          } else {
            readyStatus = 'PVC 已绑定且就绪';
          }
          
          return { 
            ...c, 
            exists: true, 
            checked: true, 
            phase, 
            bound,
            isReady, // 新增：是否真正就绪
            isResizing, // 新增：是否正在扩容
            isFsResizePending, // 新增：是否等待文件系统扩容
            readyStatus, // 新增：就绪状态描述
            isFromTemplate,
            isClonedVolume, // 标记是否为克隆卷
            dataSourceName, // 源 PVC 名称（如果是克隆卷）
            apiPath: `/api/clouds/${cid}/resources/harvester/volumes/${c.namespace}/${c.pvcName}`
          };
        } catch (e: any) {
          const errorMsg = e?.message || String(e) || '';
          const errorMsgLower = errorMsg.toLowerCase();
          const statusCode = e?.status || e?.response?.status || '';
          
          // 判断是权限问题还是 PVC 不存在
          if (errorMsgLower.includes('403') || errorMsgLower.includes('forbidden') || errorMsgLower.includes('permission') || statusCode === 403) {
            return { 
              ...c, 
              exists: false, 
              checked: false, 
              phase: 'Unknown', 
              bound: false, 
              error: `权限不足，无法检查命名空间 ${c.namespace} 中的 PVC`,
              isFromTemplate,
              apiPath: `/api/clouds/${cid}/resources/harvester/volumes/${c.namespace}/${c.pvcName}`,
              rawError: errorMsg
            };
          }
          // 404 或其他错误，认为 PVC 不存在
          if (errorMsgLower.includes('404') || errorMsgLower.includes('not found') || errorMsgLower.includes('不存在') || statusCode === 404) {
            // 如果是从模板生成的 PVC，提供更具体的建议
            const suggestions: string[] = [];
            if (isFromTemplate) {
              suggestions.push('这个 PVC 是通过 VolumeClaimTemplate 动态生成的，但创建失败了');
              suggestions.push('可能的原因：');
              suggestions.push('  1. 存储类（StorageClass）配置错误或不存在');
              suggestions.push('  2. 资源配额（ResourceQuota）不足');
              suggestions.push('  3. 存储后端无法创建卷');
              suggestions.push('  4. 镜像（VMImage）不存在或不可用');
              suggestions.push('建议操作：');
              suggestions.push('  1. 检查 VM 事件中是否有 PVC 创建失败的错误');
              suggestions.push('  2. 检查存储类配置是否正确');
              suggestions.push('  3. 检查命名空间的资源配额');
              suggestions.push('  4. 检查镜像是否存在且可用');
            } else {
              suggestions.push('这个 PVC 在 VM 配置中被引用，但实际不存在');
              suggestions.push('');
              suggestions.push('如何查找这个 PVC：');
              suggestions.push(`  1. 在命名空间 "${c.namespace}" 中查找所有 PVC：`);
              suggestions.push(`     kubectl get pvc -n ${c.namespace}`);
              suggestions.push(`  2. 查找包含 "${c.pvcName}" 的 PVC（可能是部分匹配）：`);
              suggestions.push(`     kubectl get pvc -n ${c.namespace} | grep "${c.pvcName}"`);
              suggestions.push(`  3. 如果是克隆的虚拟机，PVC 名称可能是动态生成的，格式为：`);
              suggestions.push(`     {虚拟机名称}-{卷名称}-{随机后缀}`);
              suggestions.push(`     可以查找所有以虚拟机名称开头的 PVC：`);
              suggestions.push(`     kubectl get pvc -n ${c.namespace} | grep "^${c.pvcName.split('-')[0]}"`);
              suggestions.push('');
              suggestions.push('可能的原因：');
              suggestions.push('  1. PVC 正在创建中（克隆时可能需要时间）');
              suggestions.push('  2. PVC 已被删除');
              suggestions.push('  3. PVC 名称配置错误或已更改');
              suggestions.push('  4. PVC 在不同的命名空间');
              suggestions.push('');
              suggestions.push('建议操作：');
              suggestions.push('  1. 等待几分钟，如果是克隆操作，PVC 可能还在创建中');
              suggestions.push('  2. 检查 VM 的 volumeClaimTemplates 注解，查看预期的 PVC 名称');
              suggestions.push('  3. 检查命名空间中的所有 PVC，确认是否存在类似的 PVC');
              suggestions.push('  4. 如果 PVC 已删除，需要重新创建或修改 VM 配置');
            }

            return { 
              ...c, 
              exists: false, 
              checked: true, 
              phase: 'NotFound', 
              bound: false, 
              error: `PVC "${c.pvcName}" 在命名空间 "${c.namespace}" 中不存在`,
              isFromTemplate,
              suggestions,
              apiPath: `/api/clouds/${cid}/resources/harvester/volumes/${c.namespace}/${c.pvcName}`,
              rawError: errorMsg
            };
          }
          // 其他错误（如网络错误等）
          return { 
            ...c, 
            exists: false, 
            checked: true, 
            phase: 'Unknown', 
            bound: false, 
            error: `检查失败: ${errorMsg || '未知错误'}`,
            isFromTemplate,
            apiPath: `/api/clouds/${cid}/resources/harvester/volumes/${c.namespace}/${c.pvcName}`,
            rawError: errorMsg
          };
        }
      })
    );

    return results.map((r) => {
      if (r.status === 'fulfilled') return r.value;
      return { 
        name: '-', 
        pvcName: '-', 
        namespace: vmNamespace,
        exists: false, 
        checked: false, 
        phase: 'Unknown', 
        bound: false, 
        error: '检查异常',
        rawError: r.reason?.message || String(r.reason)
      };
    });
  };

  // 刷新事件数据
  const refreshEvents = useCallback(async () => {
    if (!active || !cloudId || !namespace || !name || !diagnosis) return;

    setRefreshingEvents(true);
    try {
      // 获取 VMI 事件
      const vmiEventsRes = await fetchHarvesterEvents(cloudId, namespace, name, 'VirtualMachineInstance').catch(() => ({ data: [] }));
      const vmiEventsData = vmiEventsRes?.data || [];

      // 获取 Pod 事件
      let podEventsData: any[] = [];
      try {
        const allPodEventsRes = await fetchHarvesterEvents(cloudId, namespace, undefined, 'Pod');
        const allPodEvents = allPodEventsRes?.data || [];
        const vmNamePattern = new RegExp(`virt-launcher-${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`, 'i');
        podEventsData = allPodEvents.filter((e: any) => {
          const podName = e.involvedObject?.name || '';
          const message = e.message || '';
          return vmNamePattern.test(podName) || vmNamePattern.test(message);
        });
      } catch (e) {
        console.warn('获取 Pod 事件失败:', e);
      }

      // 合并所有事件，按时间排序
      const allEvents = [...vmiEventsData, ...podEventsData].sort((a: any, b: any) => {
        const timeA = new Date(a.lastTimestamp || a.firstTimestamp || 0).getTime();
        const timeB = new Date(b.lastTimestamp || b.firstTimestamp || 0).getTime();
        return timeB - timeA; // 降序
      });

      // 重新分析事件
      const eventAnalysis = analyzeDiagnosticsEvents(allEvents, diagnosis.vmStatus, diagnosis.podInfo, record, diagnosis.pvcStatus);

      // 更新诊断结果
      setDiagnosis(prev => prev ? {
        ...prev,
        events: allEvents.slice(0, 30),
        eventAnalysis
      } : null);
    } catch (e: any) {
      console.error('刷新事件失败:', e);
    } finally {
      setRefreshingEvents(false);
    }
  }, [active, cloudId, namespace, name, diagnosis, record]);

  const getStatusIcon = (status: string, isError: boolean = false) => {
    if (isError) {
      return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
    }
    if (status === 'Running' || status === 'Ready') {
      return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
    }
    return <ExclamationCircleOutlined style={{ color: '#faad14' }} />;
  };

  const getStatusColor = (status: string, isError: boolean = false) => {
    if (isError) return 'error';
    if (status === 'Running' || status === 'Ready') return 'success';
    return 'warning';
  };

  // 渲染函数
  const renderVmStatus = (vmStatus: any, isVMError: boolean) => {
    if (!vmStatus) {
      return (
        <Card {...DIAG_STEP_CONTENT_CARD}>
          <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
            <Descriptions.Item label="状态" span={2}>
              <Space>
                <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                <Tag color="warning">无状态信息</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  无法获取虚拟机状态信息
                </Text>
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      );
    }
    return (
      <Card {...DIAG_STEP_CONTENT_CARD}>
        <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
          <Descriptions.Item label="状态">
            <Space>
              {getStatusIcon(vmStatus.printableStatus, isVMError)}
              <Tag color={getStatusColor(vmStatus.printableStatus, isVMError)}>
                {vmStatus.printableStatus || 'Unknown'}
              </Tag>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Ready">
            <Space>
              {vmStatus.ready ? (
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
              ) : (
                <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
              )}
              <Text>{vmStatus.ready ? '是' : '否'}</Text>
            </Space>
          </Descriptions.Item>
          {vmStatus.conditions?.map((condition: any) => (
            <Descriptions.Item key={condition.type} label={condition.type}>
              <Space direction="vertical" size={0}>
                <Text>{condition.status === 'True' ? '正常' : '异常'}</Text>
                {condition.reason && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {condition.reason}
                  </Text>
                )}
                {condition.message && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {condition.message}
                  </Text>
                )}
              </Space>
            </Descriptions.Item>
          ))}
        </Descriptions>
      </Card>
    );
  };

  const renderVmiStatus = (vmiStatus: any, diagnosis: DiagnosisResult) => {
    if (!vmiStatus) {
      return (
        <Card {...DIAG_STEP_CONTENT_CARD}>
          <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
            <Descriptions.Item label="状态" span={2}>
              <Space direction="vertical" size={4}>
                <Space>
                  <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                  <Tag color="warning">不存在</Tag>
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  虚拟机实例尚未创建，可能正在调度或遇到调度问题
                </Text>
                {diagnosis.podInfo?.podName && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    检测到虚拟机运行容器: <Text code style={{ fontSize: 12 }}>{diagnosis.podInfo.podName}</Text>
                  </Text>
                )}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      );
    }
    return (
      <Card {...DIAG_STEP_CONTENT_CARD}>
        <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
          <Descriptions.Item label="Phase">
            <Space>
              {vmiStatus.phase === 'Running' ? (
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
              ) : (
                <ExclamationCircleOutlined style={{ color: '#faad14' }} />
              )}
              <Tag color={vmiStatus.phase === 'Running' ? 'success' : 'warning'}>
                {vmiStatus.phase || 'Unknown'}
              </Tag>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="节点">
            {vmiStatus.nodeName ? (
              <Text code>{vmiStatus.nodeName}</Text>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>未调度</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="IP 地址">
            {vmiStatus.interfaces?.[0]?.ipAddress ? (
              <Text code>{vmiStatus.interfaces[0].ipAddress}</Text>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>未分配</Text>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    );
  };

  const renderPodInfo = (podInfo: any, diagnosis: DiagnosisResult) => {
    if (!podInfo?.podName) {
      return (
        <Card {...DIAG_STEP_CONTENT_CARD}>
          <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
            <Descriptions.Item label="状态" span={2}>
              <Space direction="vertical" size={4}>
                <Space>
                  <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                  <Tag color="warning">未找到</Tag>
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  虚拟机运行所需的容器尚未创建，可能正在调度或遇到调度问题
                </Text>
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      );
    }
    const podLogs = diagnosis?.podLogs;
    return (
      <Card {...DIAG_STEP_CONTENT_CARD}>
        <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
          <Descriptions.Item label="容器名称" span={2}>
            <Text code>{podInfo.podName}</Text>
          </Descriptions.Item>

          {podLogs && podLogs.checked === false && (
            <Descriptions.Item label="日志摘要" span={2}>
              <Space direction="vertical" size={4}>
                <Space>
                  <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                  <Tag color="warning">不可用</Tag>
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {podLogs.error || '无法获取日志'}
                </Text>
              </Space>
            </Descriptions.Item>
          )}

          {podLogs && podLogs.checked === true && (
            <Descriptions.Item label="日志分析" span={2}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {/* 摘要信息 */}
                {podLogs.summary && (
                  <div>
                    <Space>
                      {podLogs.severity === 'error' ? (
                        <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                      ) : podLogs.severity === 'warning' ? (
                        <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                      ) : (
                        <InfoCircleOutlined style={{ color: '#1890ff' }} />
                      )}
                      <Text strong style={{ fontSize: 14 }}>
                        {podLogs.summary}
                      </Text>
                    </Space>
                  </div>
                )}

                {/* 问题标签 */}
                {Array.isArray(podLogs.hints) && podLogs.hints.length > 0 && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>检测到的问题类型：</Text>
                    {podLogs.hints.map((h) => (
                      <Tag key={h} color={podLogs.severity === 'error' ? 'red' : podLogs.severity === 'warning' ? 'orange' : 'blue'}>
                        {h}
                      </Tag>
                    ))}
                  </div>
                )}

                {/* 解决建议 */}
                {Array.isArray(podLogs.suggestions) && podLogs.suggestions.length > 0 && (
                  <div style={{ 
                    padding: '12px', 
                    background: podLogs.severity === 'error' ? '#fff1f0' : podLogs.severity === 'warning' ? '#fff7e6' : '#e6f7ff',
                    borderRadius: 8,
                    border: `1px solid ${podLogs.severity === 'error' ? '#ffccc7' : podLogs.severity === 'warning' ? '#ffe58f' : '#91d5ff'}`
                  }}>
                    <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>建议操作：</Text>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {podLogs.suggestions.filter((s: string) => s && s.trim()).map((suggestion: string, idx: number) => (
                        <li key={idx}>
                          <Text style={{ fontSize: 12 }}>{suggestion}</Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 原始日志片段（可折叠） */}
                {Array.isArray(podLogs.highlights) && podLogs.highlights.length > 0 && (
                  <Collapse size="small" ghost>
                    <Panel 
                      header={
                        <Space>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            查看原始日志片段（{podLogs.highlights.length} 条）
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            （技术细节，普通用户可忽略）
                          </Text>
                        </Space>
                      } 
                      key="log-summary"
                    >
                      <div style={{ 
                        padding: '8px', 
                        background: '#f5f5f5', 
                        borderRadius: 8,
                        maxHeight: '400px',
                        overflow: 'auto'
                      }}>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, fontFamily: 'monospace' }}>
                          {podLogs.highlights.join('\n')}
                        </pre>
                      </div>
                      <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                        提示：如需查看完整日志，请切换到"实时日志"标签页
                      </Text>
                    </Panel>
                  </Collapse>
                )}

                {/* 无错误时的提示 */}
                {(!podLogs.highlights || podLogs.highlights.length === 0) && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    未在最近日志中识别到明显的错误关键词。如需完整日志，请切换到"实时日志"标签页查看。
                  </Text>
                )}
              </Space>
            </Descriptions.Item>
          )}

          {!podLogs && (
            <Descriptions.Item label="日志" span={2}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                如需完整日志，请切换到"实时日志"标签页查看。
              </Text>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>
    );
  };

  const renderNodeAffinity = (nodeAffinity: any) => {
    if (!nodeAffinity) return null;
    return (
      <Card {...DIAG_STEP_CONTENT_CARD}>
        <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
          {!nodeAffinity.required ? (
            <Descriptions.Item label="节点亲和性" span={2}>
              <Text type="secondary">未配置节点亲和性要求</Text>
            </Descriptions.Item>
          ) : (
            <>
              <Descriptions.Item label="状态" span={2}>
                <Space>
                  {!nodeAffinity.valid ? (
                    <>
                      <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                      <Tag color="error">配置不完整</Tag>
                    </>
                  ) : !nodeAffinity.checked ? (
                    <>
                      <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                      <Tag color="warning">未自动校验</Tag>
                    </>
                  ) : nodeAffinity.nodesWithLabel > 0 ? (
                    <>
                      <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      <Tag color="success">满足</Tag>
                    </>
                  ) : (
                    <>
                      <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                      <Tag color="error">不满足</Tag>
                    </>
                  )}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="规则" span={2}>
                <Text code>{nodeAffinity.label || '-'}</Text>
              </Descriptions.Item>
              {nodeAffinity.checked ? (
                <Descriptions.Item label="满足节点数">
                  <Text>
                    <Text strong>{nodeAffinity.nodesWithLabel}</Text>
                    {typeof nodeAffinity.totalNodes === 'number' ? ` / ${nodeAffinity.totalNodes}` : ''}
                  </Text>
                </Descriptions.Item>
              ) : (
                <Descriptions.Item label="校验状态" span={2}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    节点列表获取失败或无权限，暂无法自动判断是否存在满足该规则的节点
                  </Text>
                </Descriptions.Item>
              )}
              {Array.isArray(nodeAffinity.matchedNodeNames) && nodeAffinity.matchedNodeNames.length > 0 && (
                <Descriptions.Item label="示例节点" span={2}>
                  <Text code>{nodeAffinity.matchedNodeNames.join(', ')}</Text>
                </Descriptions.Item>
              )}
            </>
          )}
        </Descriptions>
      </Card>
    );
  };

  const renderNodeSelector = (nodeSelector: any) => {
    if (!nodeSelector) return null;
    return (
      <Card {...DIAG_STEP_CONTENT_CARD}>
        <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
          {!nodeSelector.configured ? (
            <Descriptions.Item label="节点选择器" span={2}>
              <Text type="secondary">未配置节点选择器（自动调度）</Text>
            </Descriptions.Item>
          ) : (
            <>
              <Descriptions.Item label="状态" span={2}>
                <Space>
                  {!nodeSelector.checked ? (
                    <>
                      <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                      <Tag color="warning">未自动校验</Tag>
                    </>
                  ) : (nodeSelector.matchedNodeNames?.length || 0) > 0 ? (
                    <>
                      <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      <Tag color="success">找到匹配节点</Tag>
                    </>
                  ) : (
                    <>
                      <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                      <Tag color="error">未找到匹配节点</Tag>
                    </>
                  )}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="选择器" span={2}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {Object.entries(nodeSelector.selector || {}).map(([key, value]) => (
                    <Tag key={key} color="blue">
                      {key}: {String(value)}
                    </Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              {nodeSelector.checked ? (
                <>
                  <Descriptions.Item label="匹配节点数">
                    <Text>
                      <Text strong>{nodeSelector.matchedNodeNames?.length || 0}</Text>
                      {typeof nodeSelector.totalNodes === 'number' ? ` / ${nodeSelector.totalNodes}` : ''}
                    </Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="消息">
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {nodeSelector.message}
                    </Text>
                  </Descriptions.Item>
                </>
              ) : (
                <Descriptions.Item label="校验状态" span={2}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    节点列表获取失败或无权限，暂无法自动判断是否存在匹配的节点
                  </Text>
                </Descriptions.Item>
              )}
              {Array.isArray(nodeSelector.matchedNodeNames) && nodeSelector.matchedNodeNames.length > 0 && (
                <Descriptions.Item label="匹配的节点" span={2}>
                  <Text code>{nodeSelector.matchedNodeNames.join(', ')}</Text>
                </Descriptions.Item>
              )}
              {nodeSelector.checked && (nodeSelector.matchedNodeNames?.length || 0) === 0 && (
                <Descriptions.Item label="提示" span={2}>
                  <Alert
                    message="未找到匹配的节点"
                    description={
                      <div>
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                          虚拟机配置了节点选择器，但集群中没有节点满足这些条件。
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                          可能的原因：
                        </Text>
                        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                          <li>指定的节点不存在或已被删除</li>
                          <li>节点标签不匹配（例如：kubernetes.io/hostname 指定的节点名不存在）</li>
                          <li>克隆虚拟机时继承了源虚拟机的节点选择器，但目标节点不可用</li>
                        </ul>
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                          建议操作：
                        </Text>
                        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                          <li>检查节点选择器配置是否正确</li>
                          <li>如果是克隆虚拟机，检查是否需要清除节点选择器以允许自动调度</li>
                          <li>确认指定的节点是否存在且可用</li>
                        </ul>
                      </div>
                    }
                    type="error"
                    showIcon
                    style={{ marginTop: 8 }}
                  />
                </Descriptions.Item>
              )}
            </>
          )}
        </Descriptions>
      </Card>
    );
  };

  const renderResources = (resources: any) => {
    if (!resources) return null;
    const nodeCheck = resources.nodeResourceCheck;
    return (
      <Card {...DIAG_STEP_CONTENT_CARD}>
        <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
          <Descriptions.Item label="CPU 请求">
            {resources.cpuRequest}
          </Descriptions.Item>
          <Descriptions.Item label="CPU 限制">
            {resources.cpuLimit}
          </Descriptions.Item>
          <Descriptions.Item label="内存请求">
            {resources.memoryRequest}
          </Descriptions.Item>
          <Descriptions.Item label="内存限制">
            {resources.memoryLimit}
          </Descriptions.Item>
          {nodeCheck && nodeCheck.checked && (
            <>
              <Descriptions.Item label="节点资源检查" span={2}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space>
                    {nodeCheck.sufficient ? (
                      <>
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        <Tag color="success">资源充足</Tag>
                      </>
                    ) : (
                      <>
                        <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                        <Tag color="error">资源不足</Tag>
                      </>
                    )}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {nodeCheck.message}
                    </Text>
                  </Space>
                  {nodeCheck.requiredCpu && nodeCheck.requiredCpu !== '未设置' && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        虚拟机需要：CPU {nodeCheck.requiredCpu}，内存 {nodeCheck.requiredMemory || '未设置'}
                      </Text>
                    </div>
                  )}
                </Space>
              </Descriptions.Item>
              {nodeCheck.nodes && nodeCheck.nodes.length > 0 && (
                <Descriptions.Item label="节点资源详情" span={2}>
                  <div style={{ marginTop: 8 }}>
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      {nodeCheck.nodes.map((node: any, idx: number) => (
                        <div
                          key={idx}
                          style={diagNodeResourceBlock(!!node.sufficient)}
                        >
                          <Space direction="vertical" size={6} style={{ width: '100%' }}>
                            <div>
                              <Text strong>{node.name}</Text>
                              {node.sufficient ? (
                                <Tag color="success" style={{ marginLeft: 8 }}>资源充足</Tag>
                              ) : (
                                <Tag color="error" style={{ marginLeft: 8 }}>
                                  {!node.cpuSufficient && !node.memorySufficient
                                    ? 'CPU 和内存不足'
                                    : !node.cpuSufficient
                                    ? 'CPU 不足'
                                    : '内存不足'}
                                </Tag>
                              )}
                            </div>
                            <Descriptions column={3} size="small" style={{ marginTop: 4 }}>
                              <Descriptions.Item label="总 CPU">{node.totalCpu}</Descriptions.Item>
                              <Descriptions.Item label="已使用">{node.usedCpu}</Descriptions.Item>
                              <Descriptions.Item label="可用">
                                <Text style={{ color: node.cpuSufficient ? '#52c41a' : '#ff4d4f' }}>
                                  {node.availableCpu}
                                </Text>
                              </Descriptions.Item>
                              <Descriptions.Item label="总内存">{node.totalMemory}</Descriptions.Item>
                              <Descriptions.Item label="已使用">{node.usedMemory}</Descriptions.Item>
                              <Descriptions.Item label="可用">
                                <Text style={{ color: node.memorySufficient ? '#52c41a' : '#ff4d4f' }}>
                                  {node.availableMemory}
                                </Text>
                              </Descriptions.Item>
                            </Descriptions>
                          </Space>
                        </div>
                      ))}
                    </Space>
                  </div>
                </Descriptions.Item>
              )}
            </>
          )}
          {nodeCheck && !nodeCheck.checked && (
            <Descriptions.Item label="节点资源检查" span={2}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {nodeCheck.message}
              </Text>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>
    );
  };

  const renderPvcStatus = (pvcStatus: any[]) => {
    if (!pvcStatus || pvcStatus.length === 0) {
      return (
        <Card {...DIAG_STEP_CONTENT_CARD}>
          <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
            <Descriptions.Item label="存储卷" span={2}>
              <Text type="secondary" style={{ fontSize: 12 }}>未配置存储卷</Text>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      );
    }
    return (
      <Card {...DIAG_STEP_CONTENT_CARD}>
        <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
          {pvcStatus.map((pvc, idx) => (
            <React.Fragment key={idx}>
              <Descriptions.Item label="卷名称">
                <Space>
                  <Text code>{pvc.name}</Text>
                  {pvc.isSystemDisk && (
                    <Tag color="blue">系统盘</Tag>
                  )}
                  {pvc.isClonedVolume && (
                    <Tag color="purple">克隆卷</Tag>
                  )}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="PVC 名称">
                <Text code>{pvc.pvcName}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="命名空间">
                <Text code>{pvc.namespace || '未知'}</Text>
              </Descriptions.Item>
              {pvc.isClonedVolume && pvc.dataSourceName && (
                <Descriptions.Item label="源 PVC" span={2}>
                  <Text code>{pvc.dataSourceName}</Text>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="状态" span={2}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space>
                    {pvc.checked !== true ? (
                      <>
                        <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                        <Tag color="default">未校验</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {pvc.error || '无法获取 PVC 详情（可能无权限或接口不可用）'}
                        </Text>
                      </>
                    ) : pvc.exists === false ? (
                      <>
                        <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                        <Tag color="error">不存在</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {pvc.error || 'PVC 不存在（已通过 API 验证）'}
                        </Text>
                      </>
                    ) : pvc.exists === true && pvc.isReady === true ? (
                      <>
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        <Tag color="success">已就绪</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {pvc.readyStatus || 'PVC 已绑定且就绪（已通过 API 验证）'}
                        </Text>
                      </>
                    ) : pvc.exists === true && pvc.bound === true ? (
                      <>
                        <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                        <Tag color="warning">
                          {pvc.isResizing ? '扩容中' : pvc.isFsResizePending ? '等待文件系统扩容' : '已绑定但未就绪'}
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {pvc.readyStatus || `PVC 已绑定但未就绪（当前状态: ${pvc.phase}）`}
                        </Text>
                      </>
                    ) : (
                      <>
                        <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                        <Tag color="warning">{pvc.phase || 'Unknown'}</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          PVC 存在但未绑定或处于异常状态（已通过 API 验证）
                        </Text>
                      </>
                    )}
                  </Space>
                  {pvc.exists === true && (
                    <Space direction="vertical" size={2} style={{ marginLeft: 24, width: '100%' }}>
                      {pvc.phase && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          阶段状态: {pvc.phase}
                        </Text>
                      )}
                      {pvc.isResizing && (
                        <Text type="warning" style={{ fontSize: 12 }}>
                          ⚠️ 正在扩容中（Resizing），请等待扩容完成
                        </Text>
                      )}
                      {pvc.isFsResizePending && (
                        <Text type="warning" style={{ fontSize: 12 }}>
                          ⚠️ 等待文件系统扩容（FileSystemResizePending），可能需要重启虚拟机
                        </Text>
                      )}
                      {pvc.isReady && (
                        <Text type="success" style={{ fontSize: 12 }}>
                          ✓ 存储卷已就绪，可以正常使用
                        </Text>
                      )}
                    </Space>
                  )}
                  {/* 显示克隆卷信息提示 */}
                  {pvc.isClonedVolume && pvc.bound === true && pvc.exists === true && (
                    <Alert
                      message={pvc.isSystemDisk ? '克隆虚拟机的系统盘' : '克隆卷'}
                      description={
                        <div>
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                            {pvc.isSystemDisk 
                              ? '这是克隆虚拟机的系统盘，已从源 PVC 克隆数据。'
                              : '这是克隆卷，已从源 PVC 克隆数据。'}
                          </Text>
                          {pvc.dataSourceName && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              源 PVC: <Text code style={{ fontSize: 12 }}>{pvc.dataSourceName}</Text>
                            </Text>
                          )}
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                            注意：虽然 PVC 状态为 Bound，但数据可能仍在克隆中。如果虚拟机无法启动，请检查虚拟卷的克隆进度。
                          </Text>
                        </div>
                      }
                      type="info"
                      showIcon
                      style={{ marginTop: 8 }}
                    />
                  )}
                  {/* 显示详细建议 */}
                  {pvc.exists === false && pvc.suggestions && pvc.suggestions.length > 0 && (
                    <Alert
                      message={pvc.isFromTemplate ? '动态生成的 PVC 创建失败' : 'PVC 不存在'}
                      description={
                        <div>
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                            {pvc.isFromTemplate 
                              ? '这个 PVC 是通过 VolumeClaimTemplate 动态生成的，但创建失败了。'
                              : '这个 PVC 在 VM 配置中被引用，但实际不存在。'}
                          </Text>
                          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                            {pvc.suggestions.filter((s: string) => s && s.trim()).map((suggestion: string, idx: number) => (
                              <li key={idx} style={{ marginBottom: 4 }}>
                                <Text style={{ fontSize: 12 }}>{suggestion}</Text>
                              </li>
                            ))}
                          </ul>
                        </div>
                      }
                      type="error"
                      showIcon
                      style={{ marginTop: 8 }}
                    />
                  )}
                  {/* 显示调试信息 */}
                  {pvc.exists === false && (
                    <Collapse size="small" ghost style={{ marginTop: 8 }}>
                      <Panel 
                        header={
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            查看技术详情
                          </Text>
                        } 
                        key="debug"
                      >
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          {pvc.isFromTemplate !== undefined && (
                            <div>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                是否来自模板: {pvc.isFromTemplate ? '是（动态生成）' : '否（静态引用）'}
                              </Text>
                            </div>
                          )}
                          {pvc.apiPath && (
                            <div>
                              <Text type="secondary" style={{ fontSize: 12 }}>API 路径: </Text>
                              <Text code style={{ fontSize: 12 }}>{pvc.apiPath}</Text>
                            </div>
                          )}
                          {pvc.rawError && (
                            <div>
                              <Text type="secondary" style={{ fontSize: 12 }}>错误详情: </Text>
                              <Text style={{ fontSize: 12, color: '#ff4d4f' }}>{pvc.rawError}</Text>
                            </div>
                          )}
                        </Space>
                      </Panel>
                    </Collapse>
                  )}
                </Space>
              </Descriptions.Item>
            </React.Fragment>
          ))}
        </Descriptions>
      </Card>
    );
  };

  const renderNetworkStatus = (networkStatus: any) => {
    if (!networkStatus) return null;
    return (
      <Card {...DIAG_STEP_CONTENT_CARD}>
        <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
          {networkStatus.multusNetworks && networkStatus.multusNetworks.length > 0 ? (
            <>
              {networkStatus.multusNetworks.map((net: any, idx: number) => (
                <React.Fragment key={idx}>
                  <Descriptions.Item label="网络名称">
                    <Text code>{net.name}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Multus 网络">
                    <Text code>{net.networkName}</Text>
                  </Descriptions.Item>
                </React.Fragment>
              ))}
              <Descriptions.Item label="提示" span={2}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  请检查 Multus 网络配置是否存在
                </Text>
              </Descriptions.Item>
            </>
          ) : (
            <Descriptions.Item label="网络配置" span={2}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {networkStatus.message}
              </Text>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>
    );
  };

  const renderEventAnalysis = (eventAnalysis: any, events: any[]) => {
    if (!eventAnalysis) {
      return (
        <Card {...DIAG_STEP_CONTENT_CARD}>
          <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
            <Descriptions.Item label="状态" span={2}>
              <Space>
                <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                <Tag color="warning">未分析</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  无法获取事件分析结果
                </Text>
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      );
    }
    return (
      <Card {...DIAG_STEP_CONTENT_CARD}>
        <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
          {/* 显示事件分析摘要 */}
          <Descriptions.Item label="分析结果">
            <Space>
              {eventAnalysis.recentPattern === '正常运行' ? (
                <>
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  <Tag color="success">{eventAnalysis.recentPattern}</Tag>
                </>
              ) : eventAnalysis.recentPattern === '无事件' ? (
                <>
                  <InfoCircleOutlined style={{ color: '#1890ff' }} />
                  <Tag color="default">{eventAnalysis.recentPattern}</Tag>
                </>
              ) : eventAnalysis.recentPattern === '存储卷挂载冲突' || 
                   eventAnalysis.recentPattern === 'IP 地址池耗尽' || 
                   eventAnalysis.recentPattern === '网络配置错误' ? (
                <>
                  <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                  <Tag color="error">{eventAnalysis.recentPattern}</Tag>
                </>
              ) : (
                <>
                  <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                  <Tag color="warning">{eventAnalysis.recentPattern}</Tag>
                </>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Pod 创建次数">
            <Text>{eventAnalysis.podCreateCount}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Pod 删除次数">
            <Text>{eventAnalysis.podDeleteCount}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="VMI 停止次数">
            <Text>{eventAnalysis.vmiStoppedCount}</Text>
          </Descriptions.Item>

          {/* 显示详细信息和警告 */}
          {(eventAnalysis.recentPattern === '存储卷挂载冲突' ||
            eventAnalysis.recentPattern === 'IP 地址池耗尽' ||
            eventAnalysis.recentPattern === '网络配置错误' ||
            (eventAnalysis.podCreateDeleteCycle && 
             eventAnalysis.recentPattern !== 'IP 地址池耗尽' &&
             eventAnalysis.recentPattern !== '网络配置错误') ||
            (eventAnalysis.recentPattern === '正常运行' || eventAnalysis.recentPattern === '无事件')) && (
            <Descriptions.Item label="详细信息" span={2}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {eventAnalysis.recentPattern === '存储卷挂载冲突' && (
                  <Alert
                    message="存储卷挂载冲突"
                    description={
                      <div>
                        <Text strong style={{ color: '#ff4d4f' }}>
                          根本原因：存储卷已挂载到其他节点，无法挂载到新节点
                        </Text>
                        <br />
                        <br />
                        {eventAnalysis.volumeConflictDetails && eventAnalysis.volumeConflictDetails.length > 0 && (
                          <>
                            <Text strong>冲突详情：</Text>
                            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                              {eventAnalysis.volumeConflictDetails.map((detail: any, idx: number) => (
                                <li key={idx} style={{ marginBottom: 8 }}>
                                  <Text style={{ fontSize: 12 }}>
                                    存储卷 <Text code>{detail.volume}</Text> 当前挂载在节点{' '}
                                    <Text code>{detail.currentNode}</Text>，尝试挂载到节点{' '}
                                    <Text code>{detail.targetNode}</Text>
                                  </Text>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        <Text>
                          Pod 创建次数: <Text strong>{eventAnalysis.podCreateCount}</Text>，
                          删除次数: <Text strong>{eventAnalysis.podDeleteCount}</Text>
                        </Text>
                      </div>
                    }
                    type="error"
                    showIcon
                  />
                )}
                {eventAnalysis.recentPattern === 'IP 地址池耗尽' && (
                  <Alert
                    message="IP 地址池耗尽"
                    description={
                      <div>
                        <Text strong style={{ color: '#ff4d4f' }}>
                          根本原因：Calico IP 地址池已用完，无法为新 Pod 分配 IP 地址
                        </Text>
                        <br />
                        <br />
                        <Text>
                          Pod 创建次数: <Text strong>{eventAnalysis.podCreateCount}</Text>，
                          删除次数: <Text strong>{eventAnalysis.podDeleteCount}</Text>
                        </Text>
                        {eventAnalysis.ipExhaustionNodes && eventAnalysis.ipExhaustionNodes.length > 0 && (
                          <>
                            <br />
                            <br />
                            <Text>
                              相关节点: <Text code>{eventAnalysis.ipExhaustionNodes.join(', ')}</Text>
                            </Text>
                            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                              注意：IP 地址耗尽通常是集群级别问题，可能影响所有节点。上述节点是检测到相关事件的节点。
                            </Text>
                          </>
                        )}
                        {(!eventAnalysis.ipExhaustionNodes || eventAnalysis.ipExhaustionNodes.length === 0) && (
                          <>
                            <br />
                            <br />
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              注意：IP 地址耗尽通常是集群级别问题，影响所有节点。由于 Pod 可能尚未调度，无法从事件中提取具体节点信息。
                            </Text>
                          </>
                        )}
                      </div>
                    }
                    type="error"
                    showIcon
                  />
                )}
                {eventAnalysis.recentPattern === '网络配置错误' && (
                  <Alert
                    message="网络配置错误"
                    description={
                      <div>
                        <Text>
                          Pod 创建次数: <Text strong>{eventAnalysis.podCreateCount}</Text>，
                          删除次数: <Text strong>{eventAnalysis.podDeleteCount}</Text>
                        </Text>
                      </div>
                    }
                    type="error"
                    showIcon
                  />
                )}
                {eventAnalysis.podCreateDeleteCycle && 
                 eventAnalysis.recentPattern !== 'IP 地址池耗尽' &&
                 eventAnalysis.recentPattern !== '网络配置错误' && (
                  <Alert
                    message="检测到 Pod 频繁创建/删除循环"
                    description={
                      <div>
                        <Text>
                          Pod 创建次数: <Text strong>{eventAnalysis.podCreateCount}</Text>，
                          删除次数: <Text strong>{eventAnalysis.podDeleteCount}</Text>
                        </Text>
                      </div>
                    }
                    type="error"
                    showIcon
                  />
                )}
                {/* 显示正常运行或无事件的信息 */}
                {(eventAnalysis.recentPattern === '正常运行' || eventAnalysis.recentPattern === '无事件') && 
                 !eventAnalysis.podCreateDeleteCycle && (
                  <Alert
                    message={eventAnalysis.recentPattern === '正常运行' ? '事件分析正常' : '无事件记录'}
                    description={
                      <div>
                        <Text>
                          {eventAnalysis.recentPattern === '正常运行' 
                            ? '未检测到异常事件，虚拟机运行状态正常'
                            : '当前没有相关事件记录，可能是虚拟机刚创建或事件已被清理'}
                        </Text>
                        {eventAnalysis.podCreateCount > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              Pod 创建次数: {eventAnalysis.podCreateCount}，
                              删除次数: {eventAnalysis.podDeleteCount}
                            </Text>
                          </div>
                        )}
                      </div>
                    }
                    type={eventAnalysis.recentPattern === '正常运行' ? 'success' : 'info'}
                    showIcon
                  />
                )}
                {/* 建议操作 */}
                {eventAnalysis.suggestions.length > 0 && (
                  <div style={{ 
                    padding: '12px', 
                    background: eventAnalysis.recentPattern === '正常运行' ? '#f6ffed' : '#fff1f0',
                    borderRadius: 8,
                    border: `1px solid ${eventAnalysis.recentPattern === '正常运行' ? '#b7eb8f' : '#ffccc7'}`
                  }}>
                    <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>建议操作：</Text>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {eventAnalysis.suggestions.filter((s: string) => s && s.trim()).map((suggestion: string, idx: number) => (
                        <li key={idx}>
                          <Text style={{ fontSize: 12 }}>{suggestion}</Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Space>
            </Descriptions.Item>
          )}
          {/* 事件列表 */}
          {events && events.length > 0 ? (
            <Descriptions.Item label="最近事件" span={2}>
              <div style={{ border: '1px solid #f0f0f0', borderRadius: 8 }}>
                <Collapse size="small" ghost>
                  <Panel 
                    header={
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <span>查看最近事件 ({events.length} 条)</span>
                        <Button 
                          type="text" 
                          size="small" 
                          icon={<ReloadOutlined />} 
                          onClick={(e) => {
                            e.stopPropagation();
                            refreshEvents();
                          }}
                          loading={refreshingEvents}
                          style={{ fontSize: 12 }}
                        >
                          刷新
                        </Button>
                      </Space>
                    } 
                    key="events"
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      {events.slice(0, 10).map((event: any, idx: number) => (
                        <div key={idx} style={{ 
                          padding: '8px', 
                          background: event.type === 'Warning' ? '#fff7e6' : '#f6ffed',
                          borderRadius: 8,
                          borderLeft: `3px solid ${event.type === 'Warning' ? '#faad14' : '#52c41a'}`
                        }}>
                          <Space>
                            {event.type === 'Warning' ? (
                              <WarningOutlined style={{ color: '#faad14' }} />
                            ) : (
                              <InfoCircleOutlined style={{ color: '#52c41a' }} />
                            )}
                            <Text strong>{event.reason}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {new Date(event.lastTimestamp || event.firstTimestamp || 0).toLocaleString()}
                            </Text>
                          </Space>
                          <div style={{ marginTop: 4, paddingLeft: 24 }}>
                            <Text style={{ fontSize: 12 }}>{event.message}</Text>
                          </div>
                        </div>
                      ))}
                    </Space>
                  </Panel>
                </Collapse>
              </div>
            </Descriptions.Item>
          ) : (
            <Descriptions.Item label="事件记录" span={2}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                暂无事件记录
              </Text>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>
    );
  };

  const renderSummary = (diagnosis: DiagnosisResult, isVMError: boolean, vmiStatus: any) => {
    return (
      <Card {...DIAG_STEP_CONTENT_CARD}>
        <Descriptions column={2} size="small" style={DIAG_DESC_INNER}>
          {isVMError && (
            <Descriptions.Item label="诊断结果" span={2}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Alert
                  message="检测到问题"
                  description={
                    <div>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                        根据当前状态，可能的原因包括：
                      </Text>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {diagnosis.nodeAffinity?.required && (
                          <li>
                            <Text style={{ fontSize: 12 }}>
                              节点亲和性不满足：需要节点标签 <Text code>{diagnosis.nodeAffinity.label}</Text>
                            </Text>
                          </li>
                        )}
                        {!vmiStatus && (
                          <li>
                            <Text style={{ fontSize: 12 }}>
                              VMI 未创建：可能是调度失败，检查节点资源和标签
                            </Text>
                          </li>
                        )}
                        {diagnosis.pvcStatus && diagnosis.pvcStatus.length > 0 && (
                          <li>
                            <Text style={{ fontSize: 12 }}>
                              检查 PVC 状态：确保所有 PVC 已创建且已绑定
                            </Text>
                          </li>
                        )}
                        {diagnosis.networkStatus?.multusNetworks && diagnosis.networkStatus.multusNetworks.length > 0 && (
                          <li>
                            <Text style={{ fontSize: 12 }}>
                              检查 Multus 网络配置：确保网络配置存在
                            </Text>
                          </li>
                        )}
                      </ul>
                    </div>
                  }
                  type="warning"
                  showIcon
                />
                <div style={{ 
                  padding: '12px', 
                  background: '#fff7e6',
                  borderRadius: 8,
                  border: '1px solid #ffe58f'
                }}>
                  <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>建议操作：</Text>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      <Text style={{ fontSize: 12 }}>查看"事件"标签页获取详细错误信息</Text>
                    </li>
                    <li>
                      <Text style={{ fontSize: 12 }}>查看"日志"标签页查看 Pod 日志</Text>
                    </li>
                    <li>
                      <Text style={{ fontSize: 12 }}>检查节点资源是否充足</Text>
                    </li>
                    <li>
                      <Text style={{ fontSize: 12 }}>检查节点标签是否符合要求</Text>
                    </li>
                  </ul>
                </div>
              </Space>
            </Descriptions.Item>
          )}
          {!isVMError && (
            <Descriptions.Item label="诊断结果" span={2}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Alert
                  message="诊断完成"
                  description="未检测到明显问题，虚拟机状态正常"
                  type="success"
                  showIcon
                />
                <div style={{ 
                  padding: '12px', 
                  background: '#f6ffed',
                  borderRadius: 8,
                  border: '1px solid #b7eb8f'
                }}>
                  <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>建议操作：</Text>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      <Text style={{ fontSize: 12 }}>如仍有问题，可查看"事件"和"日志"标签页获取详细信息</Text>
                    </li>
                    <li>
                      <Text style={{ fontSize: 12 }}>定期检查节点资源使用情况</Text>
                    </li>
                  </ul>
                </div>
              </Space>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>
    );
  };

  if (loading && !diagnosis) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: VM_DIAGNOSIS_TEXT_SECONDARY }}>正在诊断...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          message="诊断失败"
          description={error}
          type="error"
          showIcon
          action={
            <Button size="small" onClick={loadDiagnosis} icon={<ReloadOutlined />}>
              重试
            </Button>
          }
        />
      </div>
    );
  }

  if (!diagnosis) {
    return (
      <div style={{ padding: 24 }}>
        <Empty description="暂无诊断数据" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: VM_DIAGNOSIS_SECTION_GAP }}>
      {/* 步骤条 - 每个步骤的内容直接显示在步骤下方 */}
      {steps.length > 0 && (
        <Card variant="borderless" styles={{ body: { padding: '16px 24px' } }} style={DIAG_PAGE_SHELL_STYLE}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button type="primary" icon={<ReloadOutlined />} onClick={loadDiagnosis} loading={loading}>
              重新诊断
            </Button>
          </div>
          <Steps
            direction="vertical"
            size="small"
            current={currentStep}
            items={steps.map((step, index) => {
              const showContent =
                step.status === 'finish' || step.status === 'error' || (step.status === 'process' && index === currentStep);

              const icon =
                step.status === 'process' ? (
                  <LoadingOutlined />
                ) : step.status === 'finish' ? (
                  <CheckCircleOutlined />
                ) : step.status === 'error' ? (
                  <CloseCircleOutlined />
                ) : undefined;

              return {
                key: step.key,
                title: step.title,
                status: step.status,
                icon,
                description: (
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {step.description && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {step.description}
                      </Text>
                    )}
                    {showContent && step.content}
                  </Space>
                ),
              };
            })}
          />
        </Card>
      )}

      {steps.length === 0 && diagnosis && (
        <Card variant="borderless" styles={{ body: { padding: 24, textAlign: 'center' } }} style={DIAG_PAGE_SHELL_STYLE}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" icon={<ReloadOutlined />} onClick={loadDiagnosis} loading={loading}>
              重新诊断
            </Button>
          </div>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: VM_DIAGNOSIS_TEXT_SECONDARY }}>正在初始化诊断步骤...</div>
        </Card>
      )}
    </div>
  );
};

export default VmDiagnosisContent;
