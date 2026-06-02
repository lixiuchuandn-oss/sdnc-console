/**
 * ==============================================================================
 * Harvester - 虚拟机创建向导 - 基础配置步骤 (StepBasic)
 * frontend/src/pages/cnmc/clouds/Harvester/modals/VmCreateWizard/StepBasic.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 负责配置虚拟机的基础信息，包括资源池、业务项目（K8s namespace）、运行位置（调度策略）以及虚拟机名称/描述。
 * ------------------------------------------------------------------------------
 *
 * [核心逻辑]
 * 1. [资源池选择]: 切换资源池时，重置并重新加载项目（namespace）列表。
 * 2. [项目默认选中]: 默认过滤系统/公共项目，并自动选中第一个可用项（租户侧更严）。
 * 3. [调度策略]:
 *    - 自动调度: 让 K8s 调度器决定。
 *    - 指定主机: 强制调度到特定节点 (nodeName)。
 *    - 标签选择: 使用 nodeSelector 匹配节点标签。
 * 4. [能力检测]: 根据资源池 ID 获取 Harvester 集群能力（写入 clusterArch / machineType；表单项隐藏，提交与校验仍注册）。
 * ------------------------------------------------------------------------------
 *
 * [API 接口]
 * - GET /v1/harvester/clusters/{id}/capabilities
 *   获取集群能力配置 (fetchHarvesterCapabilities)
 *   -> 映射到表单字段: clusterArch, machineType
 * ------------------------------------------------------------------------------
 *
 * [交互依赖]
 * - 依赖 Ant Design Form 实例进行数据回填。
 * - 依赖外部传入的 cloudOptions, namespaceOptions, filteredNodes 进行渲染。
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Form, Input, Select, Radio, Space, Table, Tag, Typography, Button, Row, Col, Progress, Alert, Tooltip, Spin } from 'antd';
import { ReloadOutlined, LoadingOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { fetchHarvesterCapabilities } from 'services/harvester/vm';
import {
  isSystemNamespace,
  pickFirstNamespaceRecordByScenarioForOptions,
} from '../../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../../shared/context/HarvesterPublicNamespacesContext';
import {
  bytesToGiB,
  parseCpuToCores,
  parseMemoryToBytes,
} from '../../drawers/shared/lib/harvesterNodeResourceUtils';
import { useHarvesterNodeResourceMaps } from '../../drawers/shared/lib/useHarvesterNodeResourceMaps';
import type { PodAffinityEditorHandle } from '../../../containers/components/workloadForm/editors/PodAffinityEditor';
import StepOthersPodAffinity from './StepOthersPodAffinity';

/**
 * 组件 Props 定义
 */
interface StepBasicProps {
  /** Ant Design Form 实例 */
  form: any;
  /** 当前资源池下已存在的 VM 列表（用于显示名称重名校验） */
  existingVms?: any[];
  /** 当前选中的资源池 ID */
  cloudId: string;
  /** 当前资源池 ID (用于内部状态) */
  currentCloudId: string | undefined;
  /** 设置当前资源池 ID 的回调 */
  setCurrentCloudId: (id: string | undefined) => void;
  /** 资源池选项列表 */
  cloudOptions: any[];
  /** 命名空间选项列表 */
  namespaceOptions: any[];
  /** 重新加载命名空间的回调 */
  reloadNamespaces: () => void;
  /** 主机调度模式 ('auto' | 'node' | 'label') */
  hostModeState: string;
  /** 设置主机调度模式的回调 */
  setHostModeState: (mode: string) => void;
  /** 节点搜索关键字 */
  nodeKeyword: string;
  /** 设置节点搜索关键字的回调 */
  setNodeKeyword: (kw: string) => void;
  /** 节点列表加载状态 */
  nodesLoading: boolean;
  /** 重新加载节点列表的回调 */
  reloadNodes: () => void;
  /** 当前云提供商类型 */
  currentProvider: string | undefined;
  /** 当前选中的节点名称 */
  selectedNodeName: string | null;
  /** 设置选中节点名称的回调 */
  setSelectedNodeName: (name: string | null) => void;
  /** 过滤后的节点列表 */
  filteredNodes: any[];
  /** 是否为租户 */
  isTenant?: boolean;
  /** 命名空间原始对象（用于按 tower.io/scenario 默认选中） */
  namespaceRecords?: any[];
  namespacesOptions: string[];
  podAffinityRef: React.RefObject<PodAffinityEditorHandle>;
  podAntiAffinityRef: React.RefObject<PodAffinityEditorHandle>;
}

const StepBasic: React.FC<StepBasicProps> = ({
  form,
  existingVms,
  cloudId,
  setCurrentCloudId,
  cloudOptions,
  namespaceOptions,
  reloadNamespaces,
  hostModeState,
  setHostModeState,
  nodeKeyword,
  setNodeKeyword,
  nodesLoading,
  reloadNodes,
  currentProvider,
  selectedNodeName,
  setSelectedNodeName,
  filteredNodes,
  isTenant,
  namespaceRecords,
  namespacesOptions,
  podAffinityRef,
  podAntiAffinityRef,
}) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const [nodeReadyFilter, setNodeReadyFilter] = useState<string>('running');

  const { metricsMap, requestsMap, nodesDetailMap, resourceLoading } =
    useHarvesterNodeResourceMaps(cloudId);

  const visibleNamespaceOptions = useMemo(() => {
    if (!isTenant) return namespaceOptions;
    return namespaceOptions.filter((n) => !isSystemNamespace(String(n.value || '')) && !isPublicNamespace(String(n.value || '')));
  }, [namespaceOptions, isTenant, isPublicNamespace]);

  // [数据同步] 根据 cloudId 获取集群能力（架构、推荐机型）
  // 调用 API 获取指定资源池的能力集，并自动填充推荐值（如架构、机型）
  // 异常处理：若获取失败，仅打印日志，不阻塞流程，字段保持默认或手动输入
  useEffect(() => {
    if (cloudId && cloudId !== 'all') {
      fetchHarvesterCapabilities(cloudId).then((res: any) => {
        const data = res.data || {};
        form.setFieldsValue({
          clusterArch: data.architecture,
          machineType: data.recommendedMachineType,
        });
      }).catch((e: any) => console.error(e));
    }
  }, [cloudId, form]);

  // [业务规则] 项目（namespace）自动选择逻辑
  // 租户：过滤系统与公共项；管理员：默认选第一个非系统项
  useEffect(() => {
    const validOptions = visibleNamespaceOptions;
    if (validOptions.length === 0) return;

    // 用 getFieldsValue(true) 读，避免第一步未挂载时 getFieldValue 短暂为空，误覆盖已选项目
    const currentVal =
      form.getFieldsValue(true)?.namespace ?? form.getFieldValue('namespace');
    const isValid =
      currentVal !== undefined &&
      currentVal !== null &&
      String(currentVal).trim() !== '' &&
      validOptions.some((o) => String(o.value) === String(currentVal));

    if (!isValid) {
      const preferred = pickFirstNamespaceRecordByScenarioForOptions(
        namespaceRecords,
        validOptions.map((o) => String(o.value)),
        isTenant ? 'tenant' : 'admin',
      );
      form.setFieldsValue({ namespace: preferred ?? validOptions[0].value });
    }
  }, [visibleNamespaceOptions, form, namespaceRecords, isTenant]);

  // [辅助函数] 判断节点是否就绪
  // 兼容逻辑：优先检查顶层 ready 字段，若不存在则遍历 status.conditions 查找 Type=Ready 且 Status=True
  const isNodeReady = (r: any): boolean => {
    if (typeof r?.ready === 'boolean') return r.ready;
    const conds: any[] = Array.isArray(r?.status?.conditions) ? r.status.conditions : [];
    return conds.some((c: any) => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true');
  };

  // [过滤逻辑] 根据状态筛选节点列表
  const displayNodes = useMemo(() => {
    let arr: any[] = Array.isArray(filteredNodes) ? filteredNodes : [];
    if (nodeReadyFilter === 'running') arr = arr.filter(isNodeReady);
    else if (nodeReadyFilter === 'notready') arr = arr.filter((n:any)=> !isNodeReady(n));
    return arr;
  }, [filteredNodes, nodeReadyFilter]);

  /** 已由入口上下文选定资源池时不可切换，仅隐藏控件并保留表单字段（与 WizardSummary / 校验一致） */
  const cloudPoolLocked = Boolean(cloudId && cloudId !== 'all');

  return (
    <>
      <Typography.Paragraph type="secondary">
        设定新建云主机的基本信息，如项目、运行位置与名称等
      </Typography.Paragraph>
      
      {/* === 1. 基础配置 === */}
      <div className="wizard-group-title">基础配置</div>
      {cloudPoolLocked ? (
        <Form.Item name="cloudId" preserve hidden rules={[{ required: true, message: '请选择资源池' }]}>
          <Input />
        </Form.Item>
      ) : (
        <Row gutter={12}>
          <Col span={24}>
            <Form.Item label="资源池" name="cloudId" preserve rules={[{ required: true, message: '请选择资源池' }]}>
              <Select
                placeholder="选择资源池"
                onChange={(v) => {
                  setCurrentCloudId(v);
                  try {
                    reloadNamespaces();
                    form.resetFields(['namespace']);
                  } catch {}
                }}
                options={cloudOptions}
                optionFilterProp="label"
                showSearch
              />
            </Form.Item>
          </Col>
        </Row>
      )}
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item label="项目" name="namespace" preserve rules={[{ required: true, message: '请选择项目' }]}> 
            <Select 
              options={visibleNamespaceOptions}
              placeholder="选择项目"
              showSearch
              onOpenChange={(open) => { if (open) reloadNamespaces(); }}
              filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="运行位置" name="hostMode" preserve> 
            <Radio.Group buttonStyle="solid" onChange={(e)=> setHostModeState(e.target.value)}>
              <Radio.Button value="auto">自动调度</Radio.Button>
              <Radio.Button value="node">指定主机</Radio.Button>
              <Radio.Button value="label">标签选择</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Col>
      </Row>
      {isTenant && visibleNamespaceOptions.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="未分配到可用项目"
          description="当前账号不能在公共或集群系统区创建云主机。请联系管理员为您的租户分配可用的业务项目。"
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {/* 能力接口回填，仅参与提交；machineType 在 StepCompute 中注册（各步同挂载，避免重复 name） */}
      <Form.Item name="clusterArch" preserve hidden>
        <Input />
      </Form.Item>

      {/* === 调度策略配置 === */}
      {hostModeState === 'label' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <div className="wizard-section-title">标签选择</div>
          <Form.List name="nodeSelectorPairs">
            {(fields, { add, remove }) => (
              <div style={{ border: '1px dashed #d9d9d9', padding: 8, borderRadius: 4 }}>
                {fields.map(({ key, name }) => (
                  <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
                    <Col span={10}>
                      <Form.Item name={[name, 'key']} noStyle rules={[{ required: true, message: '请输入键' }]}> 
                        <Input placeholder="Key (如 kubernetes.io/hostname)" />
                      </Form.Item>
                    </Col>
                    <Col span={10}>
                      <Form.Item name={[name, 'value']} noStyle rules={[{ required: true, message: '请输入值' }]}> 
                        <Input placeholder="Value" />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Button type="text" danger onClick={() => remove(name)}>删除</Button>
                    </Col>
                  </Row>
                ))}
                <Button onClick={() => add({ key: '', value: '' })}>新增选择器</Button>
              </div>
            )}
          </Form.List>
        </div>
      )}

      {hostModeState === 'node' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <div className="wizard-section-title">主机列表</div>
          <Space style={{ width: '100%' }}>
            <Input allowClear size="small" placeholder="搜索主机名称/IP" value={nodeKeyword} onChange={(e) => setNodeKeyword(e.target.value)} style={{ flex: 1 }} />
            <Select
              size="small"
              value={nodeReadyFilter}
              style={{ width: 160 }}
              onChange={(v)=> setNodeReadyFilter(v || 'running')}
              options={[
                { value: 'all', label: '全部主机' },
                { value: 'running', label: '健康主机' },
                { value: 'notready', label: '未就绪主机' },
              ]}
            />
            {nodesLoading ? (
              <LoadingOutlined style={{ fontSize: 16, color: '#1677ff' }} />
            ) : (
              <Button
                size="small"
                icon={<ReloadOutlined style={{ fontSize: 14, color: '#8c8c8c' }} />}
                type="default"
                onClick={() => { const p = (currentProvider || ''); if (p === 'harvester' || p === 'cloudmap') reloadNodes(); }}
                disabled={(function(){ const p = (currentProvider || ''); return !(p === 'harvester' || p === 'cloudmap'); })()}
              />
            )}
          </Space>
          <Table
            size="small"
            bordered
            rowKey={(r: any) => r.name}
            className="wizard-node-table"
            onRow={(record: any) => ({
              onClick: () => { const k = record?.name; setSelectedNodeName(k || null); }
            })}
            rowClassName={(record: any) => (hostModeState === 'node' && selectedNodeName && record?.name === selectedNodeName) ? 'wizard-table-row-active' : ''}
            columns={[
              {
                title: '', key: 'select', width: 52, align: 'center', className: 'wizard-node-select-col',
                onCell: () => ({ style: { paddingLeft: 8, paddingRight: 8 } }),
                render: (_: any, r: any) => (
                  <Radio style={{ margin: 0 }} checked={selectedNodeName === r?.name} onChange={(e) => { e.stopPropagation(); const k = r?.name; setSelectedNodeName(k || null); }} />
                )
              },
              {
                title: '主机名称', key: 'name', render: (_: any, r: any) => (
                  <div>
                    <div>{r?.name || '-'}</div>
                    <div style={{ color: '#999' }}>{r?.internalIP || '-'}</div>
                  </div>
                )
              },
              { title: '状态', dataIndex: 'ready', key: 'ready', render: (b: boolean) => b ? <Tag color="green">Ready</Tag> : <Tag color="red">NotReady</Tag> },
              {
                title: (
                  <span>
                    CPU
                    <Tooltip 
                      title={
                        <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
                          <b>物理总量</b>：物理节点的实际CPU核数
                          <br />
                          <b>可分配总量</b>：物理总量减去系统预留后的可用资源
                          <br />
                          <b>已分配</b>：所有Pod的CPU资源请求(requests)之和
                          <br />
                          <b>已使用</b>：节点实时CPU使用量
                        </div>
                      }
                      placement="top"
                    >
                      <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12, cursor: 'help' }} />
                    </Tooltip>
                  </span>
                ), 
                key: 'cpu_usage', render: (_: any, r: any) => {
                  if (resourceLoading) {
                    return (
                      <div style={{ minWidth: 180, padding: '10px 0' }}>
                        <Spin size="small" />
                      </div>
                    );
                  }
                  const nodeName = String(r?.name || r?.metadata?.name || '').trim();
                  const nodeDetail = nodesDetailMap[nodeName];
                  // 可分配总量 = 物理总量 - 系统预留（从 nodesDetailMap 获取）
                  const allocatable = parseCpuToCores(nodeDetail?.allocatableCpu ?? r?.cpu);
                  // 物理总量（从 nodesDetailMap 获取）
                  const capacity = parseCpuToCores(nodeDetail?.capacityCpu ?? r?.cpu);
                  const requested = requestsMap[nodeName]?.cpuRequestCores || 0;
                  const used = metricsMap[nodeName]?.cpuUsedCores || 0;
                  // 已分配率 = 已分配 / 可分配总量
                  const requestedPct = allocatable > 0 ? Math.round((requested / allocatable) * 1000) / 10 : undefined;
                  const usedPct = capacity > 0 ? Math.round((used / capacity) * 1000) / 10 : undefined;
                  // 已分配剩余 = 可分配总量 - 已分配
                  const requestedRemaining = allocatable - requested;
                  const usedRemaining = capacity - used;
                  return (
                    <div style={{ minWidth: 180 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: '16px', marginBottom: 3 }}>
                        <Progress 
                          percent={typeof requestedPct === 'number' ? Math.max(0, Math.min(100, requestedPct)) : 0} 
                          size="small" 
                          showInfo={false}
                          strokeColor="#52c41a"
                        />
                        <span style={{ fontSize: 11 }}>{typeof requestedPct === 'number' ? `${requestedPct.toFixed(0)}%` : '-'}</span>
                      </div>
                      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 10, lineHeight: '12px', marginBottom: 3 }}>
                        可分配总量: {allocatable.toFixed(1)} / 已分配: {requested.toFixed(1)} / 未分配: {requestedRemaining.toFixed(1)} core
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: '16px', marginBottom: 2 }}>
                        <Progress 
                          percent={typeof usedPct === 'number' ? Math.max(0, Math.min(100, usedPct)) : 0} 
                          size="small" 
                          showInfo={false}
                          strokeColor="#1890ff"
                        />
                        <span style={{ fontSize: 11 }}>{typeof usedPct === 'number' ? `${usedPct.toFixed(0)}%` : '-'}</span>
                      </div>
                      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 10, lineHeight: '12px' }}>
                        物理总量: {capacity.toFixed(1)} / 已使用: {used.toFixed(1)} / 未使用: {usedRemaining.toFixed(1)} core
                      </div>
                    </div>
                  );
                }
              },
              {
                title: (
                  <span>
                    内存
                    <Tooltip 
                      title={
                        <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
                          <b>物理总量</b>：物理节点的实际内存总容量
                          <br />
                          <b>可分配总量</b>：物理总量减去系统预留后的可用资源
                          <br />
                          <b>已分配</b>：所有Pod的内存资源请求(requests)之和
                          <br />
                          <b>已使用</b>：节点实时内存使用量
                        </div>
                      }
                      placement="top"
                    >
                      <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12, cursor: 'help' }} />
                    </Tooltip>
                  </span>
                ), 
                key: 'mem_usage', render: (_: any, r: any) => {
                  if (resourceLoading) {
                    return (
                      <div style={{ minWidth: 180, padding: '10px 0' }}>
                        <Spin size="small" />
                      </div>
                    );
                  }
                  const nodeName = String(r?.name || r?.metadata?.name || '').trim();
                  const nodeDetail = nodesDetailMap[nodeName];
                  // 可分配总量 = 物理总量 - 系统预留（从 nodesDetailMap 获取）
                  const allocatable = bytesToGiB(parseMemoryToBytes(nodeDetail?.allocatableMemory));
                  // 物理总量（从 nodesDetailMap 获取）
                  const capacity = bytesToGiB(parseMemoryToBytes(nodeDetail?.capacityMemory));
                  const requested = bytesToGiB(requestsMap[nodeName]?.memRequestBytes || 0);
                  const used = bytesToGiB(metricsMap[nodeName]?.memUsedBytes || 0);
                  // 已分配率 = 已分配 / 可分配总量
                  const requestedPct = allocatable > 0 ? Math.round((requested / allocatable) * 1000) / 10 : undefined;
                  const usedPct = capacity > 0 ? Math.round((used / capacity) * 1000) / 10 : undefined;
                  // 已分配剩余 = 可分配总量 - 已分配
                  const requestedRemaining = allocatable - requested;
                  const usedRemaining = capacity - used;
                  return (
                    <div style={{ minWidth: 180 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: '16px', marginBottom: 3 }}>
                        <Progress 
                          percent={typeof requestedPct === 'number' ? Math.max(0, Math.min(100, requestedPct)) : 0} 
                          size="small" 
                          showInfo={false}
                          strokeColor="#52c41a"
                        />
                        <span style={{ fontSize: 11 }}>{typeof requestedPct === 'number' ? `${requestedPct.toFixed(0)}%` : '-'}</span>
                      </div>
                      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 10, lineHeight: '12px', marginBottom: 3 }}>
                        可分配总量: {allocatable.toFixed(1)} / 已分配: {requested.toFixed(1)} / 未分配: {requestedRemaining.toFixed(1)} GiB
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: '16px', marginBottom: 2 }}>
                        <Progress 
                          percent={typeof usedPct === 'number' ? Math.max(0, Math.min(100, usedPct)) : 0} 
                          size="small" 
                          showInfo={false}
                          strokeColor="#1890ff"
                        />
                        <span style={{ fontSize: 11 }}>{typeof usedPct === 'number' ? `${usedPct.toFixed(0)}%` : '-'}</span>
                      </div>
                      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 10, lineHeight: '12px' }}>
                        物理总量: {capacity.toFixed(1)} / 已使用: {used.toFixed(1)} / 未使用: {usedRemaining.toFixed(1)} GiB
                      </div>
                    </div>
                  );
                }
              },
            ] as any}
            dataSource={displayNodes}
            loading={nodesLoading || resourceLoading}
            pagination={false}
            scroll={{ x: true }}
          />
        </div>
      ) : null}

      {/* === 3. 信息（名称、描述） === */}
      <div className="wizard-group-title">信息</div>
      <Row gutter={12}>
        <Col span={24}>
          <Form.Item
            label="虚拟机名称"
            name="name"
            preserve
            dependencies={['namespace']}
            validateTrigger="onChange"
            rules={[
              { required: true, message: '请输入虚拟机名称' },
              {
                validator: async (_: any, value: any) => {
                  const name = String(value || '').trim();
                  if (!name) return;
                  const ns = String(form.getFieldValue('namespace') || '').trim();
                  if (!ns) return;
                  const list = Array.isArray(existingVms) ? existingVms : [];
                  const getVmNamespace = (vm: any) => {
                    const direct = vm?.namespace || vm?.metadata?.namespace;
                    if (direct) return String(direct).trim();
                    const iid = vm?.InstanceId || vm?.id || vm?.metadata?.name;
                    const s = String(iid || '').trim();
                    if (s.includes('/')) return s.split('/')[0].trim();
                    return '';
                  };
                  const getVmAlias = (vm: any) => {
                    return String(
                      vm?.metadata?.annotations?.['tower.io/alias'] ||
                      vm?.annotations?.['tower.io/alias'] ||
                      ''
                    ).trim();
                  };
                  const dup = list.some((vm: any) => {
                    const vmNs = getVmNamespace(vm);
                    if (!vmNs || vmNs !== ns) return false;
                    const alias = getVmAlias(vm);
                    if (!alias) return false;
                    return alias === name;
                  });
                  if (dup) throw new Error('虚拟机名称不可重复，请修改虚拟机名称');
                },
              },
            ]}
          >
            <Input placeholder="显示名称（支持中文）" />
          </Form.Item>
        </Col>
        <Col span={24}>
          <Form.Item label="描述" name="description" preserve>
            <Input.TextArea placeholder="可选描述信息" autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
        </Col>
      </Row>

      <StepOthersPodAffinity
        namespacesOptions={namespacesOptions}
        podAffinityRef={podAffinityRef}
        podAntiAffinityRef={podAntiAffinityRef}
      />
    </>
  );
};

export default StepBasic;
