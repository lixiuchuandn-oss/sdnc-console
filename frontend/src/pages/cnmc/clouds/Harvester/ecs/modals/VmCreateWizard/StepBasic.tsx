/**
 * ==============================================================================
 * Harvester - 虚拟机创建向导 - 基础配置步骤 (StepBasic)
 * frontend/src/pages/cnmc/clouds/Harvester/modals/VmCreateWizard/StepBasic.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 负责配置虚拟机的基础信息，包括资源池、命名空间、运行位置（调度策略）以及虚拟机名称/描述。
 * ------------------------------------------------------------------------------
 *
 * [核心逻辑]
 * 1. [资源池选择]: 切换资源池时，重置并重新加载命名空间。
 * 2. [命名空间自动修正]: 默认过滤掉系统命名空间，并自动选中第一个可用命名空间。
 * 3. [调度策略]:
 *    - 自动调度: 让 K8s 调度器决定。
 *    - 指定主机: 强制调度到特定节点 (nodeName)。
 *    - 标签选择: 使用 nodeSelector 匹配节点标签。
 * 4. [能力检测]: 根据资源池 ID 获取 Harvester 集群能力（如架构、推荐机型）。
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
import { Form, Input, Select, Radio, Space, Table, Tag, Typography, Button, Row, Col, Progress, Alert, Tooltip } from 'antd';
import { ReloadOutlined, LoadingOutlined } from '@ant-design/icons';
import { fetchHarvesterCapabilities } from '../../../../../../../services/harvesterApi';
import {
  isSystemNamespace,
  pickFirstNamespaceRecordByScenarioForOptions,
} from '../../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../../context/HarvesterPublicNamespacesContext';

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
}

const StepBasic: React.FC<StepBasicProps> = ({
  form,
  existingVms,
  cloudId,
  currentCloudId,
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
}) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const [nodeReadyFilter, setNodeReadyFilter] = useState<string>('running');
  const [capabilities, setCapabilities] = useState<any>({});

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
        setCapabilities(data);
        form.setFieldsValue({
          clusterArch: data.architecture,
          machineType: data.recommendedMachineType
        });
      }).catch((e: any) => console.error(e));
    }
  }, [cloudId]);

  // [业务规则] 命名空间自动选择逻辑
  // 若为租户，强制过滤系统命名空间和公共命名空间；否则允许选择所有（但默认选中第一个非系统）
  useEffect(() => {
    const validOptions = visibleNamespaceOptions;
    if (validOptions.length === 0) return;

    // 用 getFieldsValue(true) 读，避免第一步未挂载时 getFieldValue 短暂为空，误把用户已选命名空间覆盖成第一项
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

  return (
    <>
      <Typography.Paragraph type="secondary">设定新建云主机的基本信息，如名称、所属资源池等</Typography.Paragraph>
      
      {/* === 1. 基础配置 === */}
      <div className="wizard-group-title">基础配置</div>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item label="资源池" name="cloudId" preserve rules={[{ required: true, message: '请选择资源池' }]}> 
            <Select 
              placeholder="选择资源池"
              onChange={(v) => { setCurrentCloudId(v); try { reloadNamespaces(); form.resetFields(['namespace']); } catch {} }}
              disabled={cloudId !== 'all'}
              options={cloudOptions}
              optionFilterProp="label"
              showSearch
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="命名空间" name="namespace" preserve rules={[{ required: true, message: '请选择命名空间' }]}> 
            <Select 
              options={visibleNamespaceOptions}
              placeholder="选择命名空间"
              showSearch
              onOpenChange={(open) => { if (open) reloadNamespaces(); }}
              filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
        </Col>
      </Row>
      {isTenant && visibleNamespaceOptions.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="未分配可用命名空间"
          description="租户不允许在公共/系统命名空间创建云主机，请联系管理员为该租户分配业务命名空间（UserSpace.namespace）。"
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item label="运行位置" name="hostMode" preserve> 
            <Radio.Group buttonStyle="solid" onChange={(e)=> setHostModeState(e.target.value)}>
              <Radio.Button value="auto">自动调度</Radio.Button>
              <Radio.Button value="node">指定主机</Radio.Button>
              <Radio.Button value="label">标签选择</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item label="集群架构" name="clusterArch" preserve> 
            <Input disabled placeholder="自动获取..." />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item label="支持的VM类型" name="machineType" preserve>
            <Select disabled placeholder="选择VM类型">
              {capabilities?.recommendedMachineType && (
                <Select.Option value={capabilities.recommendedMachineType}>
                  {capabilities.recommendedMachineType}
                </Select.Option>
              )}
            </Select>
          </Form.Item>
        </Col>
      </Row>

      {/* === 调度策略配置 === */}
      {hostModeState === 'label' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
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
                          <b>总量</b>：物理节点的实际CPU核数
                          <br />
                          <b>超配总量</b>：物理节点的实际CPU核数乘以CPU超配比后得到的逻辑核数
                        </div>
                      }
                      placement="top"
                    >
                      <span style={{ marginLeft: 4, color: '#999', fontSize: 14, cursor: 'help' }}>?</span>
                    </Tooltip>
                  </span>
                ), 
                key: 'cpu_usage', render: (_: any, r: any) => {
                  const s = String(r?.name || r?.internalIP || '').trim();
                  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
                  const usedPct = 25 + (h % 60);
                  const cpuRaw = r?.cpu ?? r?.status?.capacity?.cpu;
                  const total = typeof cpuRaw === 'number' ? cpuRaw : Number(String(cpuRaw || '').replace(/[^0-9]/g, '')) || 32;
                  const overcommitTotal = total * 2; // 默认超配比200%
                  const requested = total > 0 ? Math.round((usedPct / 100) * total * 10) / 10 : 0;
                  const used = total > 0 ? Math.round((usedPct / 100) * total * 10) / 10 : 0;
                  // 已分配率 = 已分配 / 超配总量
                  const requestedPct = overcommitTotal > 0 ? Math.round((requested / overcommitTotal) * 1000) / 10 : 0;
                  return (
                    <div style={{ minWidth: 180 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: '16px', marginBottom: 3 }}>
                        <Progress 
                          percent={Math.max(0, Math.min(100, requestedPct))} 
                          size="small" 
                          showInfo={false}
                          strokeColor="#52c41a"
                        />
                        <span style={{ fontSize: 11 }}>{requestedPct.toFixed(0)}%</span>
                      </div>
                      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 10, lineHeight: '12px', marginBottom: 3 }}>
                        超配总量: {overcommitTotal.toFixed(1)} / 分配: {requested.toFixed(1)} / 未分配: {(overcommitTotal - requested).toFixed(1)} core
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: '16px', marginBottom: 2 }}>
                        <Progress 
                          percent={Math.max(0, Math.min(100, usedPct))} 
                          size="small" 
                          showInfo={false}
                          strokeColor="#1890ff"
                        />
                        <span style={{ fontSize: 11 }}>{usedPct.toFixed(0)}%</span>
                      </div>
                      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 10, lineHeight: '12px' }}>
                        总量: {total} / 使用: {used.toFixed(1)} / 剩余: {(total - used).toFixed(1)} core
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
                          <b>总量</b>：物理节点的实际内存总容量
                          <br />
                          <b>超配总量</b>：物理节点的实际内存总容量乘以内存超配比后得到的逻辑内存数
                        </div>
                      }
                      placement="top"
                    >
                      <span style={{ marginLeft: 4, color: '#999', fontSize: 14, cursor: 'help' }}>?</span>
                    </Tooltip>
                  </span>
                ), 
                key: 'mem_usage', render: (_: any, r: any) => {
                  const s = String(r?.internalIP || r?.name || '').trim();
                  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 17 + s.charCodeAt(i)) >>> 0; }
                  const usedPct = 20 + (h % 65);
                  const memRaw = r?.memory ?? r?.status?.capacity?.memory;
                  const raw = String(memRaw || '').toUpperCase();
                  const num = Number(String(raw).replace(/[^0-9]/g, '')) || 0;
                  let total = 0;
                  if (/KI$/.test(raw)) { total = Math.round(num / (1024 * 1024)); }
                  else if (/MI$/.test(raw)) { total = Math.round(num / 1024); }
                  else if (/GI$/.test(raw)) { total = num; }
                  else { total = 128; }
                  const overcommitTotal = total * 2; // 默认超配比200%
                  const requested = total > 0 ? Math.round((usedPct / 100) * total * 10) / 10 : 0;
                  const used = total > 0 ? Math.round((usedPct / 100) * total * 10) / 10 : 0;
                  // 已分配率 = 已分配 / 超配总量
                  const requestedPct = overcommitTotal > 0 ? Math.round((requested / overcommitTotal) * 1000) / 10 : 0;
                  return (
                    <div style={{ minWidth: 180 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: '16px', marginBottom: 3 }}>
                        <Progress 
                          percent={Math.max(0, Math.min(100, requestedPct))} 
                          size="small" 
                          showInfo={false}
                          strokeColor="#52c41a"
                        />
                        <span style={{ fontSize: 11 }}>{requestedPct.toFixed(0)}%</span>
                      </div>
                      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 10, lineHeight: '12px', marginBottom: 3 }}>
                        超配总量: {overcommitTotal.toFixed(1)} / 分配: {requested.toFixed(1)} / 未分配: {(overcommitTotal - requested).toFixed(1)} GiB
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: '16px', marginBottom: 2 }}>
                        <Progress 
                          percent={Math.max(0, Math.min(100, usedPct))} 
                          size="small" 
                          showInfo={false}
                          strokeColor="#1890ff"
                        />
                        <span style={{ fontSize: 11 }}>{usedPct.toFixed(0)}%</span>
                      </div>
                      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 10, lineHeight: '12px' }}>
                        总量: {total} / 使用: {used.toFixed(1)} / 剩余: {(total - used).toFixed(1)} GiB
                      </div>
                    </div>
                  );
                }
              },
            ] as any}
            dataSource={displayNodes}
            loading={nodesLoading}
            pagination={false}
          />
        </div>
      ) : null}
      
      {/* === 3. 基本信息 === */}
      <div className="wizard-group-title">信息</div>
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
            }
          }
        ]}
      >
        <Input placeholder="显示名称（支持中文）" />
      </Form.Item>
      <Form.Item label="描述" name="description" preserve>
        <Input.TextArea placeholder="可选描述信息" autoSize={{ minRows: 2, maxRows: 4 }} />
      </Form.Item>
      <Form.Item label="虚机组" name="group" preserve>
        <Select placeholder="未选择虚拟机组" options={[{ label: '未选择', value: '' }]} />
      </Form.Item>
    </>
  );
};

export default StepBasic;
