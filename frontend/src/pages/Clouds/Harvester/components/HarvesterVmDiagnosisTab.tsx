import React, { useEffect, useState, useCallback } from 'react';
import { Card, Descriptions, Tag, Alert, Space, Button, Spin, Empty, Typography, Collapse, Tooltip } from 'antd';
import { 
  CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, 
  ReloadOutlined, InfoCircleOutlined, WarningOutlined 
} from '@ant-design/icons';
import { fetchHarvesterVMAggregated } from '../../../../services/harvesterApi';
import { fetchHarvesterVmPod } from '../../../../services/loggingApi';
import { fetchHarvesterEvents } from '../../../../services/loggingApi';

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;

interface HarvesterVmDiagnosisTabProps {
  cloudId?: string;
  record: any;
  active: boolean;
}

interface DiagnosisResult {
  vmStatus?: any;
  vmiStatus?: any;
  podInfo?: any;
  events?: any[];
  nodeAffinity?: {
    required: boolean;
    label: string;
    nodesWithLabel: number;
    message: string;
  };
  resources?: {
    cpuRequest: string;
    memoryRequest: string;
    cpuLimit: string;
    memoryLimit: string;
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
  };
}

const HarvesterVmDiagnosisTab: React.FC<HarvesterVmDiagnosisTabProps> = ({ 
  cloudId, 
  record, 
  active 
}) => {
  const [loading, setLoading] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState<string>('');

  const namespace = record?.metadata?.namespace || record?.namespace || 'default';
  const name = record?.metadata?.name || record?.name || '';

  const loadDiagnosis = useCallback(async () => {
    if (!active || !cloudId || !namespace || !name) return;

    setLoading(true);
    setError('');
    try {
      // 并行获取所有诊断信息
      const [vmAggregatedRes, podRes, vmiEventsRes] = await Promise.allSettled([
        fetchHarvesterVMAggregated(cloudId, namespace, name).catch(() => null),
        fetchHarvesterVmPod(cloudId, namespace, name).catch(() => ({ podName: null })),
        fetchHarvesterEvents(cloudId, namespace, name, 'VirtualMachineInstance').catch(() => ({ data: [] }))
      ]);

      const vmAggregated = vmAggregatedRes.status === 'fulfilled' ? vmAggregatedRes.value : null;
      // 处理返回结构：可能是 { vm, related } 或 { data: { vm, related } }
      const aggregatedData = vmAggregated?.data || vmAggregated;
      const vmData = aggregatedData?.vm || vmAggregated || record;
      const vmiData = aggregatedData?.vm?.vmi || vmAggregated?.vmi || null;
      const podData = podRes.status === 'fulfilled' ? podRes.value : null;
      const vmiEventsData = vmiEventsRes.status === 'fulfilled' ? vmiEventsRes.value?.data || [] : [];

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
      const nodeAffinity = analyzeNodeAffinity(vmData);
      
      // 提取资源需求
      const resources = extractResources(vmData);
      
      // 分析 PVC 状态
      const pvcStatus = analyzePVCStatus(vmData);
      
      // 分析网络配置
      const networkStatus = analyzeNetworkStatus(vmData);

      // 分析事件模式，检测 Pod 频繁创建/删除循环（使用合并后的事件）
      // 传入 VM 状态和 Pod 信息，以便正确判断运行状态
      const eventAnalysis = analyzeEvents(allEvents, vmData?.status, podData);

      // 构建 VMI 状态对象
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

      setDiagnosis({
        vmStatus: vmData?.status,
        vmiStatus: vmiStatusObj,
        podInfo: podData,
        events: allEvents.slice(0, 30), // 最近30条事件（包含 Pod 和 VMI 事件）
        nodeAffinity,
        resources,
        pvcStatus,
        networkStatus,
        eventAnalysis: analyzeEvents(allEvents, vmData?.status, podData), // 使用合并后的事件进行分析
      });
    } catch (e: any) {
      console.error('诊断失败:', e);
      setError(e?.message || '诊断失败');
    } finally {
      setLoading(false);
    }
  }, [active, cloudId, namespace, name]);

  useEffect(() => {
    if (active) {
      loadDiagnosis();
    }
  }, [active, loadDiagnosis]);

  const analyzeNodeAffinity = (vm: any): DiagnosisResult['nodeAffinity'] => {
    if (!vm?.spec?.template?.spec?.affinity?.nodeAffinity) {
      return {
        required: false,
        label: '',
        nodesWithLabel: 0,
        message: '未配置节点亲和性'
      };
    }

    const required = vm.spec.template.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution;
    if (!required?.nodeSelectorTerms?.[0]?.matchExpressions?.[0]) {
      return {
        required: false,
        label: '',
        nodesWithLabel: 0,
        message: '节点亲和性配置不完整'
      };
    }

    const expr = required.nodeSelectorTerms[0].matchExpressions[0];
    const label = expr.key;
    const value = expr.values?.[0] || '';

    return {
      required: true,
      label: `${label}=${value}`,
      nodesWithLabel: 0, // 需要从后端获取节点信息
      message: `要求节点标签: ${label}=${value}`
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

  const analyzePVCStatus = (vm: any): any[] => {
    if (!vm?.spec?.template?.spec?.volumes) {
      return [];
    }

    return vm.spec.template.spec.volumes
      .filter((v: any) => v.persistentVolumeClaim)
      .map((v: any) => ({
        name: v.name,
        pvcName: v.persistentVolumeClaim.claimName,
      }));
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

    // 检测网络相关错误
    const failedPodSandbox = events.filter((e: any) => 
      e.reason === 'FailedCreatePodSandBox'
    );
    
    // 检测 IP 地址耗尽错误
    const ipExhaustionErrors = failedPodSandbox.filter((e: any) => 
      e.message?.includes('no IP addresses available') ||
      e.message?.includes('failed to allocate for range')
    );

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

    // 优先级1: IP 地址耗尽（最严重）
    if (ipExhaustionErrors.length > 0) {
      recentPattern = 'IP 地址池耗尽';
      suggestions.push('Calico IP 地址池已用完，无法为新 Pod 分配 IP 地址');
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
      podCreateDeleteCycle: hasCreateDeletePattern || ipExhaustionErrors.length > 0,
      podCreateCount: podCreates.length,
      podDeleteCount: podDeletes.length,
      vmiStoppedCount: vmiStopped.length,
      recentPattern,
      suggestions,
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
        {/* 总体状态 */}
        {vmStatus && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>虚拟机状态</span>
              <Button 
                type="text" 
                size="small"
                icon={<ReloadOutlined />} 
                onClick={loadDiagnosis}
                loading={loading}
              />
            </div>
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
          </div>
        )}

        {/* VMI 状态 */}
        {vmiStatus ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>虚拟机实例 (VMI) 状态</span>
            </div>
            <Card variant="borderless" styles={{ body: { padding: 0 } }}>
              <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
                <Descriptions.Item label="Phase">
                  <Tag color={vmiStatus.phase === 'Running' ? 'success' : 'warning'}>
                    {vmiStatus.phase || 'Unknown'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="节点">
                  {vmiStatus.nodeName || '未调度'}
                </Descriptions.Item>
                <Descriptions.Item label="IP 地址">
                  {vmiStatus.interfaces?.[0]?.ipAddress || '未分配'}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>虚拟机实例 (VMI) 状态</span>
            </div>
            <Card variant="borderless" styles={{ body: { padding: 0 } }}>
              <div style={{ padding: '16px 24px' }}>
                <Alert
                  message="VMI 不存在"
                  description={
                    <div>
                      <Paragraph style={{ marginBottom: 8 }}>
                        虚拟机实例尚未创建，可能正在调度或遇到调度问题。
                      </Paragraph>
                      {diagnosis.podInfo?.podName ? (
                        <div>
                          <Text strong>检测到 virt-launcher Pod: </Text>
                          <Text code>{diagnosis.podInfo.podName}</Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            请查看"事件"标签页获取 Pod 调度状态详情
                          </Text>
                        </div>
                      ) : (
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            未找到 virt-launcher Pod，可能的原因：
                          </Text>
                          <ul style={{ marginTop: 8, paddingLeft: 20, fontSize: 12 }}>
                            {diagnosis.nodeAffinity?.required && (
                              <li>
                                <Text type="warning">节点亲和性不满足：</Text>
                                需要节点标签 <Text code>{diagnosis.nodeAffinity.label}</Text>
                              </li>
                            )}
                            {diagnosis.resources && (
                              <li>
                                <Text type="warning">资源不足：</Text>
                                需要 CPU {diagnosis.resources.cpuRequest}，内存 {diagnosis.resources.memoryRequest}
                              </li>
                            )}
                            {diagnosis.pvcStatus && diagnosis.pvcStatus.length > 0 && (
                              <li>
                                <Text type="warning">PVC 未绑定：</Text>
                                检查 PVC 状态
                              </li>
                            )}
                            {diagnosis.networkStatus?.multusNetworks && diagnosis.networkStatus.multusNetworks.length > 0 && (
                              <li>
                                <Text type="warning">Multus 网络配置问题：</Text>
                                检查网络配置是否存在
                              </li>
                            )}
                            <li>查看"事件"标签页获取详细错误信息</li>
                          </ul>
                        </div>
                      )}
                    </div>
                  }
                  type="warning"
                  showIcon
                />
              </div>
            </Card>
          </div>
        )}

        {/* 节点亲和性检查 */}
        {diagnosis.nodeAffinity && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>节点亲和性检查</span>
            </div>
            <Card variant="borderless" styles={{ body: { padding: 0 } }}>
              {diagnosis.nodeAffinity.required ? (
                <div style={{ padding: '16px 24px' }}>
                  <Alert
                    message={diagnosis.nodeAffinity.message}
                    description={
                      <div>
                        <Text>要求标签: <Text code>{diagnosis.nodeAffinity.label}</Text></Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          请检查集群中是否有节点具有此标签
                        </Text>
                      </div>
                    }
                    type="warning"
                    showIcon
                  />
                </div>
              ) : (
                <Text type="secondary" style={{ padding: '16px 24px', display: 'block' }}>未配置节点亲和性要求</Text>
              )}
            </Card>
          </div>
        )}

        {/* 资源需求 */}
        {diagnosis.resources && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>资源需求</span>
            </div>
            <Card variant="borderless" styles={{ body: { padding: 0 } }}>
              <Descriptions column={2} size="small" style={{ padding: '16px 24px' }}>
                <Descriptions.Item label="CPU 请求">
                  {diagnosis.resources.cpuRequest}
                </Descriptions.Item>
                <Descriptions.Item label="CPU 限制">
                  {diagnosis.resources.cpuLimit}
                </Descriptions.Item>
                <Descriptions.Item label="内存请求">
                  {diagnosis.resources.memoryRequest}
                </Descriptions.Item>
                <Descriptions.Item label="内存限制">
                  {diagnosis.resources.memoryLimit}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </div>
        )}

        {/* PVC 状态 */}
        {diagnosis.pvcStatus && diagnosis.pvcStatus.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>存储卷 (PVC) 状态</span>
            </div>
            <Card variant="borderless" styles={{ body: { padding: 0 } }}>
              <Space direction="vertical" style={{ width: '100%', padding: '16px 24px' }}>
                {diagnosis.pvcStatus.map((pvc, idx) => (
                  <div key={idx}>
                    <Text strong>{pvc.name}: </Text>
                    <Text code>{pvc.pvcName}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      请检查 PVC 是否存在且已绑定
                    </Text>
                  </div>
                ))}
              </Space>
            </Card>
          </div>
        )}

        {/* 网络配置 */}
        {diagnosis.networkStatus && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>网络配置</span>
            </div>
            <Card variant="borderless" styles={{ body: { padding: 0 } }}>
              {diagnosis.networkStatus.multusNetworks && diagnosis.networkStatus.multusNetworks.length > 0 ? (
                <Space direction="vertical" style={{ width: '100%', padding: '16px 24px' }}>
                  {diagnosis.networkStatus.multusNetworks.map((net, idx) => (
                    <div key={idx}>
                      <Text strong>{net.name}: </Text>
                      <Text code>{net.networkName}</Text>
                    </div>
                  ))}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    请检查 Multus 网络配置是否存在
                  </Text>
                </Space>
              ) : (
                <Text type="secondary" style={{ padding: '16px 24px', display: 'block' }}>{diagnosis.networkStatus.message}</Text>
              )}
            </Card>
          </div>
        )}

        {/* Pod 信息 */}
        {diagnosis.podInfo?.podName && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>virt-launcher Pod</span>
            </div>
            <Card variant="borderless" styles={{ body: { padding: 0 } }}>
              <div style={{ padding: '16px 24px' }}>
                <Text code>{diagnosis.podInfo.podName}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  查看 Pod 日志和事件以获取更多诊断信息
                </Text>
              </div>
            </Card>
          </div>
        )}

        {/* 事件分析 */}
        {diagnosis.eventAnalysis && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>事件分析</span>
            </div>
            <Card variant="borderless" styles={{ body: { padding: 0 } }}>
              <Space direction="vertical" style={{ width: '100%', padding: '16px 24px' }}>
                {diagnosis.eventAnalysis.recentPattern === 'IP 地址池耗尽' && (
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
                        Pod 创建次数: <Text strong>{diagnosis.eventAnalysis.podCreateCount}</Text>，
                        删除次数: <Text strong>{diagnosis.eventAnalysis.podDeleteCount}</Text>
                      </Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        错误信息显示 IP 地址范围 10.52.0.1-10.52.0.254 已全部用完
                      </Text>
                    </div>
                  }
                  type="error"
                  showIcon
                />
              )}
              {diagnosis.eventAnalysis.recentPattern === '网络配置错误' && (
                <Alert
                  message="网络配置错误"
                  description={
                    <div>
                      <Text>
                        Pod 创建次数: <Text strong>{diagnosis.eventAnalysis.podCreateCount}</Text>，
                        删除次数: <Text strong>{diagnosis.eventAnalysis.podDeleteCount}</Text>
                      </Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Pod 网络创建失败，检查网络配置
                      </Text>
                    </div>
                  }
                  type="error"
                  showIcon
                />
              )}
              {diagnosis.eventAnalysis.podCreateDeleteCycle && 
               diagnosis.eventAnalysis.recentPattern !== 'IP 地址池耗尽' &&
               diagnosis.eventAnalysis.recentPattern !== '网络配置错误' && (
                <Alert
                  message="检测到 Pod 频繁创建/删除循环"
                  description={
                    <div>
                      <Text>
                        Pod 创建次数: <Text strong>{diagnosis.eventAnalysis.podCreateCount}</Text>，
                        删除次数: <Text strong>{diagnosis.eventAnalysis.podDeleteCount}</Text>
                      </Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        这表明 Pod 可能在不断重启或遇到调度问题
                      </Text>
                    </div>
                  }
                  type="error"
                  showIcon
                />
              )}
              {diagnosis.eventAnalysis.recentPattern && 
               !diagnosis.eventAnalysis.podCreateDeleteCycle &&
               diagnosis.eventAnalysis.recentPattern !== 'IP 地址池耗尽' &&
               diagnosis.eventAnalysis.recentPattern !== '网络配置错误' && (
                <Alert
                  message={diagnosis.eventAnalysis.recentPattern}
                  description={
                    <div>
                      <Text>Pod 创建: {diagnosis.eventAnalysis.podCreateCount} 次</Text>
                      <br />
                      <Text>Pod 删除: {diagnosis.eventAnalysis.podDeleteCount} 次</Text>
                      {diagnosis.eventAnalysis.vmiStoppedCount > 0 && (
                        <>
                          <br />
                          <Text>VMI 停止: {diagnosis.eventAnalysis.vmiStoppedCount} 次</Text>
                        </>
                      )}
                    </div>
                  }
                  type="warning"
                  showIcon
                />
              )}
              {diagnosis.eventAnalysis.suggestions.length > 0 && (
                <div>
                  <Text strong>建议操作：</Text>
                  <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                    {diagnosis.eventAnalysis.suggestions.map((suggestion, idx) => (
                      <li key={idx}>
                        <Text style={{ fontSize: 12 }}>{suggestion}</Text>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Space>
          </Card>
          </div>
        )}

        {/* 最近事件 */}
        {diagnosis.events && diagnosis.events.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>最近事件 ({diagnosis.events.length} 条)</span>
            </div>
            <Card variant="borderless" styles={{ body: { padding: 0 } }}>
              <Collapse size="small" ghost>
                <Panel header="查看事件详情" key="events">
                  <Space direction="vertical" style={{ width: '100%', padding: '16px 24px' }} size="small">
                    {diagnosis.events.map((event: any, idx: number) => (
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
                            {new Date(event.lastTimestamp).toLocaleString()}
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
            </Card>
          </div>
        )}

        {/* 诊断建议 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color: '#666' }}>诊断建议</span>
          </div>
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
        </div>
    </div>
  );
};

export default HarvesterVmDiagnosisTab;
