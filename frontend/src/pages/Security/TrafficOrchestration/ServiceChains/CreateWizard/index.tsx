import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Button, Form, message, Steps, Card, Row, Col, Space, Divider } from 'antd';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../../../components/PageContainer';
import { fetchSecurityZones, fetchProtectionObjects, createServiceChain } from '../../../../../services/trafficOrchestration';
import { fetchTenants, fetchOrganizationsByTenant, fetchClouds, fetchCsmElementGroups, fetchCloudProviderEcs, fetchCsmVirtualElements, fetchInventoryInstancesByCloud } from '../../../../../services/api';
import { listSecurityDomains } from '../../../../../services/securityDomainApi';
import { useAuth } from '../../../../../contexts/AuthContext';
import { 
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Node,
} from 'react-flow-renderer';

// Constants and Types
import { 
  SECURITY_SERVICES, 
  initialNodes, 
  mockTransferData, 
  mockSecurityZones, 
  SCENARIOS, 
  CustomTransferItem 
} from './constants';

// Components
import TableTransfer from './components/TableTransfer';

// Steps
import StepBasicInfo from './steps/StepBasicInfo';
import StepProtectionObjects from './steps/StepProtectionObjects';
import StepOrchestration from './steps/StepOrchestration';
import StepReview from './steps/StepReview';

const SERVICE_TYPES = ['waf','ips','ids','av','fw','dlp','casb','lb','ddos','vpn','audit'];
const groupsByTypeInit = Object.fromEntries(SERVICE_TYPES.map(t => [t, [] as { id: string; name: string; description: string; count: number; tags: string[]; cpu: number; mem: number }[]]));

const CreateServiceChainWizard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [current, setCurrent] = useState(0);
  const [form] = Form.useForm();
  const selectedClusterId = Form.useWatch('cluster', form);
  const [scenarioType, setScenarioType] = useState<'detection' | 'encryption'>('detection');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('std');
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null);
  const [steeringMode] = useState<'direct'>('direct');
  const [globalObjects, setGlobalObjects] = useState<CustomTransferItem[]>(mockTransferData);
  const [clusterObjects, setClusterObjects] = useState<CustomTransferItem[]>([]);
  const [manualObjects, setManualObjects] = useState<CustomTransferItem[]>([]);
  const [trafficMode, setTrafficMode] = useState<'direct' | 'vr'>('direct');
  const [vrDomains, setVrDomains] = useState<any[]>([]);

  const directData = useMemo(() => {
    const all = [...manualObjects, ...clusterObjects, ...globalObjects];
    const seen = new Set();
    return all.filter(item => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
  }, [manualObjects, clusterObjects, globalObjects]);

  const [addDirectOpen, setAddDirectOpen] = useState(false);
  const [addDirectForm] = Form.useForm();
  const [tenants, setTenants] = useState<any[]>([]);
  const [orgOptions, setOrgOptions] = useState<any[]>([]);
  const [cloudPools, setCloudPools] = useState<any[]>([]);
  const [groupsByType, setGroupsByType] = useState<Record<string, { id: string; name: string; description: string; count: number; tags: string[]; cpu: number; mem: number }[]>>(groupsByTypeInit);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [clusterId, setClusterId] = useState<string>('');
  
  const sortedServices = useMemo(() => {
    const cid = clusterId || form.getFieldValue('cluster');
    const isAvail = (t: string) => Boolean(cid) && (groupsByType[t] && groupsByType[t].length > 0);
    return [...SECURITY_SERVICES].sort((a, b) => Number(isAvail(b.type)) - Number(isAvail(a.type)));
  }, [clusterId, groupsByType, form]);
  
  // React Flow State
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [nodeId, setNodeId] = useState(1);
  const [collapsed, setCollapsed] = useState(false);

  // Group Selection State
  const [groupSelectionVisible, setGroupSelectionVisible] = useState(false);
  const [pendingService, setPendingService] = useState<{type: string, label: string, icon: React.ReactNode, color: string} | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const objs = await fetchProtectionObjects({});
        if (Array.isArray(objs) && objs.length > 0) {
          const mapped: CustomTransferItem[] = objs.map((o: any) => ({
            key: o.value || o.id,
            title: o.name,
            description: o.description || '',
            type: (o.type === 'subnet' ? 'Network' : (o.type === 'ip' ? 'IP' : (o.type === 'line' ? 'IP' : 'VM'))) as CustomTransferItem['type'],
          }));
          setGlobalObjects(mapped);
        } else {
          setGlobalObjects(mockTransferData);
        }
      } catch (e) {
        console.error(e);
        setGlobalObjects(mockTransferData);
      }
      try {
        const ts = await fetchTenants();
        setTenants(Array.isArray(ts) ? ts : []);
      } catch (e) {
        console.error(e);
      }
      try {
        const clouds = await fetchClouds();
        const list = Array.isArray(clouds) ? clouds : [];
        const pools = list.filter((c: any) => {
          const pv = String((c?.config?.provider || '')).toLowerCase();
          return pv === 'cloudmap' || pv === 'csm' || pv.startsWith('cloudmap') || pv === 'aliyun' || pv === 'huaweicloud' || pv === 'tencentcloud';
        });
        setCloudPools(pools);
      } catch (e) {
        console.error(e);
      }
      try {
        const vrs = await listSecurityDomains();
        setVrDomains(Array.isArray(vrs) ? vrs : []);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  useEffect(() => {
    setNodes((nds) => nds.map(n => {
      if (n.id === 'in') {
        return {
          ...n,
          data: {
            ...(n as any).data,
            onEditLabel: (newLabel: string) => setNodes((prev) => prev.map(m => m.id === 'in' ? ({ ...m, data: { ...(m as any).data, label: newLabel } }) : m))
          }
        };
      } else if (n.id === 'out') {
        return {
          ...n,
          data: {
            ...(n as any).data,
            onEditLabel: (newLabel: string) => setNodes((prev) => prev.map(m => m.id === 'out' ? ({ ...m, data: { ...(m as any).data, label: newLabel } }) : m))
          }
        };
      }
      return n;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const enabled = ['wan', 'lan-sm', 'lan-gm'].includes(selectedTemplate);
    setNodes((nds) => nds.map(n => {
      if (n.id === 'in') {
        return { ...n, data: { ...(n as any).data, decryptEnabled: enabled } };
      }
      if (n.id === 'out') {
        return { ...n, data: { ...(n as any).data, encryptEnabled: enabled } };
      }
      return n;
    }));
  }, [selectedTemplate, setNodes]);

  useEffect(() => {
    (async () => {
      setClusterId(String(selectedClusterId || ''));
      const poolId = selectedClusterId || form.getFieldValue('cluster');
      if (!poolId) return;
      
      // Fetch ECS for the selected pool
      (async () => {
        const foundPool = cloudPools.find(p => String(p.id) === String(poolId));
        if (foundPool) {
          try {
            const provider = (foundPool?.config?.provider || foundPool?.type || '').toLowerCase();
            let rawList: any[] = [];
            
            if (provider === 'csm' || provider === 'cloudmap' || provider.startsWith('cloudmap')) {
              const csmRes: any = await fetchCsmVirtualElements(String(poolId));
              rawList = csmRes?.data?.items || [];
            } else {
              // Try inventory first
              let loadedFromInventory = false;
              try {
                const invJson: any = await fetchInventoryInstancesByCloud(String(poolId));
                if (Array.isArray(invJson?.data) && invJson.data.length > 0) {
                   rawList = invJson.data;
                   loadedFromInventory = true;
                }
              } catch (e) { console.warn('Inventory fetch failed', e); }

              if (!loadedFromInventory) {
                const json: any = await fetchCloudProviderEcs(String(poolId));
                if (provider.includes('tencent')) {
                  rawList = json?.data?.InstanceSet || [];
                } else if (provider.includes('huawei')) {
                  rawList = json?.data?.servers || [];
                } else if (provider === 'harvester') {
                  rawList = Array.isArray(json?.data) ? json.data : (json?.data?.Instances?.Instance || json?.data?.items || json?.data?.data || []);
                } else {
                  rawList = json?.data?.Instances?.Instance || [];
                }
              }
            }

            const list = Array.isArray(rawList) ? rawList : [];
            const mappedVms: CustomTransferItem[] = list.map((vm: any) => ({
              key: vm.id || vm.InstanceId || vm.uuid,
              title: vm.name || vm.InstanceName || vm.id,
              description: (Array.isArray(vm.privateIps) ? vm.privateIps.join(', ') : (vm.Description || vm.description || vm.ip || '')),
              type: 'VM',
              ports: '全部'
            }));
            
            setClusterObjects(mappedVms);
          } catch (ecsErr) {
            console.error('Fetch ECS error:', ecsErr);
          }
        }
      })();

      setLoadingGroups(true);
      try {
        const res = await fetchCsmElementGroups(String(poolId));
        const arr =
          Array.isArray(res) ? res
          : Array.isArray(res?.data) ? res.data
          : Array.isArray(res?.data?.items) ? res.data.items
          : Array.isArray(res?.items) ? res.items
          : Array.isArray(res?.data?.page) ? res.data.page
          : Array.isArray(res?.page) ? res.page
          : Array.isArray(res?.data?.list) ? res.data.list
          : Array.isArray(res?.list) ? res.list
          : Array.isArray(res?.data?.records) ? res.data.records
          : Array.isArray(res?.records) ? res.records
          : [];
        const map: Record<string, { id: string; name: string; description: string; count: number; tags: string[]; cpu: number; mem: number }[]> = Object.fromEntries(SERVICE_TYPES.map(t => [t, []]));
        for (const g of (arr as any[])) {
          const id = String(g?.id || g?.group_id || g?.GroupId || '').trim() || String(g?.name || '').trim();
          const name = String(g?.name || g?.group_name || g?.GroupName || id || '').trim();
          const description = String(g?.description || g?.desc || '').trim() || name;
          const count = Number(g?.Count ?? g?.count ?? g?.elements?.length ?? 0);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const cpu = Math.min(90, Math.max(10, Math.floor(Math.random() * 60) + 20));
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const mem = Math.min(90, Math.max(10, Math.floor(Math.random() * 60) + 20));
          const tags: string[] = [];
          const rawType = String(g?.type || g?.Type || (String(id).includes('::') ? String(id).split('::')[1] : '') || name).toLowerCase();
          const found = SERVICE_TYPES.find(t => rawType.includes(t));
          const key = found || 'fw';
          map[key].push({ id, name, description, count, tags, cpu, mem });
        }
        setGroupsByType(map);
      } catch (e) {
        console.error(e);
        setGroupsByType(groupsByTypeInit);
      } finally {
        setLoadingGroups(false);
      }
    })();
  }, [selectedClusterId, form, cloudPools]);

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge({ 
    ...params, 
    type: 'particle', 
    animated: false, 
    style: { stroke: '#adc6ff', strokeWidth: 2 },
  }, eds)), [setEdges]);

  const addNode = (type: string, label: string, icon: React.ReactNode, color: string, groupInfo?: any) => {
    // Check if service type already exists
    if (nodes.some(n => n.data.serviceType === type)) {
      message.warning(`${label} 服务已存在，不能重复添加`);
      return;
    }

    // Check if group selection is needed
    if ((groupsByType[type] && groupsByType[type].length > 0) && !groupInfo) {
      const cid = clusterId || form.getFieldValue('cluster');
      if (!cid) {
        message.warning('请先选择所属集群');
        return;
      }
      setPendingService({ type, label, icon, color });
      setSelectedGroup(groupsByType[type][0].id);
      setGroupSelectionVisible(true);
      return;
    }

    // Mock data for group instances
    let instanceCount = 1;
    let groupLoad = 30;
    
    if (groupInfo) {
      instanceCount = groupInfo.count;
      groupLoad = Math.floor(Math.random() * 60) + 20;
    } else {
      instanceCount = Math.floor(Math.random() * 3) + 1; // 1-3 instances
      groupLoad = Math.floor(Math.random() * 60) + 20; // 20-80% load
    }
    
    const instances = Array.from({ length: instanceCount }).map((_, i) => ({
      id: `${label}-${nodeId}-${i + 1}`,
      ip: `10.0.${nodeId}.${10 + i}`,
      status: Math.random() > 0.1 ? 'normal' : 'abnormal',
      load: Math.floor(Math.random() * 40) + 20 // Individual load
    }));

    const newNode: Node = {
      id: `node-${nodeId}`,
      type: 'serviceNode',
      position: { x: 250 + (nodeId * 50), y: 150 + (nodeId * 30) },
      data: { 
        label: groupInfo ? groupInfo.name : `${label}-${nodeId}`, 
        typeLabel: label,
        serviceType: type,
        icon: icon,
        color: color,
        instanceCount,
        load: groupLoad,
        instances
      },
    };
    setNodes((nds) => {
      // Insert before the last node (Traffic Out) if possible, or just append
      const outNode = nds.find(n => n.id === 'out');
      const otherNodes = nds.filter(n => n.id !== 'out');
      return outNode ? [...otherNodes, newNode, outNode] : [...nds, newNode];
    });
    setNodeId(nodeId + 1);
  };

  const handleGroupSelectionConfirm = () => {
    if (pendingService && selectedGroup) {
      const groups = groupsByType[pendingService.type] || [];
      const group = groups.find(g => g.id === selectedGroup);
      if (group) {
        addNode(pendingService.type, pendingService.label, pendingService.icon, pendingService.color, group);
      }
    }
    setGroupSelectionVisible(false);
    setPendingService(null);
  };


  const onLayout = useCallback(() => {
    // Topological Sort (Kahn's Algorithm) to linearize the graph
    // This ensures all nodes are on the same horizontal line (y=200) without overlapping,
    // and follows the flow direction.

    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    
    // Initialize
    nodes.forEach(n => {
      adj.set(n.id, []);
      inDegree.set(n.id, 0);
    });
    
    // Build Graph
    edges.forEach(e => {
      if (adj.has(e.source) && adj.has(e.target)) {
        adj.get(e.source)!.push(e.target);
        inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
      }
    });

    // Initialize queue with nodes having in-degree 0
    const queue: string[] = [];
    const sortedIds: string[] = [];
    
    // Prioritize 'in' node
    if (inDegree.get('in') === 0) {
       queue.push('in');
    }
    
    // Add other 0 in-degree nodes (excluding 'in' which is already handled)
    nodes.forEach(n => {
      if (n.id !== 'in' && inDegree.get(n.id) === 0) {
        queue.push(n.id);
      }
    });

    // Process queue
    while (queue.length > 0) {
      const u = queue.shift()!;
      sortedIds.push(u);
      
      const neighbors = adj.get(u) || [];
      neighbors.forEach(v => {
        inDegree.set(v, (inDegree.get(v)! - 1));
        if (inDegree.get(v) === 0) {
          queue.push(v);
        }
      });
    }

    // Handle cycles or remaining disconnected nodes (append them)
    if (sortedIds.length < nodes.length) {
      const visited = new Set(sortedIds);
      nodes.forEach(n => {
        if (!visited.has(n.id)) {
          sortedIds.push(n.id);
        }
      });
    }

    setNodes((nds) => {
      const layoutMap = new Map<string, number>();
      sortedIds.forEach((id, index) => layoutMap.set(id, index));
      
      return nds.map(node => {
        const index = layoutMap.has(node.id) ? layoutMap.get(node.id)! : 0;
        
        return { 
          ...node, 
          position: { 
            x: 50 + index * 250, 
            y: 150
          } 
        };
      });
    });
  }, [nodes, edges, setNodes]);

  const clearFlow = () => {
    setNodes(initialNodes);
    setEdges([]);
    setNodeId(1);
  };

  const handleFinish = async () => {
    try {
      const values = form.getFieldsValue(true);
      const services = nodes
        .filter(n => n.type === 'serviceNode')
        .sort((a, b) => a.position.x - b.position.x)
        .map(n => (n as any).data?.serviceType)
        .filter(Boolean);

      const protectionTargets = trafficMode === 'direct' 
        ? { mode: 'direct', objects: form.getFieldValue('protectedObjects') || [] }
        : { mode: 'vr', objects: form.getFieldValue('vrDomains') || [] };

      const nowTs = Date.now();
      const payload = {
        name: String(values.name || '').trim() || `未命名服务链-${nowTs}`,
        clusterName: (() => {
          const sel = cloudPools.find((c: any) => String(c.id) === String(values.cluster));
          const name = sel?.name || '';
          return String(name || values.cluster || '').trim() || '默认资源池';
        })(),
        type: values.type || 'serial',
        description: String(values.description || ''),
        steeringMode: 'direct',
        securityServices: services.join(','),
        protectionTargets: JSON.stringify(protectionTargets),
        tenantId: values.tenantId,
        organizationId: values.organizationId,
        topology: {
          nodes: nodes.map(n => ({ id: n.id, type: n.type, data: (n as any).data, position: n.position })),
          edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, type: e.type }))
        }
      };

      try {
        await createServiceChain(payload);
        message.success('服务链创建成功');
        navigate('/admin/security/traffic/service-chains');
      } catch (error) {
        message.error('服务链创建失败');
      }
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const next = async () => {
    try {
      if (current === 0) {
        const baseFields = ['name', 'cluster', 'type'];
        const extra = (user?.role === 'super_admin') ? ['tenantId', 'organizationId'] : [];
        await form.validateFields([...baseFields, ...extra]);
      } else if (current === 1) {
        if (trafficMode === 'direct') {
          await form.validateFields(['protectedObjects']);
          const selectedKeys = form.getFieldValue('protectedObjects') || [];
          const selectedObjects = directData.filter(item => selectedKeys.includes(item.key));
          setNodes((nds) => nds.map(node => {
            if (node.id === 'out') {
              return {
                ...node,
                data: {
                  ...node.data,
                  protectedObjects: selectedObjects
                }
              };
            }
            return node;
          }));
        } else {
          await form.validateFields(['vrDomains']);
          // VR模式下可能不需要更新out节点的protectedObjects，或者需要不同的处理
        }
      }
      setCurrent(current + 1);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const prev = () => {
    setCurrent(current - 1);
  };

  const steps = [
    { title: '基础信息' },
    { title: '防护对象' },
    { title: '服务链编排' },
    { title: '确认创建' },
  ];

  const flattenOrganizations = (orgTree: any[]): any[] => {
    const out: any[] = [];
    const recur = (list: any[]) => {
      for (const o of list) {
        out.push({ id: o.id, name: o.name });
        if (Array.isArray(o.children) && o.children.length) recur(o.children);
      }
    };
    recur(Array.isArray(orgTree) ? orgTree : []);
    return out;
  };

  const renderContent = () => {
    if (current === 0) {
      return (
        <StepBasicInfo 
          form={form}
          scenarioType={scenarioType}
          setScenarioType={setScenarioType}
          selectedTemplate={selectedTemplate}
          setSelectedTemplate={setSelectedTemplate}
          hoveredTemplate={hoveredTemplate}
          setHoveredTemplate={setHoveredTemplate}
          cloudPools={cloudPools}
          tenants={tenants}
          orgOptions={orgOptions}
          setOrgOptions={setOrgOptions}
          flattenOrganizations={flattenOrganizations}
          user={user}
          fetchOrganizationsByTenant={fetchOrganizationsByTenant}
        />
      );
    } else if (current === 1) {
      return (
        <StepProtectionObjects
          form={form}
          TableTransfer={TableTransfer}
          directData={directData}
          onReload={setGlobalObjects}
          onAdd={(item: any) => setManualObjects((prev) => [item, ...prev])}
          addDirectOpen={addDirectOpen}
          setAddDirectOpen={setAddDirectOpen}
          addDirectForm={addDirectForm}
          fetchProtectionObjects={fetchProtectionObjects}
          message={message}
          trafficMode={trafficMode}
          setTrafficMode={setTrafficMode}
          vrDomains={vrDomains}
        />
      );
    } else if (current === 2) {
      return (
        <StepOrchestration
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          sortedServices={sortedServices}
          clusterId={clusterId}
          form={form}
          groupsByType={groupsByType}
          addNode={addNode}
          clearFlow={clearFlow}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onLayout={onLayout}
          groupSelectionVisible={groupSelectionVisible}
          setGroupSelectionVisible={setGroupSelectionVisible}
          pendingService={pendingService}
          setPendingService={setPendingService}
          selectedGroup={selectedGroup}
          setSelectedGroup={setSelectedGroup}
          handleGroupSelectionConfirm={handleGroupSelectionConfirm}
        />
      );
    } else if (current === 3) {
      return (
        <StepReview
          form={form}
          scenarioType={scenarioType}
          selectedTemplate={selectedTemplate}
          user={user}
          tenants={tenants}
          orgOptions={orgOptions}
          nodes={nodes}
          edges={edges}
        />
      );
    }
    return null;
  };

  return (
    <PageContainer
      title="新建服务链"
      breadcrumb={[
        { label: '网络安全', href: '/admin/security' },
        { label: '服务链管理', href: '/admin/security/traffic/service-chains' },
        { label: '新建服务链' }
      ]}
      asCard={false}
    >
      <Row gutter={16}>
        <Col span={5}>
          <Card size="small" title={<span style={{ fontSize: 13, fontWeight: 400 }}>步骤</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps direction="vertical" size="small" current={current} onChange={(idx) => setCurrent(idx)} items={steps} />
          </Card>
        </Col>
        <Col span={19}>
          <Card size="small" title={<span style={{ fontSize: 13, fontWeight: 400 }}>{`第 ${current + 1} 步：${steps[current]?.title || ''}`}</span>} variant="outlined">
            <div style={{ minHeight: 400 }}>{renderContent()}</div>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Space>
                <Button onClick={() => navigate('/admin/security/traffic/service-chains')}>返回列表</Button>
                <Button onClick={prev} disabled={current===0}>上一步</Button>
              </Space>
              <Space>
                <Button type="primary" onClick={() => { if (current < steps.length - 1) next(); else handleFinish(); }}>
                  {current < steps.length - 1 ? '下一步' : '提交'}
                </Button>
              </Space>
            </div>
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default CreateServiceChainWizard;
