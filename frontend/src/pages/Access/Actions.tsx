import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tree,
  Tag,
  Typography,
  message,
  Divider,
  Empty,
  Spin,
  Badge,
} from 'antd';
import {
  ReloadOutlined,
  CopyOutlined,
  CloseOutlined,
  FileTextOutlined,
  HomeOutlined,
  FolderOutlined,
  FunctionOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { routeSpecs } from '../../routes/RouteSpec';
import PageContainer from '../../components/PageContainer';
import { PLATFORMS, PLATFORM_LABELS, GROUPS } from '../../constants/navigation';
import { platformOf, groupOf, featureLabelOf } from '../../constants/permissionCatalog';
import { useTableColumnSettings } from '../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../components/TableColumnSettingsButton';
import { apiRequest } from '../../services/api';
import { usePermissionDefinitions } from '../../hooks/usePermissionDefinitions';

const { Text, Title } = Typography;

// ==================== 类型定义 ====================
interface ApiEndpoint {
  method: string;
  path: string;
  file: string;
}

interface PermissionAction {
  id: string;
  action: string;
  group: string;
  feature: string;
  platform: string;
  description: string;
  status: 'bound' | 'draft';
  apiCount: number;
  apis: ApiEndpoint[];
}

type StatusFilter = 'all' | 'bound' | 'draft';

// ==================== 工具函数 ====================
// 注意：这些函数现在使用后端权限定义数据
// 如果后端数据不可用，会回退到推断逻辑
const getGroup = (action: string, definitions?: any[]): string => {
  return groupOf(action.split(':')[0], definitions);
};

const getPlatform = (action: string, definitions?: any[]): string => {
  return platformOf(action.split(':')[0], definitions);
};

const getFeature = (action: string, definitions?: any[]): string => {
  const resource = action.split(':')[0];
  return featureLabelOf(resource, definitions) || resource;
};

const getVerbLabel = (action: string): string => {
  const [, op] = String(action).split(':');
  if (op === 'read') return '查看';
  if (op === 'write') return '管理';
  return op || '';
};

const describeAction = (action: string): string => {
  const [, op] = action.split(':');
  const feature = getFeature(action);
  if (op === 'read') return `查看${feature}列表与详情`;
  if (op === 'write') return `创建、修改、删除${feature}`;
  return `${feature}操作`;
};

const getMethodColor = (method: string): string => {
  const m = method.toUpperCase();
  if (m === 'GET') return 'blue';
  if (m === 'POST') return 'green';
  if (m === 'PUT' || m === 'PATCH') return 'orange';
  if (m === 'DELETE') return 'red';
  return 'default';
};

// ==================== 主组件 ====================
const AccessActionsPage: React.FC = () => {
  // ==================== 权限定义数据 ====================
  const { definitions: permissionDefinitions, loading: definitionsLoading } = usePermissionDefinitions();
  
  // ==================== 状态管理 ====================
  const [permissions, setPermissions] = useState<PermissionAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [featureFilter, setFeatureFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedPermission, setSelectedPermission] = useState<PermissionAction | null>(null);
  const [detailDrawerVisible, setDetailDrawerVisible] = useState(false);
  const [selectedTreeKeys, setSelectedTreeKeys] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [permTreeKeyword, setPermTreeKeyword] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'permissions' | 'apis'>('permissions');

  // API 盘点数据
  interface ApiInventoryItem {
    method: string;
    path: string;
    file: string;
    category: string;
    subCategory: string;
  }
  const [apiInventory, setApiInventory] = useState<ApiInventoryItem[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiSelectedTreeKey, setApiSelectedTreeKey] = useState<string | null>(null);
  const [apiExpandedTreeKeys, setApiExpandedTreeKeys] = useState<string[]>([]);
  
  const [filterForm] = Form.useForm();

  // ==================== 数据加载 ====================
  const loadPermissions = useCallback(async () => {
    setLoading(true);
    try {
      // 1. 从 RouteSpec 中提取路由关联的权限信息（用于补充显示信息）
      const routeBasedActions = new Map<string, {
        action: string;
        group: string;
        feature: string;
        platform: string;
      }>();
      
      routeSpecs.forEach(spec => {
        // 跳过废弃的路由，但保留 hidden 路由（它们可能也有权限信息）
        if (spec.deprecated) return;
        const actions = spec.requiredActions || {};
        const addAction = (action?: string) => {
          if (!action) return;
          // 如果该权限已经有路由信息
          if (routeBasedActions.has(action)) {
            // 如果当前路由是 hidden，且已有非 hidden 路由的信息，则不覆盖（优先使用非 hidden 路由的信息）
            // 但权限已经被扫描到了，所以直接返回
            if (spec.hidden) {
              return;
            }
            // 如果当前路由不是 hidden，则覆盖（优先使用非 hidden 路由的信息）
          }
          // 设置或更新权限的路由信息
          routeBasedActions.set(action, {
            action,
            group: spec.group || getGroup(action, permissionDefinitions),
            feature: spec.title || getFeature(action, permissionDefinitions),
            platform: spec.platform || getPlatform(action, permissionDefinitions),
          });
        };
        // 提取所有权限（read、write、page），即使路由是 hidden 的
        addAction(actions.read);
        addAction(actions.write);
        addAction(actions.page);
      });

      // 2. 以后端权限定义为数据源（包含所有平台的所有权限）
      // 3. 合并 RouteSpec 中的路由信息，优先使用路由配置的显示信息
      const permissionList: PermissionAction[] = permissionDefinitions.map((def, index) => {
        const routeInfo = routeBasedActions.get(def.id);
        const prefix = def.id.split(':')[0];
        
        // 优先使用 RouteSpec 中的信息，如果没有则使用后端定义的信息
        const group = routeInfo?.group || def.group || getGroup(def.id, permissionDefinitions);
        const feature = routeInfo?.feature || def.name || featureLabelOf(prefix, permissionDefinitions) || prefix;
        const platform = routeInfo?.platform || def.platform || getPlatform(def.id, permissionDefinitions);
        const description = def.description || describeAction(def.id);

        return {
          id: `perm-${index}-${def.id}`,
          action: def.id,
          group,
          feature,
          platform,
          description,
          status: 'bound', // 所有后端定义的权限都视为已绑定
          apiCount: 0, // 不再显示 API 关联
          apis: [],
        };
      });

      setPermissions(permissionList);
    } catch (error) {
      console.error('加载权限数据失败:', error);
      message.error('加载权限数据失败');
    } finally {
      setLoading(false);
    }
  }, [permissionDefinitions]);

  useEffect(() => {
    // 等待权限定义加载完成后再加载权限列表
    if (!definitionsLoading) {
    loadPermissions();
    }
  }, [loadPermissions, definitionsLoading]);

  // ==================== 筛选逻辑 ====================
  const filteredPermissions = useMemo(() => {
    const keyword = searchKeyword.toLowerCase().trim();
    
    return permissions.filter(perm => {
      // 平台筛选
      if (platformFilter !== 'all' && perm.platform !== platformFilter) {
        return false;
      }
      
      // 分组筛选
      if (groupFilter !== 'all' && perm.group !== groupFilter) {
        return false;
      }
      
      // 功能筛选
      if (featureFilter && perm.feature !== featureFilter) {
        return false;
      }
      
      // 状态筛选
      if (statusFilter !== 'all') {
        if (statusFilter === 'bound' && perm.status !== 'bound') return false;
        if (statusFilter === 'draft' && perm.status !== 'draft') return false;
      }
      
      // 关键字搜索
      if (keyword) {
        const matchAction = perm.action.toLowerCase().includes(keyword);
        const matchFeature = perm.feature.toLowerCase().includes(keyword);
        const matchDesc = perm.description.toLowerCase().includes(keyword);
        const matchGroup = perm.group.toLowerCase().includes(keyword);
        if (!matchAction && !matchFeature && !matchDesc && !matchGroup) {
          return false;
        }
      }
      
      return true;
    });
  }, [permissions, searchKeyword, platformFilter, groupFilter, featureFilter, statusFilter]);

  // ==================== 平台 / 分组树形数据 ====================
  const treeData = useMemo(() => {
    // 结构：platform -> group[]
    const structure: Record<string, Set<string>> = {};

    permissions.forEach((perm) => {
      const p = perm.platform || '未归类平台';
      const g = perm.group || '未归类分组';
      if (!structure[p]) {
        structure[p] = new Set<string>();
      }
      structure[p].add(g);
    });

    // 平台排序：优先使用 PLATFORMS 的顺序，其次字典序
    const platformKeys = Object.keys(structure).sort((a, b) => {
      const ia = PLATFORMS.indexOf(a as any);
      const ib = PLATFORMS.indexOf(b as any);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const nodes = platformKeys.map((platform) => {
      const groups = Array.from(structure[platform]).sort((ga, gb) => {
        const iga = GROUPS.indexOf(ga as any);
        const igb = GROUPS.indexOf(gb as any);
        if (iga === -1 && igb === -1) return ga.localeCompare(gb);
        if (iga === -1) return 1;
        if (igb === -1) return -1;
        return iga - igb;
      });

      return {
        title: PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] || platform,
        key: `platform:${platform}`,
        icon: <HomeOutlined />,
        children: groups.map((group) => ({
          title: group,
          key: `group:${platform}:${group}`,
          icon: <FolderOutlined />,
          isLeaf: true,
        })),
      };
    });

    return nodes;
  }, [permissions]);

  // 权限树搜索过滤
  const filteredTreeData = useMemo(() => {
    const kw = permTreeKeyword.trim().toLowerCase();
    if (!kw) return treeData;

    return (treeData || [])
      .map((node: any) => {
        const matchParent = String(node.title || '').toLowerCase().includes(kw);
        const children = node.children || [];
        const filteredChildren = children.filter((c: any) =>
          String(c.title || '').toLowerCase().includes(kw),
        );
        if (matchParent || filteredChildren.length > 0) {
          return {
            ...node,
            children: filteredChildren,
          };
        }
        return null;
      })
      .filter(Boolean) as any[];
  }, [treeData, permTreeKeyword]);

  // 默认展开所有平台节点
  useEffect(() => {
    const keys = (treeData || []).map((n: any) => String(n.key));
    setExpandedKeys(keys);
  }, [treeData]);

  // ==================== 事件处理 ====================

  const handleTreeSelect = useCallback(
    (keys: React.Key[]) => {
      if (!keys.length) return;
      const key = String(keys[0]);
      setSelectedTreeKeys([key]);

      if (key.startsWith('platform:')) {
        const platform = key.replace('platform:', '');
        setPlatformFilter(platform);
        setGroupFilter('all');
        setFeatureFilter(undefined);
        filterForm.setFieldsValue({
          platform,
          group: 'all',
        });
      } else if (key.startsWith('group:')) {
        const [, platform, group] = key.split(':');
        setPlatformFilter(platform);
        setGroupFilter(group);
        setFeatureFilter(undefined);
        filterForm.setFieldsValue({
          platform,
          group,
        });
      }
    },
    [filterForm],
  );

  const handleViewDetail = useCallback((perm: PermissionAction) => {
    setSelectedPermission(perm);
    setDetailDrawerVisible(true);
  }, []);

  const handleCopyAction = useCallback((action: string) => {
    navigator.clipboard.writeText(action).then(() => {
      message.success('已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败');
    });
  }, []);

  const handleResetFilters = useCallback(() => {
    setSearchKeyword('');
    setPlatformFilter('all');
    setGroupFilter('all');
    setFeatureFilter(undefined);
    setStatusFilter('all');
    setSelectedTreeKeys([]);
    filterForm.resetFields();
    filterForm.setFieldsValue({ 
      keyword: '',
      platform: 'all',
      group: 'all',
      status: 'all'
    });
  }, [filterForm]);

  // ==================== 渲染函数 ====================

  // 表格列定义
  const tableColumns = useMemo(() => [
    { 
      title: '功能', 
      dataIndex: 'feature', 
      key: 'feature', 
      width: 180 
    },
    { 
      title: '操作', 
      key: 'verb', 
      width: 120,
      render: (_: any, record: PermissionAction) => (
        <Text>{getVerbLabel(record.action)}</Text>
      ),
    },
    { 
      title: '权限 ID', 
      dataIndex: 'action', 
      key: 'action', 
      width: 260,
      render: (text: string) => <Text code>{text}</Text>
    },
    { 
      title: '分组', 
      dataIndex: 'group', 
      key: 'group', 
      width: 140 
    },
    { 
      title: '描述', 
      dataIndex: 'description', 
      key: 'description', 
      ellipsis: true 
    },
    { 
      title: '状态', 
      key: 'status', 
      width: 100, 
      render: (_: any, record: PermissionAction) => (
        <Tag color={record.status === 'bound' ? 'success' : 'warning'}>
          {record.status === 'bound' ? '已绑定' : '策划'}
        </Tag>
      )
    },
    { 
      title: 'API 数量', 
      dataIndex: 'apiCount', 
      key: 'apiCount', 
      width: 110,
      render: (count: number) => count > 0 ? <Badge count={count} /> : '-'
    },
  ], []);

  const { displayColumns } = useTableColumnSettings(tableColumns, 'access_actions_table');

  // 状态选项（使用 useMemo 确保稳定性）
  const statusOptions = useMemo(() => [
    { value: 'all', label: '全部' },
    { value: 'bound', label: '已绑定' },
    { value: 'draft', label: '策划' }
  ], []);


  // API 分类规则：
  // 1) category：平台维度（云资源 / 租户与用户 / 系统 / SDN / 审计 / 工具 / 仪表盘 / 威胁与告警 / 其他）
  // 2) subCategory：平台内按供应商或控制面划分（阿里云 / 华为云 / Harvester / CSMCTL / CSM 等，或“通用”）
  const getApiCategoryInfo = (path: string, file: string): { category: string; subCategory: string } => {
    const f = String(file || '');
    // 云资源平台
    if (path.startsWith('/api/clouds')) {
      const category = '云资源';
      // 根据定义文件路径推断云厂商
      if (f.includes('clouds/aliyun')) return { category, subCategory: '阿里云' };
      if (f.includes('clouds/huaweicloud')) return { category, subCategory: '华为云' };
      if (f.includes('clouds/tencentcloud')) return { category, subCategory: '腾讯云' };
      if (f.includes('clouds/harvester')) return { category, subCategory: 'Harvester' };
      if (f.includes('clouds/csm')) return { category, subCategory: 'CSM' };
      return { category, subCategory: '通用' };
    }

    // 租户 / 用户平台
    if (path.startsWith('/api/tenants') || path.startsWith('/api/users'))
      return { category: '租户与用户', subCategory: '通用' };

    // 系统平台（按功能子域细分）
    if (path.startsWith('/api/system')) {
      const category = '系统';
      if (path.startsWith('/api/system/rbac')) return { category, subCategory: 'RBAC / 权限' };
      if (path.startsWith('/api/system/license')) return { category, subCategory: 'License / 授权' };
      if (path.startsWith('/api/system/settings')) return { category, subCategory: '设置' };
      return { category, subCategory: '通用' };
    }

    // VR / SDN 平台（按供应商 / 控制面划分）
    // VR 配置控制面
    if (path.startsWith('/api/vr-config')) {
      return { category: 'SDN', subCategory: 'CSMCTL配置' };
    }

    // 其余 SDN
    if (path.startsWith('/api/networks') || path.startsWith('/api/security')) {
      // CSMCTL 跨域互联（CEN 等）
      if (f.includes('sdn/cens')) {
        return { category: 'SDN', subCategory: 'CSMCTL / 跨域互联' };
      }

      // CSM 流量编排
      if (f.includes('sdn/trafficOrchestration')) {
        return { category: 'SDN', subCategory: 'CSM 流量编排' };
      }

      return { category: 'SDN', subCategory: '通用' };
    }

    if (path.startsWith('/api/dashboard')) return { category: '系统', subCategory: '仪表盘' };
    if (path.startsWith('/api/tools')) {
      // license 工具已经在 /api/system/license，下方 tools 多为下载/辅助
      return { category: '系统', subCategory: '工具 / 下载' };
    }
    if (path.startsWith('/api/audit') || path.startsWith('/api/audit-logs'))
      return { category: '系统', subCategory: '审计' };
    if (path.startsWith('/api/sase')) return { category: 'SDN', subCategory: '通用' };
    if (path.startsWith('/api/threats')) return { category: '威胁与告警', subCategory: '通用' };

    return { category: '其他', subCategory: '通用' };
  };

  // API 模块树（category -> subCategory）
  const [apiTreeKeyword, setApiTreeKeyword] = useState<string>('');

  const apiModuleTreeData = useMemo(() => {
    const tree: any[] = [];
    const map = new Map<string, Set<string>>();
    apiInventory.forEach((i) => {
      if (!map.has(i.category)) map.set(i.category, new Set<string>());
      map.get(i.category)!.add(i.subCategory);
    });
    map.forEach((subs, cat) => {
      const children = Array.from(subs).map((s) => ({
        key: `cat:${cat}|sub:${s}`,
        title: s,
        icon: <FolderOutlined />,
        isLeaf: true,
      }));

      tree.push({
        key: `cat:${cat}`,
        title: cat,
        icon: <HomeOutlined />,
        children,
      });
    });

    // 关键字过滤树节点（仅按标题匹配）
    const kw = apiTreeKeyword.trim().toLowerCase();
    if (!kw) return tree;

    return tree
      .map((node) => {
        const matchParent = String(node.title).toLowerCase().includes(kw);
        const filteredChildren = (node.children || []).filter((c: any) =>
          String(c.title).toLowerCase().includes(kw),
        );
        if (matchParent || filteredChildren.length > 0) {
          return {
            ...node,
            children: filteredChildren,
          };
        }
        return null;
      })
      .filter(Boolean) as any[];
  }, [apiInventory, apiTreeKeyword]);

  const [apiCategoryKey, setApiCategoryKey] = useState<string>('all');
  const [apiKeyword, setApiKeyword] = useState<string>('');

  const filteredApiInventory = useMemo(() => {
    let list = apiInventory;
    // 平台 / 供应商 过滤
    if (apiCategoryKey !== 'all') {
      if (apiCategoryKey.startsWith('cat:') && !apiCategoryKey.includes('|sub:')) {
        const cat = apiCategoryKey.replace('cat:', '');
        list = list.filter((i) => i.category === cat);
      } else if (apiCategoryKey.includes('|sub:')) {
        const [, rest] = apiCategoryKey.split('cat:');
        const [cat, sub] = rest.split('|sub:');
        list = list.filter((i) => i.category === cat && i.subCategory === sub);
      }
    }
    // 关键字过滤（路径 / 文件）
    const kw = apiKeyword.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (i) =>
          i.path.toLowerCase().includes(kw) ||
          i.file.toLowerCase().includes(kw),
      );
    }
    return list;
  }, [apiInventory, apiCategoryKey, apiKeyword]);

  // 加载 API 盘点数据
  const loadApiInventory = useCallback(async () => {
    setApiLoading(true);
    try {
      const resp = await apiRequest('/api/system/rbac/api-inventory');
      const list = Array.isArray(resp?.apis) ? resp.apis : resp?.apis?.apis || [];
      const mapped: ApiInventoryItem[] = list.map((item: any) => {
        const info = getApiCategoryInfo(String(item.path || ''), String(item.file || ''));
        return {
          method: item.method,
          path: item.path,
          file: item.file,
          category: info.category,
          subCategory: info.subCategory,
        };
      });
      setApiInventory(mapped);
      setApiCategoryKey('all');
      // 默认展开所有模块节点
      const allKeys = Array.from(
        new Set(
          mapped.map((i) => `cat:${i.category}`),
        ),
      );
      setApiExpandedTreeKeys(allKeys);
    } catch (e) {
      console.error('加载 API 列表失败:', e);
      message.error('加载 API 列表失败');
    } finally {
      setApiLoading(false);
    }
  }, []);

  const renderPermissionsView = () => (
    <Card bordered={false} bodyStyle={{ padding: 0 }}>
      <div style={{ display: 'flex', gap: 16 }}>
        {/* 左侧：平台 / 分组快速导航树 */}
        <div
          style={{
            width: 260,
            minWidth: 220,
            flex: '0 0 220px',
            borderRight: '1px solid #f0f0f0',
            paddingRight: 16,
          }}
        >
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Input
              allowClear
              placeholder="搜索平台 / 分组"
              className="toolbar-search"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={permTreeKeyword}
              onChange={(e) => setPermTreeKeyword(e.target.value)}
            />
            <Tree
              showIcon
              treeData={filteredTreeData as any}
              selectedKeys={selectedTreeKeys}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys as string[])}
              onSelect={handleTreeSelect}
              style={{ background: 'transparent' }}
            />
          </Space>
        </div>

        {/* 右侧：过滤条 + 表格 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 工具栏 */}
          <div className="page-toolbar">
            <Form
              layout="vertical"
              className="toolbar-container"
              form={filterForm}
              initialValues={{
                keyword: '',
                status: 'all',
              }}
              onValuesChange={(_, allValues) => {
                setSearchKeyword(allValues.keyword || '');
                setStatusFilter((allValues.status || 'all') as StatusFilter);
              }}
            >
              <Form.Item name="keyword">
                <Input
                  allowClear
                  placeholder="搜索权限 ID / 功能模块 / 描述"
                  className="toolbar-search"
                  suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                />
              </Form.Item>
              <Form.Item name="status">
                <Select
                  className="toolbar-filter-sm"
                  placeholder="全部状态"
                  options={statusOptions}
                  allowClear={false}
                />
              </Form.Item>
              <Button type="link" className="toolbar-reset-btn" onClick={() => {
                handleResetFilters();
              }}>
                重置
              </Button>
            </Form>
            <Space className="toolbar-actions">
              <TableColumnSettingsButton allColumns={tableColumns} settingsKey="access_actions_table" />
              <Button icon={<ReloadOutlined />} onClick={loadPermissions} loading={loading} />
            </Space>
          </div>

          {/* 内容展示区 */}
          {loading && filteredPermissions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <Spin size="large" />
              <div style={{ marginTop: 16 }}>
                <Text type="secondary">加载中...</Text>
              </div>
            </div>
          ) : filteredPermissions.length === 0 ? (
            <Empty
              description="暂无符合条件的权限原子，请调整筛选条件后重试"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <Table
              className="std-table"
              rowKey="id"
              loading={loading}
              dataSource={filteredPermissions}
              columns={displayColumns as any}
              pagination={{
                size: 'small',
                showTotal: (total) => `共 ${total} 条`,
              }}
              scroll={{ x: 'max-content' }}
              bordered={false}
              onRow={(record) => ({
                onClick: () => handleViewDetail(record),
                style: { cursor: 'pointer' },
              })}
            />
          )}
        </div>
      </div>
    </Card>
  );

  const renderApiView = () => (
    <div style={{ display: 'flex', gap: 16 }}>
      {/* 左侧：API 模块树 */}
      <div
        style={{
          width: 260,
          minWidth: 220,
          flex: '0 0 220px',
          borderRight: '1px solid #f0f0f0',
          paddingRight: 16,
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Input
            allowClear
            placeholder="搜索模块 / 供应商"
            className="toolbar-search"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={apiTreeKeyword}
            onChange={(e) => setApiTreeKeyword(e.target.value)}
          />
          <Tree
            showIcon
            treeData={apiModuleTreeData as any}
            selectedKeys={apiSelectedTreeKey ? [apiSelectedTreeKey] : []}
            expandedKeys={apiExpandedTreeKeys}
            onExpand={(keys) => setApiExpandedTreeKeys(keys as string[])}
            onSelect={(keys) => {
              const key = String(keys[0] || '');
              setApiSelectedTreeKey(key || null);
              setApiCategoryKey(key || 'all');
            }}
            style={{ background: 'transparent' }}
          />
        </Space>
      </div>

      {/* 右侧：工具栏 + API 表格 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="page-toolbar">
          {/* 左侧：搜索 */}
          <Form
            layout="vertical"
            className="toolbar-container"
            style={{ display: 'flex', alignItems: 'flex-end', rowGap: 12, columnGap: 12 }}
            onValuesChange={(_, all) => {
              setApiKeyword(all.keyword || '');
            }}
          >
            <Form.Item name="keyword">
              <Input
                allowClear
                placeholder="搜索路径 / 定义文件"
                className="toolbar-search"
                suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              />
            </Form.Item>
            <Button type="link" className="toolbar-reset-btn" onClick={() => {
              filterForm.resetFields();
              setApiKeyword('');
            }}>
              重置
            </Button>
          </Form>
          {/* 右侧：操作 */}
          <div className="toolbar-actions">
            <Button
              icon={<ReloadOutlined />}
              loading={apiLoading}
              onClick={loadApiInventory}
            />
          </div>
        </div>

        <Table
          className="std-table"
          rowKey={(r: any, idx) => `${r.method}-${r.path}-${idx}`}
          loading={apiLoading}
          dataSource={filteredApiInventory}
          columns={[
            {
              title: '模块',
              dataIndex: 'category',
              width: 160,
            },
            {
              title: '供应商 / 控制面',
              dataIndex: 'subCategory',
              width: 160,
            },
            {
              title: '方法',
              dataIndex: 'method',
              width: 100,
              render: (m: string) => (
                <Tag color={getMethodColor(m)}>{m}</Tag>
              ),
            },
            {
              title: '路径',
              dataIndex: 'path',
              render: (p: string) => <Text code>{p}</Text>,
            },
            {
              title: '定义文件',
              dataIndex: 'file',
            },
          ]}
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
          scroll={{ x: 'max-content' }}
        />
      </div>
    </div>
  );

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      tabList={[
        { key: 'permissions', tab: '权限列表' },
        { key: 'apis', tab: 'API 列表' },
      ]}
      tabActiveKey={activeTab}
      onTabChange={(key) => {
        const next = (key as 'permissions' | 'apis') || 'permissions';
        setActiveTab(next);
        if (next === 'apis' && apiInventory.length === 0 && !apiLoading) {
          loadApiInventory();
        }
      }}
    >
      {activeTab === 'permissions' ? renderPermissionsView() : renderApiView()}
      {/* 详情抽屉 */}
      <Drawer
        title="权限详情"
        placement="right"
        width={600}
        open={detailDrawerVisible}
        onClose={() => setDetailDrawerVisible(false)}
        extra={
          <Space>
            {selectedPermission && (
              <Button 
                icon={<CopyOutlined />} 
                onClick={() => handleCopyAction(selectedPermission.action)}
              >
                复制权限
              </Button>
            )}
            <Button icon={<CloseOutlined />} onClick={() => setDetailDrawerVisible(false)} />
          </Space>
        }
      >
        {selectedPermission && (
          <div>
            <Title level={4} style={{ marginBottom: 8 }}>{selectedPermission.action}</Title>
            <Text type="secondary" style={{ fontSize: 14, display: 'block', marginBottom: 16 }}>
              {selectedPermission.description}
            </Text>

            <Divider />

            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>状态</Text>
              <Tag color={selectedPermission.status === 'bound' ? 'success' : 'warning'} style={{ fontSize: 13 }}>
                {selectedPermission.status === 'bound' ? '已生效（已绑定 API）' : '待接入（未绑定 API）'}
              </Tag>
              {selectedPermission.status === 'bound' && (
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  已关联到后端API
                </Text>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>元信息</Text>
              <Space direction="vertical" size={4}>
                <div>
                  <FolderOutlined style={{ marginRight: 8, color: '#722ed1' }} />
                  <Text>分组：</Text>
                  <Tag color="purple">{selectedPermission.group}</Tag>
                </div>
                <div>
                  <FunctionOutlined style={{ marginRight: 8, color: '#1890ff' }} />
                  <Text>功能：</Text>
                  <Tag color="blue">{selectedPermission.feature}</Tag>
                </div>
                <div>
                  <Text>平台：</Text>
                  <Tag color="cyan" style={{ marginLeft: 8 }}>{selectedPermission.platform}</Tag>
                </div>
              </Space>
            </div>

            {selectedPermission.apis.length > 0 && (
              <>
                <Divider />
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 12 }}>
                    关联的API端点 ({selectedPermission.apis.length})
                  </Text>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {selectedPermission.apis.map((api, idx) => (
                      <Card key={idx} size="small" style={{ background: '#fafafa' }}>
                        <div style={{ marginBottom: 8 }}>
                          <Tag color={getMethodColor(api.method)} style={{ fontWeight: 600 }}>
                            {api.method}
                          </Tag>
                          <Text code style={{ marginLeft: 8 }}>{api.path}</Text>
                        </div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          <FileTextOutlined /> {api.file}
                        </Text>
                      </Card>
                    ))}
                  </Space>
                </div>
              </>
            )}
          </div>
        )}
      </Drawer>
    </PageContainer>
  );
};

export default AccessActionsPage;
