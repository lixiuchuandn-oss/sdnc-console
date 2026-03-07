import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Select, Space, Table, Tag, Tree } from 'antd';
import { ApiOutlined, ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import { routeSpecs } from '../../routes/RouteSpec';
import PageContainer from '../../components/PageContainer';
import { PLATFORMS, PLATFORM_LABELS, GROUPS, platformOf, groupOf, featureLabelOf } from '../../catalogs/navCatalog';
import { useTableColumnSettings } from '../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../components/TableColumnSettingsButton';

type ApiItem = { method: string; path: string; file: string };
type ActionItem = { key: string; action: string; group: string; feature: string; platform: string; desc: string; bound: boolean; apis: ApiItem[] };

 

const mapGroupOf = (val: string): string => groupOf(val.split(':')[0]) || '';

const mapPlatformOf = (val: string): string => platformOf(val.split(':')[0]) || '';

const featureOf = (resource: string): string => featureLabelOf(resource);

const describeAction = (action: string): string => {
  const [resource, op] = String(action).split(':');
  const f = featureOf(resource || action);
  if (resource?.startsWith('tenants.leased-lines.list')) {
    if (op === 'read') return '查看专线列表与详情';
  }
  if (resource?.startsWith('tenants.leased-lines.manage')) {
    if (op === 'write') return '创建、修改、删除租户专线记录';
  }
  if (resource?.startsWith('tenants.leased-lines.reports')) {
    if (op === 'read') return '查看任务进度、下载安全报告';
    if (op === 'write') return '创建、取消、删除安全报告任务';
  }
  if (resource?.startsWith('tenants.leased-lines.alert-logs')) {
    if (op === 'read') return '查看告警日志文件和分析输入';
  }
  if (op === 'read') return `查看${f}列表与详情`;
  if (op === 'write') return `创建、修改、删除${f}`;
  return `${f}操作`;
};

const groups = GROUPS;
const platforms = PLATFORMS;

const AccessActionsPage: React.FC = () => {
  const [list, setList] = useState<ActionItem[]>([]);
  const [kw, setKw] = useState('');
  const [activeGroup, setActiveGroup] = useState<string>('全部');
  const [activeFeature, setActiveFeature] = useState<string | undefined>(undefined);
  const [activeAction, setActiveAction] = useState<string | undefined>(undefined);
  const [activeStatus, setActiveStatus] = useState<string>('全部');
  const [activePlatform, setActivePlatform] = useState<string>('全部');
  const [selectedTreeKeys, setSelectedTreeKeys] = useState<string[]>(['grp:全部']);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [filterForm] = Form.useForm();

  // 定义列
  const columns = useMemo(() => [
    { title:'权限原子', dataIndex:'action', key: 'action' },
    { title:'功能', dataIndex:'feature', key: 'feature' },
    { title:'分组', dataIndex:'group', key: 'group' },
    { title:'描述', dataIndex:'desc', key: 'desc' },
    { title:'状态', key:'status', render: (_:any, r:any) => (<span className={`std-badge ${r.bound ? 'std-badge-success' : 'std-badge-warning'}`}>{r.bound ? '已绑定' : '策划'}</span>) },
  ], []);

  // 使用新的 hook 管理列设置
  const { displayColumns } = useTableColumnSettings(columns, 'access_actions_table');

  const load = async () => {
    const baseItems: ActionItem[] = [];
    routeSpecs.forEach(spec => {
      const ra = spec.requiredActions || {};
      const addedActions = new Set<string>(); // prevent duplicates within same spec
      const add = (val?: string) => {
        const a = typeof val === 'string' ? val : '';
        if (!a) return;
        if (addedActions.has(a)) return;
        addedActions.add(a);
        baseItems.push({
          key: `${a}::${spec.id}`,
          action: a,
          group: spec.group || mapGroupOf(a),
          feature: spec.title || featureOf(a.split(':')[0] || a),
          platform: spec.platform || mapPlatformOf(a),
          desc: describeAction(a),
          bound: false,
          apis: [],
        });
      };
      // Explicitly prioritize READ/WRITE first to avoid "Page Access" description if they are same
      add(ra.read);
      add(ra.write);
      add(ra.page);
    });

    try {
      const token = localStorage.getItem('token');
      const resp = await axios.get('/api/system/rbac/actions', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const scannedArr: string[] = Array.isArray(resp.data?.scanned) ? resp.data.scanned : [];
      const details: Record<string, ApiItem[]> = (resp.data?.details && typeof resp.data.details === 'object') ? resp.data.details : {};
      const itemsBase = baseItems.map(it => ({
        ...it,
        bound: scannedArr.includes(it.action),
        apis: details[it.action] || [],
      }));
      const existingActions = new Set(itemsBase.map(x => x.action));
      const extraItems: ActionItem[] = scannedArr
        .filter(a => !existingActions.has(a))
        .map(a => ({
          key: `${a}::scanned`,
          action: a,
          group: mapGroupOf(a),
          feature: featureOf(a.split(':')[0] || a),
          platform: mapPlatformOf(a),
          desc: describeAction(a),
          bound: true,
          apis: details[a] || [],
        }));
      const items = itemsBase.concat(extraItems);
      setList(items);
    } catch (e) {
      console.error(e);
      // In case of error, show base items
      setList(baseItems);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Filter logic
  const filteredList = useMemo(() => {
    const lower = kw.toLowerCase();
    return list.filter(item => {
      if (activePlatform !== '全部' && item.platform !== activePlatform) return false;
      if (activeGroup !== '全部' && item.group !== activeGroup) return false;
      if (activeFeature && item.feature !== activeFeature) return false;
      if (activeAction && item.action !== activeAction) return false;
      if (activeStatus !== '全部' && (activeStatus === '已绑定' ? !item.bound : item.bound)) return false;
      
      return item.action.toLowerCase().includes(lower) || 
             item.feature.toLowerCase().includes(lower) || 
             item.desc.toLowerCase().includes(lower);
    });
  }, [list, kw, activePlatform, activeGroup, activeFeature, activeAction, activeStatus]);

  // Tree data generation
  const treeData = useMemo(() => {
    // Group items by Group -> Feature -> Action
    const structure: Record<string, Record<string, ActionItem[]>> = {};
    
    // Filter base list by platform first
    const baseList = list.filter(item => activePlatform === '全部' || item.platform === activePlatform);
    
    baseList.forEach(item => {
      if (!structure[item.group]) structure[item.group] = {};
      if (!structure[item.group][item.feature]) structure[item.group][item.feature] = [];
      structure[item.group][item.feature].push(item);
    });

    const nodes = Object.entries(structure).map(([groupName, features]) => {
      const featureNodes = Object.entries(features).map(([featureName, items]) => {
        return {
          title: featureName,
          key: `feat:${featureName}`,
          // Leaf nodes (actions)
          children: items.map(action => ({
            title: action.action,
            key: `act:${action.action}`,
            isLeaf: true
          }))
        };
      });

      return {
        title: groupName,
        key: `grp:${groupName}`,
        children: featureNodes
      };
    });

    return [{ title: '全部', key: 'grp:全部' }, ...nodes];
  }, [list, activePlatform]);

  useEffect(() => {
    const keys = treeData
      .filter((n: any) => String(n.key).startsWith('grp:') && String(n.key) !== 'grp:全部')
      .map((n: any) => String(n.key));
    setExpandedKeys(keys);
  }, [treeData]);

  // Reset all filters when platform changes
  useEffect(() => {
    setActiveGroup('全部');
    setActiveFeature(undefined);
    setActiveAction(undefined);
    setSelectedTreeKeys(['grp:全部']);
    filterForm.setFieldsValue({ group: '全部' });
  }, [activePlatform]);

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
    >

      <div style={{ display: 'flex', gap: 0 }}>
        <div style={{ width: 260, minWidth: 260, flex: '0 0 260px', borderRight: '1px solid #f0f0f0', paddingRight: 12, overflowY: 'auto' }}>
          <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 8 }}>
            <Select value={activePlatform} onChange={(v)=> setActivePlatform(v)} style={{ width: '100%' }} options={platforms.map(p => ({ value: p, label: PLATFORM_LABELS[p] || p }))} placeholder="选择顶级目录" />
          </Space>
          <Tree
            treeData={treeData as any}
            selectedKeys={selectedTreeKeys}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as string[])}
            onSelect={(keys) => {
              const k = String((keys as any)[0] || 'grp:全部');
              setSelectedTreeKeys([k]);
              
              if (k.startsWith('grp:')) {
                const g = k.split(':')[1];
                setActiveGroup(g);
                setActiveFeature(undefined);
                setActiveAction(undefined);
                filterForm.setFieldsValue({ group: g });
              } else if (k.startsWith('feat:')) {
                // feat:featureName
                const f = k.split(':')[1];
                // Find group for this feature
                const group = list.find(i => i.feature === f && (activePlatform === '全部' || i.platform === activePlatform))?.group || '全部';
                setActiveGroup(group);
                setActiveFeature(f);
                setActiveAction(undefined);
                filterForm.setFieldsValue({ group: group });
              } else if (k.startsWith('act:')) {
                 // act:actionName
                 const a = k.split(':')[1];
                 const item = list.find(i => i.action === a && (activePlatform === '全部' || i.platform === activePlatform));
                 if (item) {
                   setActiveGroup(item.group);
                   setActiveFeature(item.feature);
                   setActiveAction(a);
                   filterForm.setFieldsValue({ group: item.group });
                 }
              }
            }}
            height={600}
            style={{ overflow: 'hidden' }}
          />
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {/* 筛选工具栏 */}
          <div className="page-toolbar">
            <Form
              layout="vertical"
              style={{ display:'flex', alignItems:'flex-end', rowGap:12, columnGap:12 }}
              form={filterForm}
              initialValues={{ group: '全部', status: '全部' }}
              onValuesChange={(_, all) => {
                setKw(all.keyword || '');
                if (all.group !== activeGroup) {
                  setActiveGroup(all.group || '全部');
                  setActiveFeature(undefined);
                  setActiveAction(undefined);
                  setSelectedTreeKeys([`grp:${all.group || '全部'}`]);
                }
                setActiveStatus(all.status || '全部');
              }}
            >
              <Form.Item name="keyword" label="关键字">
                <Input allowClear placeholder="搜索权限原子/功能/描述" className="toolbar-search" />
              </Form.Item>
              <Form.Item name="group" label="分组">
                <Select
                  className="toolbar-filter"
                  placeholder="全部"
                  options={[{ value: '全部', label: '全部' }].concat(groups.map(g => ({ value: g, label: g })))}
                />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select className="toolbar-filter" options={[{ value:'全部', label:'全部' }, { value:'已绑定', label:'已绑定' }, { value:'策划', label:'策划' }]} />
              </Form.Item>
              <a className="toolbar-reset-btn" onClick={() => {
                filterForm.resetFields();
                setKw('');
                setActiveGroup('全部');
                setActiveFeature(undefined);
                setActiveAction(undefined);
                setActiveStatus('全部');
                setSelectedTreeKeys(['grp:全部']);
              }}>重置</a>
            </Form>
            <Space className="toolbar-actions">
              <TableColumnSettingsButton allColumns={columns} settingsKey="access_actions_table" />
              <Button icon={<ReloadOutlined />} onClick={load} />
            </Space>
          </div>

          <Table
            className="std-table"
            rowKey="key"
            dataSource={filteredList}
            columns={displayColumns as any}
            pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10','20','50','100'], size: 'small', showQuickJumper: false }}
            scroll={{ x: 'max-content' }}
            bordered
          />
        </div>
      </div>
    </PageContainer>
  );
};

export default AccessActionsPage;
const apiTitle = (method: string, path: string): string => {
  const m = String(method || '').toUpperCase();
  const p = String(path || '').replace(/\/+$/, '');
  if (p.startsWith('/api/clouds')) {
    if (m === 'GET' && p === '/api/clouds') return '查询资源池列表';
    if (m === 'POST' && p === '/api/clouds') return '创建资源池';
    if (m === 'POST' && /\/api\/clouds\/[^/]+\/test$/.test(p)) return '连接体检';
    if (m === 'PUT' && /\/api\/clouds\/[^/]+$/.test(p)) return '更新资源池';
    if (m === 'DELETE' && /\/api\/clouds\/[^/]+$/.test(p)) return '删除资源池';
    if (m === 'GET' && /\/api\/clouds\/[^/]+\/stats$/.test(p)) return '查询资源池统计';
    if (m === 'GET' && /\/api\/clouds\/[^/]+\/quotas$/.test(p)) return '查询资源池配额';
  }
  if (p.startsWith('/api/leased-lines')) {
    if (m === 'GET' && (p === '/api/leased-lines' || p === '/api/leased-lines/')) return '查询专线列表';
    if (m === 'POST' && p === '/api/leased-lines') return '创建专线记录';
    if (m === 'POST' && p === '/api/leased-lines/batch') return '批量导入专线';
    if (m === 'PATCH' && /\/api\/leased-lines\/[^/]+$/.test(p)) return '更新专线记录';
    if (m === 'DELETE' && p === '/api/leased-lines/batch') return '批量删除专线';
    if (m === 'DELETE' && /\/api\/leased-lines\/[^/]+$/.test(p)) return '删除专线记录';
    if (m === 'POST' && /\/api\/leased-lines\/[^/]+\/security-report$/.test(p)) return '生成安全报告并下载';
    if (m === 'POST' && /\/api\/leased-lines\/[^^/]+\/security-report\/task$/.test(p)) return '创建安全报告任务';
    if (m === 'GET' && /\/api\/leased-lines\/security-report\/tasks\/[^/]+$/.test(p)) return '查询任务详情';
    if (m === 'GET' && p === '/api/leased-lines/security-report/tasks') return '查询任务列表';
    if (m === 'GET' && /\/api\/leased-lines\/security-report\/tasks\/[^/]+\/outputs$/.test(p)) return '查看任务输出';
    if (m === 'GET' && /\/api\/leased-lines\/security-report\/tasks\/[^/]+\/download$/.test(p)) return '下载任务报告';
    if (m === 'GET' && /\/api\/leased-lines\/security-report\/lines\/[^^/]+\/download$/.test(p)) return '按专线下载报告';
    if (m === 'GET' && /\/api\/leased-lines\/security-report\/tasks\/[^/]+\/stream$/.test(p)) return '订阅任务进度';
    if (m === 'DELETE' && /\/api\/leased-lines\/security-report\/tasks\/[^/]+$/.test(p)) return '取消安全报告任务';
    if (m === 'DELETE' && /\/api\/leased-lines\/security-report\/tasks\/[^^/]+\/remove$/.test(p)) return '永久删除任务';
    if (m === 'DELETE' && p === '/api/leased-lines/security-report/tasks/batch/remove') return '批量永久删除任务';
    if (m === 'GET' && /\/api\/leased-lines\/security-report\/folders\/[^/]+\/download$/.test(p)) return '下载临时报告文件夹';
  }
  if (m === 'GET') return '查询接口';
  if (m === 'POST') return '创建接口';
  if (m === 'PATCH' || m === 'PUT') return '更新接口';
  if (m === 'DELETE') return '删除接口';
  return '接口调用';
};

const apiUsage = (method: string, path: string): string => {
  const m = String(method || '').toUpperCase();
  const p = String(path || '').replace(/\/+$/, '');
  if (p.startsWith('/api/clouds')) {
    if (m === 'GET' && p === '/api/clouds') return '列出所有资源池';
    if (m === 'POST' && p === '/api/clouds') return '创建资源池记录';
    if (m === 'POST' && /\/api\/clouds\/[^/]+\/test$/.test(p)) return '测试云资源连接';
    if (m === 'PUT' && /\/api\/clouds\/[^/]+$/.test(p)) return '更新资源池配置与状态';
    if (m === 'DELETE' && /\/api\/clouds\/[^/]+$/.test(p)) return '删除资源池记录';
    if (m === 'GET' && /\/api\/clouds\/[^/]+\/stats$/.test(p)) return '查询资源池统计信息';
    if (m === 'GET' && /\/api\/clouds\/[^/]+\/quotas$/.test(p)) return '查询资源池配额汇总';
  }
  if (m === 'GET') return '读取资源或信息';
  if (m === 'POST') return '创建或触发动作';
  if (m === 'PATCH' || m === 'PUT') return '更新资源或配置';
  if (m === 'DELETE') return '删除资源或任务';
  return '接口用途';
};
