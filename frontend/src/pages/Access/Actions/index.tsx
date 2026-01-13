import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Select, Space, Table, Tag, Tree } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
 
import axios from 'axios';
import { routeSpecs } from '../../../routes/RouteSpec';
import PageContainer from '../../../components/PageContainer';
import { PLATFORMS, GROUPS, platformOf, groupOf, featureLabelOf } from '../../../catalogs/navCatalog';
import '../../common/filters.css';

type ApiItem = { method: string; path: string; file: string };
type ActionItem = { key: string; action: string; group: string; feature: string; platform: string; desc: string; bound: boolean; apis: ApiItem[] };

 

const mapGroupOf = (val: string): string => groupOf(val) || '';

const mapPlatformOf = (val: string): string => platformOf(val) || '';

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

  useEffect(() => {
    const load = async () => {
      const baseItems: ActionItem[] = [];
      routeSpecs.forEach(spec => {
        const ra = spec.requiredActions || {};
        const add = (val?: string) => {
          const a = typeof val === 'string' ? val : '';
          if (!a) return;
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
        add(ra.page);
        add(ra.read);
        add(ra.write);
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
      } catch {
        setList(baseItems);
      }
    };
    load();
  }, []);

  const rows = useMemo(() => {
    const lower = kw.toLowerCase();
    return list
      .filter(x => activePlatform === '全部' || x.platform === activePlatform)
      .filter(x => activeGroup === '全部' || x.group === activeGroup)
      .filter(x => !activeFeature || x.feature === activeFeature)
      .filter(x => !activeAction || x.action === activeAction)
      .filter(x => activeStatus === '全部' || (activeStatus === '已绑定' ? !!x.bound : !x.bound))
      .filter(x => x.action.toLowerCase().includes(lower))
      .map(x => ({ key: x.key, action: x.action, group: x.group, feature: x.feature, desc: x.desc, bound: x.bound }));
  }, [list, kw, activePlatform, activeGroup, activeFeature, activeAction, activeStatus]);

  const treeData = useMemo(() => {
    const gmap = new Map<string, Map<string, ActionItem[]>>();
    const base = list.filter(x => activePlatform === '全部' || x.platform === activePlatform);
    base.forEach(x => {
      const fmap = gmap.get(x.group) || new Map<string, ActionItem[]>();
      const arr = fmap.get(x.feature) || [];
      arr.push(x);
      fmap.set(x.feature, arr);
      gmap.set(x.group, fmap);
    });
    const groupsNodes = Array.from(gmap.entries()).map(([g, fm]) => ({
      key: `grp:${g}`,
      title: g,
      children: Array.from(fm.entries()).map(([feat, items]) => ({
        key: `feat:${g}::${feat}`,
        title: feat,
        children: items.map(it => ({ key: `act:${it.key}`, title: it.action }))
      }))
    }));
    return [{ key: 'grp:全部', title: '全部' } as any].concat(groupsNodes as any);
  }, [list, activePlatform]);

  useEffect(() => {
    const keys = treeData.filter((n: any) => String(n.key).startsWith('grp:') && String(n.key) !== 'grp:全部').map((n: any) => String(n.key));
    setExpandedKeys(keys);
  }, [treeData]);

  return (
    <PageContainer
      icon={<ApiOutlined style={{ fontSize:24, color:'#1890ff' }} />}
      title="权限原子"
      titleLevel={3}
      subtitle="列出后端提供的 API 级别功能点，供策略组合与角色授权使用。"
      asCard={false}
    >

      <div style={{ display: 'flex', gap: 0 }}>
        <div style={{ width: 260, minWidth: 260, flex: '0 0 260px', borderRight: '1px solid #f0f0f0', paddingRight: 12, overflowY: 'auto' }}>
          <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 8 }}>
            <Select value={activePlatform} onChange={(v)=> { setActivePlatform(v); setSelectedTreeKeys(['grp:全部']); setActiveGroup('全部'); filterForm.setFieldsValue({ group: '全部' }); }} style={{ width: '100%' }} options={platforms.map(p => ({ value: p, label: p }))} placeholder="选择顶级目录" />
          </Space>
          <Tree
            treeData={treeData as any}
            selectedKeys={selectedTreeKeys}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as string[])}
            onSelect={(keys) => {
              const k = String((keys as any)[0] || 'grp:全部');
              setSelectedTreeKeys([k]);
              if (k === 'grp:全部') {
                setActiveGroup('全部');
                setActiveFeature(undefined);
                setActiveAction(undefined);
                filterForm.setFieldsValue({ group: '全部' });
              } else if (k.startsWith('grp:')) {
                const g = k.replace(/^grp:/, '');
                setActiveGroup(g);
                setActiveFeature(undefined);
                setActiveAction(undefined);
                filterForm.setFieldsValue({ group: g });
              } else if (k.startsWith('feat:')) {
                const rest = k.replace(/^feat:/, '');
                const parts = rest.split('::');
                const g = parts[0];
                const feat = parts.slice(1).join('::');
                setActiveGroup(g);
                setActiveFeature(feat);
                setActiveAction(undefined);
                filterForm.setFieldsValue({ group: g });
              } else if (k.startsWith('act:')) {
                const itemKey = k.replace(/^act:/, '');
                const item = list.find(x => x.key === itemKey);
                const g = item?.group || '全部';
                setActiveGroup(g);
                setActiveFeature(item?.feature);
                setActiveAction(item?.action);
                filterForm.setFieldsValue({ group: g });
              }
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, padding: 16 }}>
          <div className="filters-row" style={{ marginBottom: 12 }}>
            <Form
              form={filterForm}
              className="filter-tools filter-tools--center"
              layout="vertical"
              style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
              onValuesChange={(_, all) => {
                setKw(all.keyword || '');
                setActiveGroup(all.group || '全部');
                setActiveStatus(all.status || '全部');
                setActiveFeature(undefined);
                setActiveAction(undefined);
                setSelectedTreeKeys([`grp:${all.group || '全部'}`]);
              }}
            >
              <Form.Item name="keyword" label="关键字">
                <Input allowClear placeholder="搜索权限原子" style={{ width: 240 }} />
              </Form.Item>
              <Form.Item name="group" label="分组" initialValue={activeGroup}>
                <Select showSearch optionFilterProp="label" style={{ width: 220 }} options={groups.map(g => ({ value: g, label: g }))} />
              </Form.Item>
              <Form.Item name="status" label="状态" initialValue={activeStatus}>
                <Select style={{ width: 160 }} options={[{ value: '全部', label: '全部' }, { value: '已绑定', label: '已绑定' }]} />
              </Form.Item>
            </Form>
            <Space className="filter-actions">
              <Button size="middle" onClick={() => { setKw(''); setActiveGroup('全部'); setActiveStatus('全部'); setActiveFeature(undefined); setActiveAction(undefined); setSelectedTreeKeys(['grp:全部']); filterForm.setFieldsValue({ group: '全部', status: '全部' }); }}>重置</Button>
            </Space>
          </div>
          <Table
            className="vr-table vr-table--middle"
            size="middle"
            rowKey={(r:any)=> r.key || r.id || Math.random().toString(36).slice(2)}
            dataSource={rows}
            expandable={{
              expandedRowRender: (record:any) => {
                const apis: ApiItem[] = (list.find(x => x.key === record.key)?.apis) || [];
                if (!apis.length) return (<div style={{ color:'#9aa0a6' }}>未扫描到绑定的API</div>);
                return (
                  <div style={{ padding:'6px 12px' }}>
                    <Table size="middle" pagination={false} rowKey={(r:any)=> r.method+':'+r.path} dataSource={apis}
                      columns={[
                        { title:'功能名', key:'apiTitle', width:180, render: (_:any, r:ApiItem) => apiTitle(r.method, r.path) },
                        { title:'方法', dataIndex:'method', width:100 },
                        { title:'路径', dataIndex:'path' },
                        { title:'文件', dataIndex:'file' },
                        { title:'用途', key:'usage', width:220, render: (_:any, r:ApiItem) => apiUsage(r.method, r.path) },
                      ] as any}
                    />
                  </div>
                );
              }
            }}
            columns={[
              { title:'权限原子', dataIndex:'action' },
              { title:'功能', dataIndex:'feature', width: 140 },
              { title:'分组', dataIndex:'group', width: 140 },
              { title:'描述', dataIndex:'desc' },
              { title:'状态', key:'status', width: 100, render: (_:any, r:any) => (<Tag color={r.bound? 'green':'gold'}>{r.bound? '已绑定':'策划'}</Tag>) },
            ] as any}
            pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10','20','50'], size: 'default' }}
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
