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
  Tag, 
  Tree, 
  Typography, 
  Tooltip, 
  message, 
  Divider, 
  Badge,
  Empty,
  Spin
} from 'antd';
import { 
  ReloadOutlined, 
  CopyOutlined, 
  CloseOutlined,
  FileTextOutlined,
  GlobalOutlined,
  FolderOutlined,
  FunctionOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { routeSpecs } from '../../routes/RouteSpec';
import PageContainer from '../../components/PageContainer';
import { PLATFORMS, PLATFORM_LABELS } from '../../constants/navigation';
import { platformOf, groupOf, featureLabelOf } from '../../constants/permissionCatalog';
import { useTableColumnSettings } from '../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../components/TableColumnSettingsButton';
import { apiRequest } from '../../services/api';

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
const getGroup = (action: string): string => {
  return groupOf(action.split(':')[0]);
};

const getPlatform = (action: string): string => {
  return platformOf(action.split(':')[0]);
};

const getFeature = (action: string): string => {
  const resource = action.split(':')[0];
  return featureLabelOf(resource) || resource;
};

const describeAction = (action: string): string => {
  const [resource, op] = action.split(':');
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
  
  // 树形导航状态
  const [selectedTreeKeys, setSelectedTreeKeys] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  
  const [filterForm] = Form.useForm();

  // ==================== 数据加载 ====================
  const loadPermissions = useCallback(async () => {
    setLoading(true);
    try {
      // 1. 从路由配置中获取基础权限列表
      const routeBasedActions = new Map<string, {
        action: string;
        group: string;
        feature: string;
        platform: string;
      }>();
      
      routeSpecs.forEach(spec => {
        const actions = spec.requiredActions || {};
        const addAction = (action?: string) => {
          if (!action) return;
          if (routeBasedActions.has(action)) return;
          routeBasedActions.set(action, {
            action,
            group: spec.group || getGroup(action),
            feature: spec.title || getFeature(action),
            platform: spec.platform || getPlatform(action),
          });
        };
        addAction(actions.read);
        addAction(actions.write);
        addAction(actions.page);
      });

      // 2. 从后端API获取扫描的权限和API详情
      const apiResponse = await apiRequest('/api/system/rbac/actions');
      const scannedActions: string[] = Array.isArray(apiResponse?.scanned) ? apiResponse.scanned : [];
      const apiDetails: Record<string, ApiEndpoint[]> = apiResponse?.details || {};

      // 3. 合并数据，构建完整的权限列表
      const allActions = new Set<string>();
      routeBasedActions.forEach((_, action) => allActions.add(action));
      scannedActions.forEach(action => allActions.add(action));

      const permissionList: PermissionAction[] = Array.from(allActions).map((action, index) => {
        const routeInfo = routeBasedActions.get(action);
        const isBound = scannedActions.includes(action);
        const apis = apiDetails[action] || [];

        return {
          id: `perm-${index}-${action}`,
          action,
          group: routeInfo?.group || getGroup(action),
          feature: routeInfo?.feature || getFeature(action),
          platform: routeInfo?.platform || getPlatform(action),
          description: describeAction(action),
          status: isBound ? 'bound' : 'draft',
          apiCount: apis.length,
          apis,
        };
      });

      setPermissions(permissionList);
    } catch (error) {
      console.error('加载权限数据失败:', error);
      message.error('加载权限数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

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

  // ==================== 树形数据生成 ====================
  const treeData = useMemo(() => {
    const structure: Record<string, Record<string, PermissionAction[]>> = {};
    
    // 树形数据应该基于筛选后的权限列表生成
    // 但排除分组和功能筛选（因为树是用来选择分组和功能的）
    // 只应用平台、状态、关键字筛选
    const keyword = searchKeyword.toLowerCase().trim();
    const baseList = permissions.filter(p => {
      // 平台筛选
      if (platformFilter !== 'all' && p.platform !== platformFilter) {
        return false;
      }
      
      // 状态筛选
      if (statusFilter !== 'all') {
        if (statusFilter === 'bound' && p.status !== 'bound') return false;
        if (statusFilter === 'draft' && p.status !== 'draft') return false;
      }
      
      // 关键字搜索
      if (keyword) {
        const matchAction = p.action.toLowerCase().includes(keyword);
        const matchFeature = p.feature.toLowerCase().includes(keyword);
        const matchDesc = p.description.toLowerCase().includes(keyword);
        const matchGroup = p.group.toLowerCase().includes(keyword);
        if (!matchAction && !matchFeature && !matchDesc && !matchGroup) {
          return false;
        }
      }
      
      return true;
    });
    
    // 构建分组 -> 功能 -> 权限的层级结构
    baseList.forEach(perm => {
      if (!structure[perm.group]) {
        structure[perm.group] = {};
      }
      if (!structure[perm.group][perm.feature]) {
        structure[perm.group][perm.feature] = [];
      }
      structure[perm.group][perm.feature].push(perm);
    });

    // 生成树节点
    const groupNodes = Object.entries(structure).map(([groupName, features]) => {
      const featureNodes = Object.entries(features).map(([featureName, perms]) => ({
        title: featureName,
        key: `feature:${groupName}:${featureName}`,
        icon: <FunctionOutlined />,
        children: perms.map(perm => ({
          title: perm.action,
          key: `action:${perm.action}`,
          isLeaf: true,
          icon: <FileTextOutlined style={{ fontSize: 12 }} />,
        })),
      }));

      return {
        title: groupName,
        key: `group:${groupName}`,
        icon: <FolderOutlined />,
        children: featureNodes,
      };
    });

    return groupNodes;
  }, [permissions, platformFilter, statusFilter, searchKeyword]);

  // 自动展开分组节点
  useEffect(() => {
    const keys = treeData
      .filter((n: any) => n.children && n.children.length > 0)
      .map((n: any) => String(n.key));
    setExpandedKeys(keys);
  }, [treeData]);

  // ==================== 事件处理 ====================
  const handleTreeSelect = useCallback((keys: React.Key[]) => {
    if (keys.length === 0) return;
    
    const key = String(keys[0]);
    setSelectedTreeKeys([key]);

    if (key.startsWith('group:')) {
      const group = key.replace('group:', '');
      setGroupFilter(group);
      setFeatureFilter(undefined);
      filterForm.setFieldsValue({ group });
    } else if (key.startsWith('feature:')) {
      const parts = key.replace('feature:', '').split(':');
      const group = parts[0];
      const feature = parts[1];
      setGroupFilter(group);
      setFeatureFilter(feature);
      filterForm.setFieldsValue({ group });
    } else if (key.startsWith('action:')) {
      const action = key.replace('action:', '');
      const perm = permissions.find(p => p.action === action);
      if (perm) {
        setGroupFilter(perm.group);
        setFeatureFilter(perm.feature);
        filterForm.setFieldsValue({ group: perm.group });
        handleViewDetail(perm);
      }
    }
  }, [permissions, filterForm]);

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
      title: '权限原子', 
      dataIndex: 'action', 
      key: 'action', 
      width: 250,
      render: (text: string) => <Text code>{text}</Text>
    },
    { 
      title: '功能', 
      dataIndex: 'feature', 
      key: 'feature', 
      width: 150 
    },
    { 
      title: '分组', 
      dataIndex: 'group', 
      key: 'group', 
      width: 120 
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
      title: 'API数量', 
      dataIndex: 'apiCount', 
      key: 'apiCount', 
      width: 100,
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

  // 平台选项（过滤掉 '全部'，因为我们已经手动添加了 '全部平台'）
  const platformOptions = useMemo(() => [
    { value: 'all', label: '全部平台' },
    ...PLATFORMS.filter((p: string) => p !== '全部').map((p: string) => ({ 
      value: p, 
      label: PLATFORM_LABELS[p as keyof typeof PLATFORM_LABELS] || p 
    }))
  ], []);

  // 分组选项
  const groupOptions = useMemo(() => {
    const groups = new Set(permissions.map(p => p.group));
    return [
      { value: 'all', label: '全部分组' },
      ...Array.from(groups).map(g => ({ value: g, label: g }))
    ];
  }, [permissions]);

  return (
    <PageContainer titleLevel={3} asCard={false}>
      <div style={{ display: 'flex', gap: 16 }}>
        {/* 左侧导航树 */}
        <div style={{ width: 280, minWidth: 280, flex: '0 0 280px', borderRight: '1px solid #f0f0f0', paddingRight: 16 }}>
          <Space direction="vertical" size={12} style={{ width: '100%', marginBottom: 16 }}>
            <Select 
              value={platformFilter} 
              onChange={(v) => {
                setPlatformFilter(v);
                filterForm.setFieldsValue({ platform: v });
              }}
              style={{ width: '100%' }} 
              options={platformOptions}
              placeholder="选择平台"
              size="large"
            />
          </Space>
          <Tree
            showIcon
            treeData={treeData as any}
            selectedKeys={selectedTreeKeys}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as string[])}
            onSelect={handleTreeSelect}
            style={{ background: 'transparent' }}
          />
        </div>

        {/* 中间主内容区 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 工具栏 */}
          <div className="page-toolbar">
            <Form
              layout="vertical"
              className="toolbar-container"
              form={filterForm}
              initialValues={{ 
                keyword: '',
                platform: 'all',
                group: 'all', 
                status: 'all' 
              }}
              onValuesChange={(_, allValues) => {
                setSearchKeyword(allValues.keyword || '');
                setPlatformFilter(allValues.platform || 'all');
                setGroupFilter(allValues.group || 'all');
                setStatusFilter((allValues.status || 'all') as StatusFilter);
              }}
            >
              <Form.Item name="keyword" label="搜索">
                <Input 
                  allowClear 
                  placeholder="搜索权限原子/功能/描述" 
                  className="toolbar-search"
                  prefix={<SearchOutlined />}
                />
              </Form.Item>
              <Form.Item name="group" label="分组">
                <Select
                  className="toolbar-filter"
                  placeholder="全部分组"
                  options={groupOptions}
                  allowClear={false}
                />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select 
                  className="toolbar-filter"
                  placeholder="全部状态"
                  options={statusOptions}
                  allowClear={false}
                />
              </Form.Item>
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
              description="暂无权限数据"
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
                style: { cursor: 'pointer' }
              })}
            />
          )}
        </div>
      </div>

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
                {selectedPermission.status === 'bound' ? '已绑定' : '策划'}
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
                  <GlobalOutlined style={{ marginRight: 8, color: '#13c2c2' }} />
                  <Text>平台：</Text>
                  <Tag color="cyan">{selectedPermission.platform}</Tag>
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
