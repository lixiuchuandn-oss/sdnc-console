import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, Descriptions, Tag, Alert, Space, Button, Spin, Empty, Typography, Collapse, Steps } from 'antd';
import { 
  CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, 
  ReloadOutlined, InfoCircleOutlined, WarningOutlined, LoadingOutlined 
} from '@ant-design/icons';
import { fetchHarvesterVMAggregated, fetchHarvesterNodes, fetchHarvesterVolume, fetchHarvesterResourceByLink } from '../../../../services/harvesterApi';
import { API_BASE_URL } from '../../../../services/api';
import { fetchHarvesterVmPod } from '../../../../services/loggingApi';
import { fetchHarvesterEvents } from '../../../../services/loggingApi';
import { getToken } from '../../../../utils/tokenStorage';

// 解析 CPU 字符串为核数
const parseCpuToCores = (s: string | undefined): number => {
  if (s == null || typeof s !== 'string') return 0;
  const t = s.trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([mun])?$/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (Number.isNaN(num)) return 0;
  const suffix = (m[2] || '').toLowerCase();
  if (suffix === 'm') return num / 1000;
  if (suffix === 'u') return num / 1e6;
  if (suffix === 'n') return num / 1e9;
  return num;
};

// 解析内存字符串为字节数
const parseMemoryToBytes = (s: string | undefined): number => {
  if (s == null || typeof s !== 'string') return 0;
  const t = s.trim();
  const m = t.match(/^(\d+)\s*([KMGTP]i?)?$/i);
  if (!m) return 0;
  const num = parseInt(m[1], 10);
  if (Number.isNaN(num)) return 0;
  const suffix = (m[2] || '').toLowerCase();
  if (suffix === 'ki') return num * 1024;
  if (suffix === 'mi') return num * 1024 ** 2;
  if (suffix === 'gi') return num * 1024 ** 3;
  if (suffix === 'ti') return num * 1024 ** 4;
  if (suffix === 'pi') return num * 1024 ** 5;
  if (suffix === 'k') return num * 1000;
  if (suffix === 'm') return num * 1e6;
  if (suffix === 'g') return num * 1e9;
  if (suffix === 't') return num * 1e12;
  if (suffix === 'p') return num * 1e15;
  return num;
};

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;

const buildLogWsUrl = (
  baseHttp: string,
  cloudId: string,
  namespace: string,
  podName: string,
  token: string,
  opt: { tailLines: number }
): string => {
  const base = baseHttp.replace(/^http/, 'ws');
  const sep = base.endsWith('/') ? '' : '/';
  const q = new URLSearchParams({
    token,
    cloudId,
    namespace,
    podName,
    container: 'compute',
    tailLines: String(opt.tailLines),
  });
  return `${base}${sep}ws/kv-pod-log?${q}`;
};

const parseWsData = async (data: string | Blob | ArrayBuffer): Promise<string> => {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return data.text();
  return new TextDecoder().decode(data);
};

interface LogAnalysis {
  highlights: string[];
  hints: string[];
  summary: string;
  suggestions: string[];
  severity: 'error' | 'warning' | 'info';
}

const summarizePodLogs = (raw: string): LogAnalysis => {
  const lines = String(raw || '')
    .split('\n')
    .map((s) => s.trimEnd())
    .filter((s) => !!s && s.trim().length > 0);

  const hitRe =
    /(failed|error|fatal|panic|exception|forbidden|permission denied|unauthorized|imagepullbackoff|crashloopbackoff|failedmount|attachvolume|multus|cni|failedcreatepodsandbox|no ip addresses available|timed out|timeout|libvirt|dbus|machine-id|socket|connection)/i;
  const candidates = lines.filter((l) => hitRe.test(l));

  const sample = candidates.slice(-12);
  const hints = new Set<string>();
  let summary = '';
  const suggestions: string[] = [];
  let severity: 'error' | 'warning' | 'info' = 'info';

  // 分析错误类型
  for (const l of candidates) {
    const s = l.toLowerCase();
    
    // 网络相关
    if (s.includes('no ip addresses available') || s.includes('failedcreatepodsandbox') || s.includes('cni') || s.includes('multus')) {
      hints.add('网络问题');
      if (!summary) {
        summary = '检测到网络配置问题';
        severity = 'error';
        suggestions.push('IP 地址池可能已耗尽，检查 Calico IPPool 资源');
        suggestions.push('检查 Multus 网络配置是否正确');
        suggestions.push('检查 CNI 插件是否正常运行');
      }
    }
    
    // 存储相关
    if (s.includes('failedmount') || s.includes('attachvolume') || s.includes('mount')) {
      hints.add('存储问题');
      if (!summary) {
        summary = '检测到存储挂载问题';
        severity = 'error';
        suggestions.push('检查 PVC 是否存在且已绑定');
        suggestions.push('检查存储类（StorageClass）配置');
        suggestions.push('检查节点是否有足够的存储空间');
      }
    }
    
    // 权限相关
    if (s.includes('forbidden') || s.includes('permission denied') || s.includes('unauthorized')) {
      hints.add('权限问题');
      if (!summary) {
        summary = '检测到权限问题';
        severity = 'error';
        suggestions.push('检查 ServiceAccount 权限配置');
        suggestions.push('检查 RBAC 规则是否正确');
      }
    }
    
    // 镜像拉取
    if (s.includes('imagepullbackoff')) {
      hints.add('镜像拉取失败');
      if (!summary) {
        summary = '检测到镜像拉取失败';
        severity = 'error';
        suggestions.push('检查镜像仓库是否可访问');
        suggestions.push('检查镜像拉取密钥（ImagePullSecret）配置');
        suggestions.push('检查网络连接是否正常');
      }
    }
    
    // 容器崩溃
    if (s.includes('crashloopbackoff') || s.includes('panic') || s.includes('exception')) {
      hints.add('容器崩溃');
      if (!summary) {
        summary = '检测到容器崩溃';
        severity = 'error';
        suggestions.push('查看完整日志了解崩溃原因');
        suggestions.push('检查容器资源限制是否充足');
        suggestions.push('检查应用程序配置是否正确');
      }
    }
    
    // 超时
    if (s.includes('timeout') || s.includes('timed out')) {
      hints.add('操作超时');
      if (!summary) {
        summary = '检测到操作超时';
        severity = 'warning';
        suggestions.push('检查网络连接是否稳定');
        suggestions.push('检查目标服务是否响应正常');
      }
    }
    
    // Libvirt 相关错误（虚拟机管理程序）
    if (s.includes('libvirt') || s.includes('virtqemud') || s.includes('dbus') || s.includes('machine-id')) {
      hints.add('虚拟机管理程序');
      if (s.includes('failed to connect') || s.includes('no such file') || s.includes('cannot spawn')) {
        if (!summary || severity === 'info') {
          summary = '虚拟机管理程序连接问题（通常可自动恢复）';
          severity = 'warning';
          suggestions.push('这是容器启动过程中的常见警告，通常会自动恢复');
          suggestions.push('如果虚拟机无法启动，检查节点上的 libvirt 服务状态');
          suggestions.push('检查容器是否有足够的权限访问 libvirt socket');
        }
      }
    }
  }

  // 如果没有检测到明显错误，但有很多日志
  if (!summary && candidates.length > 0) {
    summary = '检测到一些警告信息（可能不影响运行）';
    severity = 'info';
    suggestions.push('如果虚拟机运行正常，这些警告可以忽略');
    suggestions.push('如果虚拟机无法启动，请查看完整日志');
  }

  // 如果完全没有错误
  if (!summary) {
    summary = '未检测到明显错误';
    severity = 'info';
    suggestions.push('日志中未发现明显的错误信息');
    suggestions.push('如果仍有问题，请查看完整日志');
  }

  return { 
    highlights: sample, 
    hints: Array.from(hints),
    summary,
    suggestions,
    severity
  };
};

const fetchVirtLauncherPodLogSummary = async (
  cloudId: string,
  namespace: string,
  podName: string,
  opt?: { tailLines?: number; timeoutMs?: number }
): Promise<{ checked: boolean; error?: string; highlights: string[]; hints: string[]; summary?: string; suggestions?: string[]; severity?: 'error' | 'warning' | 'info' }> => {
  const token = getToken() || '';
  if (!token) return { checked: false, error: '未登录', highlights: [], hints: [], summary: '无法获取日志', suggestions: [] };

  const tailLines = opt?.tailLines ?? 200;
  const timeoutMs = opt?.timeoutMs ?? 1500;
  const origin = API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin;
  const url = buildLogWsUrl(origin, cloudId, namespace, podName, token, { tailLines });

  return new Promise((resolve) => {
    let finished = false;
    let buffer = '';
    const safeResolve = (v: { checked: boolean; error?: string; highlights: string[]; hints: string[]; summary?: string; suggestions?: string[]; severity?: 'error' | 'warning' | 'info' }) => {
      if (finished) return;
      finished = true;
      resolve(v);
    };

    let ws: WebSocket | null = null;
    const timer = setTimeout(() => {
      try {
        ws?.close(1000, 'timeout');
      } catch {}
      const analysis = summarizePodLogs(buffer);
      safeResolve({ checked: true, ...analysis });
    }, timeoutMs);

    try {
      ws = new WebSocket(url);
      ws.onmessage = async (ev) => {
        const text = await parseWsData(ev.data);
        buffer += text;
        if (buffer.length > 256 * 1024) {
          try {
            ws?.close(1000, 'enough');
          } catch {}
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        safeResolve({ checked: false, error: '日志连接失败', highlights: [], hints: [], summary: '无法连接日志服务', suggestions: [] });
      };
      ws.onclose = () => {
        clearTimeout(timer);
        const analysis = summarizePodLogs(buffer);
        safeResolve({ checked: true, ...analysis });
      };
    } catch (e: any) {
      clearTimeout(timer);
      safeResolve({ checked: false, error: e?.message || '日志连接失败', highlights: [], hints: [], summary: '无法获取日志', suggestions: [] });
    }
  });
};

interface HarvesterVmDiagnosisTabProps {
  cloudId?: string;
  record: any;
  active: boolean;
}

interface DiagnosisResult {
  vmStatus?: any;
  vmiStatus?: any;
  podInfo?: any;
  podLogs?: {
    checked: boolean;
    error?: string;
    highlights: string[];
    hints: string[];
    summary?: string;
    suggestions?: string[];
    severity?: 'error' | 'warning' | 'info';
  };
  events?: any[];
  nodeAffinity?: {
    required: boolean;
    valid: boolean;
    checked: boolean;
    label: string;
    nodesWithLabel: number;
    totalNodes?: number;
    matchedNodeNames?: string[];
    message: string;
  };
  resources?: {
    cpuRequest: string;
    memoryRequest: string;
    cpuLimit: string;
    memoryLimit: string;
    nodeResourceCheck?: {
      checked: boolean;
      sufficient: boolean;
      message: string;
      requiredCpu?: string;
      requiredMemory?: string;
      nodes?: Array<{
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
      }>;
    };
  };
  pvcStatus?: any[];
  networkStatus?: {
    multusNetworks: any[];
    message: string;
  };
  eventAnalysis?: {
    podCreateDeleteCycle: boolean;
    podCreateCount: number;
    podDeleteCount: number;
    vmiStoppedCount: number;
    recentPattern: string;
    suggestions: string[];
    ipExhaustionNodes?: string[]; // IP 地址耗尽相关的节点列表
    volumeConflictDetails?: Array<{ volume: string; currentNode: string; targetNode: string }>; // 存储卷挂载冲突详情
  };
}

type StepStatus = 'wait' | 'process' | 'finish' | 'error';

interface DiagnosisStep {
  key: string;
  title: string;
  description?: string;
  status: StepStatus;
  content?: React.ReactNode;
}

const HarvesterVmDiagnosisTab: React.FC<HarvesterVmDiagnosisTabProps> = ({ 
  cloudId, 
  record, 
  active 
}) => {
  const [loading, setLoading] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState<string>('');
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [steps, setSteps] = useState<DiagnosisStep[]>([]);
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
      
      console.log('[诊断] VMI 判断:', {
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
      
      console.log('[诊断] VMI 状态对象:', {
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
      const networkStatus = analyzeNetworkStatus(vmData);

      const podLogs = podData?.podName ? await fetchVirtLauncherPodLogSummary(cloudId, namespace, podData.podName) : undefined;

      // 分析事件模式，检测 Pod 频繁创建/删除循环（使用合并后的事件）
      // 传入 VM 状态和 Pod 信息，以便正确判断运行状态
      const eventAnalysis = analyzeEvents(allEvents, vmData?.status, podData);

      const diagnosisResult: DiagnosisResult = {
        vmStatus: vmData?.status,
        vmiStatus: vmiStatusObj,
        podInfo: podData,
        podLogs,
        events: allEvents.slice(0, 30), // 最近30条事件（包含 Pod 和 VMI 事件）
        nodeAffinity,
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
          if (checked.some((p: any) => p?.exists === true && p?.bound === false)) return 'error';
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

    // 获取节点亲和性规则
    const nodeAffinity = vm?.spec?.template?.spec?.affinity?.nodeAffinity;
    const requiredAffinity = nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution;
    const preferredAffinity = nodeAffinity?.preferredDuringSchedulingIgnoredDuringExecution;

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

      // 检查必需节点亲和性
      let matchesRequiredAffinity = true;
      if (requiredAffinity?.nodeSelectorTerms) {
        const terms = Array.isArray(requiredAffinity.nodeSelectorTerms) ? requiredAffinity.nodeSelectorTerms : [];
        if (terms.length > 0) {
          // 至少满足一个 term（OR 关系）
          matchesRequiredAffinity = terms.some((term: any) => termMatches(labelsObj, term));
        }
      }

      // 检查污点容忍
      const tolerates = toleratesTaints(node);

      // 如果满足必需亲和性和污点容忍，则节点符合条件
      if (matchesRequiredAffinity && tolerates) {
        eligibleNodes.push(node);
      }
    }

    // 如果没有必需亲和性，所有节点都符合（只要满足污点容忍）
    if (!requiredAffinity?.nodeSelectorTerms || requiredAffinity.nodeSelectorTerms.length === 0) {
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
        
        console.log('[节点资源检查] 已运行节点资源:', {
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

    const claims = volumes
      .filter((v: any) => v?.persistentVolumeClaim?.claimName)
      .map((v: any) => ({
        name: v.name,
        pvcName: String(v.persistentVolumeClaim.claimName),
      }));

    if (claims.length === 0) return [];

    const normalizePhase = (obj: any): string => {
      const source = obj?.rawData || obj?.data || obj || {};
      return source?.status?.phase || source?.status?.state || obj?.phase || obj?.state || 'Unknown';
    };

    const normalizeMeta = (obj: any): { name: string; namespace: string } => {
      const source = obj?.rawData || obj?.data || obj || {};
      const meta = source?.metadata || obj?.metadata || {};
      return {
        name: String(meta?.name || obj?.name || '').trim(),
        namespace: String(meta?.namespace || obj?.namespace || vmNamespace || '').trim(),
      };
    };

    const relatedMap = new Map<string, any>();
    if (Array.isArray(relatedVolumes)) {
      relatedVolumes.forEach((x: any) => {
        const m = normalizeMeta(x);
        if (!m.name || !m.namespace) return;
        relatedMap.set(`${m.namespace}/${m.name}`, x);
      });
    }

    const results = await Promise.allSettled(
      claims.map(async (c) => {
        const key = `${vmNamespace}/${c.pvcName}`;
        const related = relatedMap.get(key);
        if (related) {
          const phase = normalizePhase(related);
          const bound = String(phase).toLowerCase() === 'bound';
          return { ...c, exists: true, checked: true, phase, bound };
        }

        try {
          const detail: any = await fetchHarvesterVolume(cid, vmNamespace, c.pvcName);
          const phase = normalizePhase(detail);
          const bound = String(phase).toLowerCase() === 'bound';
          return { ...c, exists: true, checked: true, phase, bound };
        } catch (e: any) {
          const msg = String(e?.message || e || '').toLowerCase();
          if (msg.includes('403') || msg.includes('forbidden') || msg.includes('permission')) {
            return { ...c, exists: false, checked: false, phase: 'Unknown', bound: false };
          }
          return { ...c, exists: false, checked: true, phase: 'NotFound', bound: false };
        }
      })
    );

    return results.map((r) => {
      if (r.status === 'fulfilled') return r.value;
      return { name: '-', pvcName: '-', exists: false, checked: false, phase: 'Unknown', bound: false };
    });
  };

  const analyzeEvents = (events: any[], vmStatus?: any, podInfo?: any): DiagnosisResult['eventAnalysis'] => {
    if (!events || events.length === 0) {
      // 如果没有事件，但 VM 状态是 Running 且 Pod 存在，认为正常运行
      const vmRunning = vmStatus?.printableStatus === 'Running' || vmStatus?.ready === true;
      const podExists = podInfo?.podName;
      if (vmRunning && podExists) {
        return {
          podCreateDeleteCycle: false,
          podCreateCount: 0,
          podDeleteCount: 0,
          vmiStoppedCount: 0,
          recentPattern: '正常运行',
          suggestions: [],
        };
      }
      return {
        podCreateDeleteCycle: false,
        podCreateCount: 0,
        podDeleteCount: 0,
        vmiStoppedCount: 0,
        recentPattern: '无事件',
        suggestions: [],
      };
    }

    // 统计最近的事件
    const podCreates = events.filter((e: any) => 
      e.reason === 'SuccessfulCreate' && 
      e.message?.includes('virt-launcher')
    );
    const podDeletes = events.filter((e: any) => 
      e.reason === 'SuccessfulDelete' && 
      e.message?.includes('virt-launcher')
    );
    const vmiStopped = events.filter((e: any) => 
      e.reason === 'Stopped' || 
      e.message?.includes('shut down')
    );

    // 检测存储卷挂载错误
    const volumeAttachErrors = events.filter((e: any) => 
      e.reason === 'FailedMount' ||
      e.reason === 'FailedAttachVolume' ||
      e.message?.includes('AttachVolume') ||
      e.message?.includes('failed to attach') ||
      e.message?.includes('currently attached to different node')
    );

    // 检测存储卷挂载冲突（卷已挂载到其他节点）
    const volumeConflictErrors = volumeAttachErrors.filter((e: any) => 
      e.message?.includes('currently attached to different node') ||
      e.message?.includes('attached to different node')
    );

    // 提取存储卷挂载冲突的节点和卷信息
    const volumeConflictDetails: Array<{ volume: string; currentNode: string; targetNode: string }> = [];
    volumeConflictErrors.forEach((e: any) => {
      const msg = e.message || '';
      // 提取卷名称（PVC）
      const volumeMatch = msg.match(/volume\s+["']?([^"'\s]+)["']?/i) || msg.match(/pvc-[\w-]+/i);
      // 提取当前挂载的节点
      const currentNodeMatch = msg.match(/attached to (?:different )?node\s+([a-zA-Z0-9\-\.]+)/i);
      // 提取目标节点（尝试挂载的节点）
      const targetNodeMatch = msg.match(/attach to node\s+([a-zA-Z0-9\-\.]+)/i) || 
                             msg.match(/node\s+([a-zA-Z0-9\-\.]+)\s+with attachmentID/i);
      
      if (volumeMatch && currentNodeMatch) {
        volumeConflictDetails.push({
          volume: volumeMatch[1],
          currentNode: currentNodeMatch[1],
          targetNode: targetNodeMatch ? targetNodeMatch[1] : '未知',
        });
      }
    });

    // 检测网络相关错误
    const failedPodSandbox = events.filter((e: any) => 
      e.reason === 'FailedCreatePodSandBox'
    );
    
    // 检测 IP 地址耗尽错误
    const ipExhaustionErrors = failedPodSandbox.filter((e: any) => 
      e.message?.includes('no IP addresses available') ||
      e.message?.includes('failed to allocate for range')
    );

    // 提取 IP 地址耗尽事件关联的节点信息
    const ipExhaustionNodes = new Set<string>();
    ipExhaustionErrors.forEach((e: any) => {
      // 尝试从事件中提取节点信息
      // 1. 从 source.host 获取（如果存在，这通常是报告事件的节点）
      if (e.source?.host) {
        ipExhaustionNodes.add(e.source.host);
      }
      // 2. 从 involvedObject 的字段中获取（如果事件关联的是 Pod，Pod 可能包含 nodeName）
      // 注意：事件本身通常不包含 Pod 的 nodeName，因为 Pod 可能还未调度
      // 但我们可以尝试从 involvedObject 中获取
      if (e.involvedObject?.fieldPath) {
        // fieldPath 可能包含节点信息，例如 "spec.nodeName"
        const nodeMatch = e.involvedObject.fieldPath.match(/nodeName[:\s]+([a-zA-Z0-9\-\.]+)/i);
        if (nodeMatch && nodeMatch[1]) {
          ipExhaustionNodes.add(nodeMatch[1]);
        }
      }
      // 3. 从 message 中尝试提取节点信息（如果消息中包含节点名称）
      const nodeMatch = e.message?.match(/node[:\s]+([a-zA-Z0-9\-\.]+)/i);
      if (nodeMatch && nodeMatch[1]) {
        ipExhaustionNodes.add(nodeMatch[1]);
      }
      // 4. 尝试从 involvedObject.name 中提取（如果 Pod 名称包含节点信息）
      // 通常 Pod 名称不包含节点信息，但我们可以尝试
    });

    // 检测其他网络错误
    const networkErrors = failedPodSandbox.filter((e: any) => 
      !e.message?.includes('no IP addresses available') &&
      !e.message?.includes('failed to allocate for range')
    );

    // 检测 Pod 创建/删除循环（短时间内多次创建和删除）
    const recentEvents = events.slice(0, 10); // 最近10条事件
    const hasCreateDeletePattern = 
      podCreates.length >= 2 && 
      podDeletes.length >= 2 &&
      recentEvents.some((e: any) => e.reason === 'SuccessfulCreate') &&
      recentEvents.some((e: any) => e.reason === 'SuccessfulDelete');

    const suggestions: string[] = [];
    let recentPattern = '';

    // 优先级1: 存储卷挂载冲突（最严重，会导致 VM 无法启动）
    if (volumeConflictErrors.length > 0) {
      recentPattern = '存储卷挂载冲突';
      suggestions.push('检测到存储卷挂载冲突：卷已挂载到其他节点，无法挂载到新节点');
      if (volumeConflictDetails.length > 0) {
        volumeConflictDetails.forEach((detail) => {
          suggestions.push(`卷 ${detail.volume} 当前挂载在节点 ${detail.currentNode}，尝试挂载到节点 ${detail.targetNode}`);
        });
      }
      suggestions.push('解决方案：');
      suggestions.push('  1. 检查卷是否仍在旧节点上使用（查看旧节点上的 Pod）');
      suggestions.push('  2. 如果 VM 已迁移，等待旧节点上的卷自动卸载（通常需要几分钟）');
      suggestions.push('  3. 如果问题持续，手动检查 CSI 驱动状态：kubectl get csinode');
      suggestions.push('  4. 检查存储类（StorageClass）配置是否正确');
      suggestions.push('  5. 如果问题无法自动恢复，考虑重启相关节点的 CSI 驱动或联系管理员');
    }
    // 优先级2: IP 地址耗尽
    else if (ipExhaustionErrors.length > 0) {
      recentPattern = 'IP 地址池耗尽';
      suggestions.push('Calico IP 地址池已用完，无法为新 Pod 分配 IP 地址');
      if (ipExhaustionNodes.size > 0) {
        suggestions.push(`检测到相关节点: ${Array.from(ipExhaustionNodes).join(', ')}`);
      } else {
        suggestions.push('注意：IP 地址耗尽通常是集群级别问题，影响所有节点');
      }
      suggestions.push('检查 IP 地址池使用情况：查看 Calico IPPool 资源');
      suggestions.push('解决方案：');
      suggestions.push('  1. 扩大 IP 地址池范围');
      suggestions.push('  2. 清理未使用的 Pod 释放 IP 地址');
      suggestions.push('  3. 检查是否有 Pod 泄漏（已删除但 IP 未释放）');
      suggestions.push('  4. 考虑使用更大的 IP 地址段');
    } 
    // 优先级2: 其他网络错误
    else if (networkErrors.length > 0) {
      recentPattern = '网络配置错误';
      suggestions.push('Pod 网络创建失败，检查网络配置');
      suggestions.push('检查 Multus 网络配置是否正确');
      suggestions.push('检查 Calico/CNI 插件状态');
    }
    // 优先级3: Pod 创建/删除循环
    else if (hasCreateDeletePattern) {
      recentPattern = '检测到 Pod 频繁创建/删除循环';
      suggestions.push('Pod 可能在不断重启，检查 Pod 调度状态和资源限制');
      suggestions.push('查看 Pod 日志了解启动失败原因');
      suggestions.push('检查节点资源是否充足');
    } 
    // 其他情况
    else if (podCreates.length > 0 && podDeletes.length === 0) {
      // 检查 VM 实际运行状态
      const vmRunning = vmStatus?.printableStatus === 'Running' || vmStatus?.ready === true;
      const podExists = podInfo?.podName;
      
      if (vmRunning && podExists) {
        // VM 正在运行且 Pod 存在，认为正常运行
        recentPattern = '正常运行';
        suggestions.push('虚拟机正在正常运行');
      } else {
        // Pod 已创建但 VM 未运行，可能有问题
        recentPattern = 'Pod 已创建但可能未正常运行';
        suggestions.push('检查 Pod 是否处于 Pending 状态（调度失败）');
        suggestions.push('查看 Pod 事件了解调度失败原因');
      }
    } else if (vmiStopped.length > 0) {
      recentPattern = 'VMI 已停止';
      suggestions.push('检查 VMI 停止原因（正常关机或异常退出）');
      suggestions.push('如果 runStrategy 为 Always，VMI 应该自动重启');
    } else if (podCreates.length === 0 && podDeletes.length === 0) {
      recentPattern = '未检测到 Pod 创建事件';
      suggestions.push('VMI 可能尚未创建，检查调度约束和资源需求');
    }

    return {
      podCreateDeleteCycle: hasCreateDeletePattern || ipExhaustionErrors.length > 0 || volumeConflictErrors.length > 0,
      podCreateCount: podCreates.length,
      podDeleteCount: podDeletes.length,
      vmiStoppedCount: vmiStopped.length,
      recentPattern,
      suggestions,
      ipExhaustionNodes: ipExhaustionNodes.size > 0 ? Array.from(ipExhaustionNodes) : undefined,
      volumeConflictDetails: volumeConflictDetails.length > 0 ? volumeConflictDetails : undefined,
    };
  };

  const analyzeNetworkStatus = (vm: any): DiagnosisResult['networkStatus'] => {
    if (!vm?.spec?.template?.spec?.networks) {
      return {
        multusNetworks: [],
        message: '未配置网络'
      };
    }

    const multusNetworks = vm.spec.template.spec.networks
      .filter((n: any) => n.multus)
      .map((n: any) => ({
        name: n.name,
        networkName: n.multus.networkName,
      }));

    return {
      multusNetworks,
      message: multusNetworks.length > 0 
        ? `配置了 ${multusNetworks.length} 个 Multus 网络`
        : '未配置 Multus 网络'
    };
  };

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
    if (!vmStatus) return <Empty description="无状态信息" />;
    return (
      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
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
        <Card variant="borderless" styles={{ body: { padding: 0 } }}>
          <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
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
      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
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
        <Card variant="borderless" styles={{ body: { padding: 0 } }}>
          <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
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
      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
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
                    borderRadius: 4,
                    border: `1px solid ${podLogs.severity === 'error' ? '#ffccc7' : podLogs.severity === 'warning' ? '#ffe58f' : '#91d5ff'}`
                  }}>
                    <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>建议操作：</Text>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {podLogs.suggestions.map((suggestion: string, idx: number) => (
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
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            （技术细节，普通用户可忽略）
                          </Text>
                        </Space>
                      } 
                      key="log-summary"
                    >
                      <div style={{ 
                        padding: '8px', 
                        background: '#f5f5f5', 
                        borderRadius: 4,
                        maxHeight: '400px',
                        overflow: 'auto'
                      }}>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, fontFamily: 'monospace' }}>
                          {podLogs.highlights.join('\n')}
                        </pre>
                      </div>
                      <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
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
      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
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

  const renderResources = (resources: any) => {
    if (!resources) return null;
    const nodeCheck = resources.nodeResourceCheck;
    return (
      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
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
                          style={{
                            padding: '12px',
                            background: node.sufficient ? '#f6ffed' : '#fff1f0',
                            borderRadius: 4,
                            border: `1px solid ${node.sufficient ? '#b7eb8f' : '#ffccc7'}`,
                          }}
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
        <Card variant="borderless" styles={{ body: { padding: 0 } }}>
          <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
            <Descriptions.Item label="存储卷" span={2}>
              <Text type="secondary" style={{ fontSize: 12 }}>未配置存储卷</Text>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      );
    }
    return (
      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
          {pvcStatus.map((pvc, idx) => (
            <React.Fragment key={idx}>
              <Descriptions.Item label="卷名称">
                <Text code>{pvc.name}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="PVC 名称">
                <Text code>{pvc.pvcName}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="状态" span={2}>
                <Space>
                  {pvc.checked !== true ? (
                    <>
                      <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                      <Tag color="default">未校验</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        无法获取 PVC 详情（可能无权限或接口不可用）
                      </Text>
                    </>
                  ) : pvc.exists === false ? (
                    <>
                      <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                      <Tag color="error">不存在</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        PVC 不存在（或当前账号无权限访问该命名空间的 PVC）
                      </Text>
                    </>
                  ) : pvc.bound === true ? (
                    <>
                      <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      <Tag color="success">已绑定</Tag>
                    </>
                  ) : (
                    <>
                      <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                      <Tag color="warning">{pvc.phase || 'Unknown'}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        PVC 未绑定或处于异常状态
                      </Text>
                    </>
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
      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
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
        <Card variant="borderless" styles={{ body: { padding: 0 } }}>
          <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
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
      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Space direction="vertical" style={{ width: '100%', padding: '16px 24px' }}>
          {/* 显示事件分析摘要 */}
          <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
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
          </Descriptions>

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
          {eventAnalysis.suggestions.length > 0 && (
            <div>
              <Text strong>建议操作：</Text>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                {eventAnalysis.suggestions.map((suggestion: string, idx: number) => (
                  <li key={idx}>
                    <Text style={{ fontSize: 12 }}>{suggestion}</Text>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {events && events.length > 0 ? (
            <Collapse size="small" ghost>
              <Panel header={`查看最近事件 (${events.length} 条)`} key="events">
                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  {events.slice(0, 10).map((event: any, idx: number) => (
                    <div key={idx} style={{ 
                      padding: '8px', 
                      background: event.type === 'Warning' ? '#fff7e6' : '#f6ffed',
                      borderRadius: 4,
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
          ) : (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                暂无事件记录
              </Text>
            </div>
          )}
        </Space>
      </Card>
    );
  };

  const renderSummary = (diagnosis: DiagnosisResult, isVMError: boolean, vmiStatus: any) => {
    return (
      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Space direction="vertical" style={{ width: '100%', padding: '16px 24px' }}>
          {isVMError && (
            <Alert
              message="检测到问题"
              description={
                <div>
                  <Paragraph style={{ marginBottom: 8 }}>
                    根据当前状态，可能的原因包括：
                  </Paragraph>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {diagnosis.nodeAffinity?.required && (
                      <li>节点亲和性不满足：需要节点标签 {diagnosis.nodeAffinity.label}</li>
                    )}
                    {!vmiStatus && (
                      <li>VMI 未创建：可能是调度失败，检查节点资源和标签</li>
                    )}
                    {diagnosis.pvcStatus && diagnosis.pvcStatus.length > 0 && (
                      <li>检查 PVC 状态：确保所有 PVC 已创建且已绑定</li>
                    )}
                    {diagnosis.networkStatus?.multusNetworks && diagnosis.networkStatus.multusNetworks.length > 0 && (
                      <li>检查 Multus 网络配置：确保网络配置存在</li>
                    )}
                  </ul>
                </div>
              }
              type="warning"
              showIcon
            />
          )}
          <div>
            <Text strong>建议操作：</Text>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              <li>查看"事件"标签页获取详细错误信息</li>
              <li>查看"日志"标签页查看 Pod 日志</li>
              <li>检查节点资源是否充足</li>
              <li>检查节点标签是否符合要求</li>
            </ul>
          </div>
        </Space>
      </Card>
    );
  };

  if (loading && !diagnosis) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: '#666' }}>正在诊断...</div>
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

  const vmStatus = diagnosis.vmStatus;
  const vmiStatus = diagnosis.vmiStatus;
  const isVMError = vmStatus?.printableStatus === 'ErrorUnschedulable' || 
                    vmStatus?.printableStatus === 'ErrorPvcNotFound' ||
                    vmStatus?.conditions?.some((c: any) => c.status === 'False' && c.type === 'Ready');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 步骤条 - 每个步骤的内容直接显示在步骤下方 */}
      {steps.length > 0 && (
        <Card variant="borderless" styles={{ body: { padding: '16px 24px' } }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button type="primary" icon={<ReloadOutlined />} onClick={loadDiagnosis} loading={loading}>
              重新诊断
            </Button>
          </div>
          <Steps
            direction="vertical"
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
        <Card variant="borderless" styles={{ body: { padding: 24, textAlign: 'center' } }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" icon={<ReloadOutlined />} onClick={loadDiagnosis} loading={loading}>
              重新诊断
            </Button>
          </div>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#666' }}>正在初始化诊断步骤...</div>
        </Card>
      )}
    </div>
  );
};

export default HarvesterVmDiagnosisTab;
