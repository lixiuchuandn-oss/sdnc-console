import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Tabs, Alert, Tree, App, Space } from 'antd';
import { ReloadOutlined, CloudServerOutlined, CloudOutlined, BranchesOutlined, ApartmentOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import { 
  fetchClouds, fetchCloudProviderEcs, API_BASE_URL, getAuthHeaders
} from '../../../services/api';
import '../../common/filters.css';
import './CloudConsole.css';
import CloudConsoleEcsTable, { ECS_COLUMNS_CONFIG } from './CloudConsoleEcsTable';
import CloudConsolePvcTable from './CloudConsolePvcTable';
import CloudConsoleImageTable from './CloudConsoleImageTable';
import CloudConsoleNadTable from './CloudConsoleNadTable';
import CloudConsoleNetwork from './CloudConsoleNetwork';
import CloudConsoleLbTable from './CloudConsoleLbTable';
import CloudConsoleVpcDetail from './CloudConsoleVpcDetail';
import SharedToolbar from '../../../components/SharedToolbar';

type CloudItem = { id: string; name: string; region?: string; type?: string; config?: any; status?: string };

/**
 * CloudConsolePage 组件
 * 
 * 云主机控制台的主入口页面。
 * 
 * 功能职责:
 * 1. 布局管理: 左侧资源池/VPC 树状导航，右侧资源详情内容区域。
 * 2. 状态管理: 维护当前选中的资源池 (currentCloudId)、选中的 VPC (selectedVpc) 以及各资源列表数据 (ECS, PVC, Images 等)。
 * 3. 数据加载: 负责调用后端 API 获取各类云资源数据，并分发给子组件展示。
 * 4. 权限控制: 检查用户是否有查看云主机的权限。
 */
const CloudConsolePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { message } = App.useApp();
  
  // ==================== State Definitions (状态定义) ====================
  
  // 资源池列表
  const [clouds, setClouds] = useState<CloudItem[]>([]);
  // 当前选中的资源池 ID
  const [currentCloudId, setCurrentCloudId] = useState<string | undefined>();
  
  // 各类资源数据列表
  const [ecs, setEcs] = useState<any[]>([]);        // 云主机
  const [pvcs, setPvcs] = useState<any[]>([]);      // 虚拟卷 (Harvester)
  const [images, setImages] = useState<any[]>([]);  // 镜像 (Harvester)
  const [nads, setNads] = useState<any[]>([]);      // 网络附件定义 (Harvester 扁平网络)
  const [vpcs, setVpcs] = useState<any[]>([]);      // VPC 列表
  const [subnets, setSubnets] = useState<any[]>([]); // 子网列表
  const [lbrules, setLbrules] = useState<any[]>([]); // 负载均衡 (Harvester)
  
  // UI 状态
  const [loading, setLoading] = useState(false);
  const [vpcLoading, setVpcLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState<string>(''); // 搜索关键字 (暂未使用)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 }); // 分页 (暂未使用，由 Table 内部处理)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]); // 左侧树展开节点
  const [activeTab, setActiveTab] = useState<string>('ecs'); // 当前激活的 Tab 页签
  const [selectedVpc, setSelectedVpc] = useState<string | null>(null); // 当前选中的 VPC (用于 VPC 详情视图)
  const [caps, setCaps] = useState<any>({}); // 当前云平台的能力集 (capabilities)，用于判断是否为 Harvester 等
  
  // ==================== Permissions & Memoized Data (权限与缓存数据) ====================

  // 检查是否有查看云主机的权限
  // 权限点: clouds.instances:read
  const canReadEcs = useMemo(() => hasPermissionForAction(user?.permissions || [], 'clouds.instances:read'), [user]);

  // 构建左侧树状导航数据
  // 结构: Cloudmap (Root) -> Resource Pool (Level 1) -> VPCs (Level 2, only for current pool)
  // 逻辑: 
  // 1. 遍历所有 Cloudmap 类型的资源池。
  // 2. 如果某个资源池被选中 (currentCloudId)，则将其下的 VPC 列表作为子节点挂载。
  // 3. VPC 节点 key 前缀为 "vpc-" 以便在 onSelect 中区分。
  const treeData = useMemo(() => {
    const cloudmapChildren = clouds.map(c => {
      const isCurrent = c.id === currentCloudId;
      const children: any[] = [];
      
      // 如果是当前选中的资源池，则将 VPC 列表作为子节点展示
      if (isCurrent && vpcs.length > 0) {
        children.push(...vpcs.map(v => {
          const vpcName = v.name || v.metadata?.name || v.id || 'Unknown';
          const vpcKey = v.metadata?.name || v.id || v.name || 'unknown';
          return {
            title: vpcName,
            key: `vpc-${vpcKey}`, // VPC 节点的 key 前缀
            icon: <ApartmentOutlined />,
            isLeaf: true
          };
        }));
      }

      return {
        title: <span className="cloud-title">{c.name}</span>,
        key: c.id,
        icon: <CloudServerOutlined />,
        children: children.length > 0 ? children : undefined,
        isLeaf: children.length === 0
      };
    });

    if (cloudmapChildren.length === 0) return [];

    // 根节点 "Cloudmap"
    return [{
      title: 'Cloudmap',
      key: 'group-cloudmap',
      selectable: false,
      children: cloudmapChildren
    }];
  }, [clouds, currentCloudId, vpcs]);

  // ==================== Data Loading Functions (数据加载函数) ====================

  // 加载资源池列表
  const loadClouds = async () => {
    try {
      const list: any[] = await fetchClouds();
      const arr = Array.isArray(list) ? list : [];
      // 过滤出 Cloudmap 系列的资源池 (Private, Edge, CSM)
      const filtered = arr.filter(c => {
        const pRaw = String(c?.config?.provider || '');
        const lower = pRaw.toLowerCase();
        return lower.startsWith('cloudmap');
      });
      setClouds(filtered);
      
      // 自动选择第一个资源池，如果当前未选择或选择无效
      if (!currentCloudId && filtered.length > 0) {
        const firstId = filtered[0].id;
        setCurrentCloudId(firstId);
      } else if (currentCloudId && !filtered.find(c => c.id === currentCloudId)) {
        if (filtered.length > 0) {
          const firstId = filtered[0].id;
          setCurrentCloudId(firstId);
        } else {
          setCurrentCloudId(undefined);
        }
      }
      
      if (filtered.length === 0) {
        setError('当前未找到 Cloudmap 资源池，请先在“资源池管理”中创建');
      }
    } catch (e) {
      // ignore
    }
  };

  // 加载云主机 (ECS) 列表
  // 支持 Harvester (K8s CRD) 和 Standard Cloud (Aliyun, Huawei, etc.) 的数据格式
  const loadEcs = async (cloudId?: string, forceRefresh: boolean = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    
    setLoading(true);
    setError(null);
    try {
      const json: any = await fetchCloudProviderEcs(cid);
      
      // 兼容不同后端的返回格式:
      // 1. json.data: 标准数组
      // 2. json.data.Instances.Instance: 阿里云风格
      // 3. json.data.servers: OpenStack 风格
      // 4. json.data.InstanceSet: 腾讯云风格
      let list: any[] = [];
      if (Array.isArray(json?.data)) {
        list = json.data;
      } else if (json?.data?.Instances?.Instance) {
        list = json.data.Instances.Instance;
      } else if (json?.data?.servers) {
        list = json.data.servers;
      } else if (json?.data?.InstanceSet) {
        list = json.data.InstanceSet;
      }

      setCaps(json?.capabilities || {}); // 更新能力集 (如 isHarvester)
      setEcs(list);
    } catch (e: any) {
      console.error('[CloudConsole] loadEcs error:', e);
      setError(e?.message || '查询失败');
      setEcs([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载虚拟卷 (PVC) 列表
  const loadPvcs = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/clouds/${cid}/resources/pvcs`, {
        headers: getAuthHeaders()
      });
      const json = await res.json();
      if (json?.data?.items) {
        // 过滤掉系统命名空间，只显示用户关心的卷
        const systemNamespaces = [
          'kube-system', 'harvester-system', 'longhorn-system', 
          'cattle-system', 'cattle-fleet-system', 'cattle-impersonation-system',
          'cattle-monitoring-system',
          'kube-node-lease', 'kube-public'
        ];
        const filtered = json.data.items.filter((item: any) => {
          const ns = item?.metadata?.namespace;
          if (!ns) return true;
          if (systemNamespaces.includes(ns)) return false;
          if (ns.startsWith('cattle-global-')) return false;
          return true;
        });
        setPvcs(filtered);
      } else {
        setPvcs([]);
      }
    } catch (e: any) {
      console.error('[CloudConsole] loadPvcs error:', e);
      setPvcs([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载镜像列表
  const loadImages = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;

    setLoading(true);
    setError(null);
    try {
      // 默认加载 default 命名空间的镜像
      const res = await fetch(`${API_BASE_URL}/api/clouds/${cid}/resources/images?namespace=default`, {
        headers: getAuthHeaders()
      });
      const json = await res.json();
      if (json?.data?.items) {
          setImages(json.data.items);
      } else {
          setImages([]);
      }
    } catch (e: any) {
      console.error('[CloudConsole] loadImages error:', e);
      setImages([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载网络附件定义 (NADs) - 即扁平网络
  const loadNads = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/clouds/${cid}/resources/nads`, {
        headers: getAuthHeaders()
      });
      const json = await res.json();
      if (json?.data?.items) {
          setNads(json.data.items);
      } else {
          setNads([]);
      }
    } catch (e: any) {
      console.error('[CloudConsole] loadNads error:', e);
      setNads([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 VPC 和 子网
  const loadVpcsAndSubnets = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setVpcLoading(true);
    try {
      const [vpcsRes, subnetsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/clouds/${cid}/resources/vpcs`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/clouds/${cid}/resources/subnets`, { headers: getAuthHeaders() })
      ]);
      const vpcsJson = await vpcsRes.json();
      const subnetsJson = await subnetsRes.json();
      setVpcs(vpcsJson?.data?.items || []);
      setSubnets(subnetsJson?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadVpcsAndSubnets error:', e);
      setVpcs([]);
      setSubnets([]);
    } finally {
      setVpcLoading(false);
    }
  };

  // 加载负载均衡 (Harvester LoadBalancers)
  const loadLbrules = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    setError(null);
    try {
      // 使用 Harvester 专用的 LB 接口 (基于 Flat Network)
      const res = await fetch(`${API_BASE_URL}/api/clouds/${cid}/resources/harvester-loadbalancers`, { headers: getAuthHeaders() });
      const json = await res.json();
      setLbrules(json?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadLbrules error:', e);
      setLbrules([]);
    } finally {
      setLoading(false);
    }
  };

  // ==================== Effects (副作用) ====================

  // 初始化: 加载资源池
  useEffect(() => {
    loadClouds();
  }, []);

  // 当选中的资源池 (currentCloudId) 变化时:
  // 1. 加载该资源池的 VPC 和子网数据 (用于构建左侧树)
  // 2. 展开左侧树的对应节点
  useEffect(() => {
    if (currentCloudId) {
      loadVpcsAndSubnets(currentCloudId);
      // Ensure the current cloud node is expanded to show VPCs
      setExpandedKeys(prev => {
        const newKeys = new Set(prev);
        newKeys.add('group-cloudmap'); // Always expand root
        newKeys.add(currentCloudId);
        return Array.from(newKeys);
      });
    }
  }, [currentCloudId]);

  // 当识别为 Harvester 环境时，预加载所有相关资源以显示 Tab 统计计数
  useEffect(() => {
    if (currentCloudId && caps?.isHarvester) {
      loadPvcs(currentCloudId);
      loadImages(currentCloudId);
      loadNads(currentCloudId);
      loadLbrules(currentCloudId);
    }
  }, [currentCloudId, caps?.isHarvester]);

  // 当 Tab 页签切换或资源池变化时，加载对应 Tab 的数据
  useEffect(() => {
    if (!currentCloudId) return;
    switch (activeTab) {
      case 'ecs':
        loadEcs(currentCloudId);
        break;
      case 'vpc':
        // VPC 数据已由上面的 effect 加载，此处无需重复加载
        // 用户若需刷新，可使用界面上的刷新按钮
        break;
      case 'lb':
        loadLbrules(currentCloudId);
        break;
      case 'pvc':
        if (caps?.isHarvester) loadPvcs(currentCloudId);
        break;
      case 'image':
        if (caps?.isHarvester) loadImages(currentCloudId);
        break;
      case 'nad':
        if (caps?.isHarvester) loadNads(currentCloudId);
        break;
    }
  }, [currentCloudId, activeTab, caps?.isHarvester]);

  // ==================== Render Helpers (渲染辅助) ====================
  
  // 根据 Capabilities 动态生成 Tabs 配置
  const tabItems = useMemo(() => {
    const items = [
            {
              label: `云主机${ecs.length > 0 ? ` (${ecs.length})` : ''}`,
              key: 'ecs',
              children: (
                <div className="cloud-console-tab-pane">
                  <CloudConsoleEcsTable 
                    dataSource={ecs}
                    loading={loading}
                    isHarvester={!!caps?.isHarvester}
                    onRefresh={() => loadEcs(currentCloudId, true)}
                    images={images}
                    cloudId={currentCloudId}
                  />
                </div>
              )
            }
          ];

          // Harvester 特有 Tab: 虚拟磁盘, 镜像, 扁平网络, 负载均衡
          if (caps?.isHarvester) {
            items.push({
              label: `虚拟磁盘${pvcs.length > 0 ? ` (${pvcs.length})` : ''}`,
              key: 'pvc',
              children: (
                <CloudConsolePvcTable 
                  dataSource={pvcs}
                  loading={loading}
                  onRefresh={() => loadPvcs(currentCloudId)}
                  cloudId={currentCloudId || ''}
                />
              )
            });
            items.push({
              label: `虚拟机镜像${images.length > 0 ? ` (${images.length})` : ''}`,
              key: 'image',
              children: (
                <CloudConsoleImageTable 
                  dataSource={images}
                  loading={loading}
                  onRefresh={() => loadImages(currentCloudId)}
                />
              )
            });
            items.push({
              label: `扁平网络${nads.length > 0 ? ` (${nads.length})` : ''}`,
              key: 'nad',
              children: (
                <CloudConsoleNadTable 
                  dataSource={nads}
                  loading={loading}
                  onRefresh={() => loadNads(currentCloudId)}
                />
              )
            });
            items.push({
              label: `负载均衡${lbrules.length > 0 ? ` (${lbrules.length})` : ''}`,
              key: 'lb',
              children: (
                <CloudConsoleLbTable 
                  dataSource={lbrules}
                  loading={loading}
                  onRefresh={() => loadLbrules(currentCloudId)}
                />
              )
            });
          }

          // 通用 Tab: 虚拟专有云 (VPC)
          // 移动 VPC & 网络 到最后 (扁平网络后面)
          items.push({
            label: `虚拟专有云VPC${vpcs.length > 0 ? ` (${vpcs.length})` : ''}`,
            key: 'vpc',
            children: (
              <CloudConsoleNetwork 
                cloudId={currentCloudId || ''}
                vpcs={vpcs}
                subnets={subnets}
                vpcLoading={vpcLoading}
                onRefreshVpc={() => loadVpcsAndSubnets(currentCloudId)}
              />
            )
          });

    return items;
  }, [
    caps, ecs, loading, pagination, canReadEcs, keyword, pvcs, 
    images, nads, vpcs, subnets, lbrules, currentCloudId
  ]);

  // 页面布局:
  // - PageContainer: 统一的页面容器，提供标题和面包屑
  // - cloud-console-root: Flex 布局容器
  //   - Sidebar: 左侧固定宽度的树状导航
  //   - Content: 右侧自适应宽度的内容区域 (包含 VPC 详情或 Tabs)
  return (
    <PageContainer
      asCard={false}
      breadcrumb={[]}
      title="云主机控制台"
      subtitle="统一管理 Cloudmap 云环境下的云主机资源，支持查看、远程连接、电源管理等操作"
      style={{ height: '100%' }}
    >
      <div className="cloud-console-root">
        {/* ==================== Sidebar (左侧导航: 资源池/VPC) ==================== */}
        <div className="cloud-console-sidebar" style={{ padding: '12px 12px 0 12px' }}>
          <div>
            <Input.Search placeholder="搜索资源池" allowClear />
          </div>
          <Tree
            className="cloud-console-tree"
            blockNode
            showIcon
            expandedKeys={expandedKeys}
            onExpand={(keys: any) => setExpandedKeys(keys)}
            selectedKeys={selectedVpc ? [`vpc-${selectedVpc}`] : [currentCloudId || '']}
            onSelect={(keys) => {
              // 处理树节点点击事件
              // 1. 点击 VPC: 切换到 VPC 详情视图
              // 2. 点击资源池: 切换到资源列表视图 (Tabs)
              if (keys.length > 0) {
                const key = keys[0] as string;
                // 点击 VPC 节点
                if (key.startsWith('vpc-')) {
                   // 选中 VPC 时，右侧显示 VPC 详情，不再通过 Tab 切换
                   setSelectedVpc(key.replace(/^vpc-/, ''));
                } else if (key === 'group-cloudmap') {
                   // 点击根节点不做操作
                } else {
                  // 点击资源池节点: 重置选中的 VPC，显示资源池级别的 Tabs
                  setCurrentCloudId(key);
                  setSelectedVpc(null);
                }
              }
            }}
            treeData={treeData}
          />
        </div>
        {/* ==================== Content (右侧内容区域) ==================== */}
        <div className="cloud-console-content">
          <div className="cloud-console-content-scroll">
            {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}

            {/* 视图切换逻辑: 选中 VPC 时显示详情，否则显示资源池 Tabs */}
            {selectedVpc ? (
                // 场景 A: 选中了 VPC，显示 VPC 详情视图
                <CloudConsoleVpcDetail
                    cloudId={currentCloudId || ''}
                    vpcName={selectedVpc}
                    vpcs={vpcs}
                    subnets={subnets}
                    ecs={ecs}
                    loading={loading}
                    isHarvester={!!caps?.isHarvester}
                    onRefresh={() => loadEcs(currentCloudId, true)}
                />
            ) : (
                // 场景 B: 选中了资源池，显示 Tab 视图 (云主机、虚拟卷、镜像等)
                <Tabs
                  type="card"
                  activeKey={activeTab}
                  onChange={(k: any) => setActiveTab(k)}
                  items={tabItems}
                />
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
};

export default CloudConsolePage;
