/**
 * ==============================================================================
 * Harvester - 虚拟机创建向导 - 基础配置步骤 (StepBasic)
 * frontend/src/pages/cnmc/clouds/Harvester/ecs/modals/VmCreateWizard/StepBasic.tsx
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
 *    - 故障域: 选择集群已定义的故障域（写入 nodeSelector），可叠加节点标签。
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
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Form, Input, Select, Radio, Space, Table, Typography, Button, Row, Col, Alert, Spin } from 'antd';
import { ReloadOutlined, LoadingOutlined } from '@ant-design/icons';
import { fetchHarvesterCapabilities } from 'services/harvester/vm';
import {
  isSystemNamespace,
  pickFirstNamespaceRecordByScenarioForOptions,
} from '../../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../../shared/context/HarvesterPublicNamespacesContext';
import { useHarvesterNodeResourceMaps } from '../../drawers/shared/lib/useHarvesterNodeResourceMaps';
import { buildHarvesterNodePickerTableColumns } from '../../drawers/shared/lib/harvesterNodePickerTableColumns';
import type { PodAffinityEditorHandle } from '../../../containers/components/workloadForm/editors/PodAffinityEditor';
import StepOthersPodAffinity from './StepOthersPodAffinity';
import {
  fetchFailureDomainOverview,
  FAILURE_DOMAIN_TYPE_LABELS,
  type FailureDomainRow,
} from 'services/harvester/failureDomains';
import { vmFailureDomainRequiredMessage } from '../../lib/vmAdvancedSchedulingLabels';

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
  const [failureDomains, setFailureDomains] = useState<FailureDomainRow[]>([]);
  const [failureDomainsLoading, setFailureDomainsLoading] = useState(false);

  const failureDomainOptions = useMemo(
    () =>
      failureDomains.map((d) => {
        const typeLabel = FAILURE_DOMAIN_TYPE_LABELS[d.domainType] || d.domainType;
        const nodeCount = d.nodeNames?.length ?? 0;
        return {
          value: d.name,
          label: `${d.name}（${typeLabel} · ${nodeCount} 节点）`,
        };
      }),
    [failureDomains],
  );

  useEffect(() => {
    if (hostModeState !== 'label' || !cloudId || cloudId === 'all') {
      setFailureDomains([]);
      return;
    }
    let cancelled = false;
    setFailureDomainsLoading(true);
    void fetchFailureDomainOverview(cloudId)
      .then((json: unknown) => {
        if (cancelled) return;
        const data = (json as { data?: { domains?: FailureDomainRow[] } })?.data;
        setFailureDomains(Array.isArray(data?.domains) ? data?.domains ?? [] : []);
      })
      .catch(() => {
        if (!cancelled) setFailureDomains([]);
      })
      .finally(() => {
        if (!cancelled) setFailureDomainsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudId, hostModeState]);

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
      }).catch(() => {});
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

  const isNodeReady = useCallback((r: any): boolean => {
    if (typeof r?.ready === 'boolean') return r.ready;
    const conds: any[] = Array.isArray(r?.status?.conditions) ? r.status.conditions : [];
    return conds.some((c: any) => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true');
  }, []);

  const displayNodes = useMemo(() => {
    let arr: any[] = Array.isArray(filteredNodes) ? filteredNodes : [];
    if (nodeReadyFilter === 'running') arr = arr.filter(isNodeReady);
    else if (nodeReadyFilter === 'notready') arr = arr.filter((n: any) => !isNodeReady(n));
    return arr;
  }, [filteredNodes, nodeReadyFilter, isNodeReady]);

  const nodeRowKey = useCallback(
    (r: any) => String(r?.name || r?.metadata?.name || ''),
    [],
  );

  const nodePickerColumns = useMemo(
    () =>
      buildHarvesterNodePickerTableColumns(
        {
          metricsMap,
          requestsMap,
          nodesDetailMap,
          resourceLoading,
        },
        { compact: true },
      ),
    [metricsMap, requestsMap, nodesDetailMap, resourceLoading],
  );

  const canReloadNodes =
    currentProvider === 'harvester' || currentProvider === 'cloudmap';

  /** 已由入口上下文选定资源池时不可切换，仅隐藏控件并保留表单字段（与 WizardSummary / 校验一致） */
  const cloudPoolLocked = Boolean(cloudId && cloudId !== 'all');

  return (
    <>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
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
            <Radio.Group buttonStyle="solid" block onChange={(e)=> setHostModeState(e.target.value)}>
              <Radio.Button value="auto">自动调度</Radio.Button>
              <Radio.Button value="node">指定主机</Radio.Button>
              <Radio.Button value="label">故障域</Radio.Button>
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
          <div className="wizard-section-title">故障域</div>
          <Form.Item
            name="failureDomainName"
            preserve
            rules={[
              {
                validator: async (_, value) => {
                  const fd = String(value || '').trim();
                  const pairs = form.getFieldValue('nodeSelectorPairs') || [];
                  const hasOther = (Array.isArray(pairs) ? pairs : []).some(
                    (p: { key?: string; value?: string }) =>
                      String(p?.key || '').trim() && String(p?.value || '').trim(),
                  );
                  if (fd || hasOther) return;
                  throw new Error(vmFailureDomainRequiredMessage());
                },
              },
            ]}
          >
            <Select
              allowClear
              showSearch
              loading={failureDomainsLoading}
              placeholder="选择故障域"
              options={failureDomainOptions}
              optionFilterProp="label"
              notFoundContent={
                failureDomainsLoading ? <Spin size="small" /> : '暂无故障域，请先在集群中创建'
              }
            />
          </Form.Item>
        </div>
      )}

      {hostModeState === 'node' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                onClick={() => { if (canReloadNodes) reloadNodes(); }}
                disabled={!canReloadNodes}
              />
            )}
          </Space>
          <Table
            size="small"
            bordered
            rowKey={nodeRowKey}
            className="wizard-node-table"
            style={{ marginBottom: 12 }}
            columns={nodePickerColumns}
            dataSource={displayNodes}
            loading={nodesLoading || resourceLoading}
            pagination={false}
            rowSelection={{
              type: 'radio',
              columnWidth: 52,
              selectedRowKeys: selectedNodeName ? [selectedNodeName] : [],
              onChange: (keys) => {
                const k = keys[0];
                setSelectedNodeName(k != null && k !== '' ? String(k) : null);
              },
            }}
            onRow={(record) => ({
              onClick: () => {
                const name = nodeRowKey(record);
                setSelectedNodeName(name || null);
              },
            })}
            rowClassName={(record) =>
              hostModeState === 'node' && selectedNodeName && nodeRowKey(record) === selectedNodeName
                ? 'wizard-table-row-active'
                : ''
            }
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
        hostModeState={hostModeState}
        namespacesOptions={namespacesOptions}
        podAffinityRef={podAffinityRef}
        podAntiAffinityRef={podAntiAffinityRef}
      />
    </>
  );
};

export default StepBasic;
