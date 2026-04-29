import React, { useEffect, useMemo, useState } from 'react';
import { Table, Input, Tag, Button, Form, message, Select, Tooltip, Row, Col } from 'antd';
import PageDetailSection from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import { API_BASE_URL, getAuthHeaders } from '../../../../../services/api';
import { createHarvesterNamespace, updateHarvesterNamespace } from '../../../../../services/harvesterApi';
import { FolderOpenTwoTone, MinusCircleOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import HarvesterResourceDrawer from '../shared/components/HarvesterOpsinfoDrawer';
import StdFormModal from '../../../../../components/StdFormModal';

import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { isSystemNamespace, namespaceSectionType } from '../../../../../utils/harvesterUtils';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';
import { clearGetCacheForPath } from '../../../../../utils/requestManager';
import { useCloudmapOpsViewWrite } from '../hooks/useCloudmapOpsViewWrite';

/**
 * 组件属性定义
 * @property cloudId - 当前云平台的 ID
 * @property namespaces - 命名空间列表数据
 * @property loading - 数据加载状态
 * @property onRefresh - 刷新数据的回调函数
 * @property showLog - 是否显示调试日志（原始数据）
 * @property raw - 原始数据对象
 */
type Props = {
  cloudId: string;
  namespaces?: any[];
  loading?: boolean;
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  showLog?: boolean;
  raw?: any;
  isTenant?: boolean;
};

/**
 * 根据命名空间状态生成对应的 Badge 标签
 * @param phase - 状态字符串 (Active, Terminating 等)
 * @returns AntD Tag 组件
 */
/** 将表单中的标签行转为 K8s labels 对象（忽略空键） */
function labelPairsToRecord(pairs: Array<{ key?: string; value?: string } | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs || []) {
    const k = String(p?.key ?? '').trim();
    if (!k) continue;
    out[k] = String(p?.value ?? '').trim();
  }
  return out;
}

function collectDuplicateLabelKeys(pairs: Array<{ key?: string } | undefined> | undefined): string[] {
  const keys = (pairs || []).map((p) => String(p?.key ?? '').trim()).filter(Boolean);
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return [...dup];
}

const phaseBadge = (phase?: string) => {
  const k = String(phase || '').toLowerCase();
  let badgeClass = 'std-badge-default';
  
  if (k === 'active') badgeClass = 'std-badge-success';
  else if (k === 'terminating') badgeClass = 'std-badge-warning';
  
  return <span className={`std-badge ${badgeClass}`}>{phase || '-'}</span>;
};



/**
 * Harvester 命名空间管理页签组件
 * 展示命名空间列表，提供创建、编辑、删除及详情查看功能
 */
const NamespacesTab: React.FC<Props> = ({ cloudId, namespaces = [], loading = false, onRefresh, showLog, raw, isTenant }) => {
  const hasOpsView = useCloudmapOpsViewWrite();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasNamespacesWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.namespaces:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const isStandardView = !hasOpsView;

  // === 状态管理 ===
  // 搜索关键字
  const [keyword, setKeyword] = useState('');
  // 是否正在创建/编辑
  const [creating, setCreating] = useState<boolean>(false);
  // 当前正在编辑的命名空间对象 (null 表示新建)
  const [editingNamespace, setEditingNamespace] = useState<any>(null);
  // 类型过滤器: ''(全部) | system | public | tenant | admin
  const [filterType, setFilterType] = useState<string>('');
  // 状态过滤器: ''(全部) | Active | Terminating
  const [filterStatus, setFilterStatus] = useState<string>('');
  
  // === 详情抽屉状态 ===
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  const [form] = Form.useForm();

  /**
   * 打开详情抽屉并获取最新资源详情
   * @param record - 表格行数据
   */
  const handleOpenOpsinfo = async (record: any, tab: string = 'detail') => {
    // 强制指定 kind 为 Namespace，以便 EventsTab 正确识别
    setDetailRecord({ ...record, kind: 'Namespace' });
    setDetailVisible(true);
    setDetailActiveTab(tab);
  };

  /**
   * 数据过滤逻辑 (Memoized)
   * 依次应用: 类型过滤 -> 状态过滤 -> 关键字搜索
   */
  const filtered = useMemo(() => {
    let res = Array.isArray(namespaces) ? namespaces : [];

    // 1. 类型过滤（系统 / 公共 / 租户）
    if (filterType) {
      res = res.filter((r: any) => namespaceSectionType(r) === filterType);
    }

    // 2. 状态过滤 (Active/Terminating)
    if (filterStatus) {
      res = res.filter((r: any) => {
        const phase = r?.status?.phase || 'Unknown';
        return phase === filterStatus;
      });
    }

    // 3. 关键字搜索 (名称或标签)
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      res = res.filter((r: any) => {
        const name = String(r?.metadata?.name || r?.name || '').toLowerCase();
        const labels = r?.metadata?.labels || {};
        const labelKeys = Object.keys(labels || {}).map((k) => k.toLowerCase());
        const hitKw = name.includes(kw) || labelKeys.some((k) => k.includes(kw));
        return hitKw;
      });
    }
    return res;
  }, [namespaces, keyword, filterType, filterStatus]);

  /**
   * 处理编辑操作 - 填充表单
   * 解析 ResourceQuota 和 ContainerDefaultResourceLimit 并回填到表单
   */
  const handleEdit = (record: any) => {
    if (!hasNamespacesWrite) {
      message.error('无权限执行该操作');
      return;
    }
    setEditingNamespace(record);
    const name = record?.metadata?.name || record?.name;
    const labels = record?.metadata?.labels || {};
    const labelPairs = Object.keys(labels)
      .sort()
      .map((k) => ({ key: k, value: String(labels[k] ?? '') }));

    form.setFieldsValue({
      name,
      labelPairs: labelPairs.length ? labelPairs : [{ key: '', value: '' }],
    });
    setCreating(true);
  };

  /**
   * 处理表单提交 (创建/更新)
   */
  const handleCreate = async (values: any) => {
    if (!hasNamespacesWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const v = values;
      const name = String(v.name || '');
      
      // [系统命名空间保护] 禁止创建系统命名空间
      if (isSystemNamespace(name)) {
        message.error('禁止创建系统或受保护的命名空间');
        return;
      }
      
      const dups = collectDuplicateLabelKeys(v.labelPairs);
      if (dups.length > 0) {
        message.error(`标签键不能重复：${dups.join(', ')}`);
        return;
      }

      const parsed = labelPairsToRecord(v.labelPairs);
      // 本页「新增命名空间」入口：统一标记为管理员场景（与租户分配 tenant、集群公共 public 区分）
      const labels = editingNamespace
        ? parsed
        : {
            ...parsed,
            'kubernetes.io/metadata.name': name,
            'tower.io/managed': 'true',
            'tower.io/creator': 'compute-tower',
            'tower.io/scenario': 'admin',
          };

      // 构造符合 K8s Manifest 标准的 Payload
      const payload = {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name,
          labels,
        }
      };

      if (editingNamespace) {
        await updateHarvesterNamespace(cloudId, name, payload);
        message.success('更新成功');
      } else {
        await createHarvesterNamespace(cloudId, payload);
        message.success('创建成功');
      }

      // 关闭弹窗和重置表单
      setCreating(false);
      setEditingNamespace(null);
      form.resetFields();

      clearGetCacheForPath(`/api/clouds/${cloudId}/resources/harvester/namespaces`);

      // 刷新数据列表（创建后已直接入库；force=true 触发后端同步语义）
      if (onRefresh) {
        onRefresh(true, true);
      }
    } catch (e: any) {
      message.error(e?.message || (editingNamespace ? '更新失败' : '创建失败'));
    }
  };

  /**
   * 表格列定义
   */
  const allColumns = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (_: any, r: any) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FolderOpenTwoTone/>
          <span>{r?.metadata?.name || r?.name}</span>
        </span>
      ),
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, r: any) => phaseBadge(r?.status?.phase)
    },
    {
      title: 'UID',
      dataIndex: ['metadata', 'uid'],
      key: 'uid',
      render: (v: string) => <span className="text-secondary" style={{ fontSize: 12 }}>{v || '-'}</span>
    },
    {
      title: 'ResourceVersion',
      dataIndex: ['metadata', 'resourceVersion'],
      key: 'resourceVersion',
      render: (v: string) => <span className="text-secondary" style={{ fontSize: 12 }}>{v || '-'}</span>
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'creationTimestamp',
      render: (v: string) => v ? <span className="std-time">{v}</span> : '-'
    },
    {
      title: '类型',
      key: 'type',
      render: (_: any, r: any) => {
        const t = namespaceSectionType(r);
        if (t === 'system') {
          return <span className="std-badge std-badge-default">系统</span>;
        }
        if (t === 'public') {
          return <span className="std-badge std-badge-info">公共</span>;
        }
        if (t === 'admin') {
          return <span className="std-badge std-badge-warning">管理员</span>;
        }
        return <span className="std-badge std-badge-success">租户</span>;
      }
    },
    {
      title: '标签',
      key: 'labels',
      render: (_: any, r: any) => {
        const labels = r?.metadata?.labels || {};
        const keys = Object.keys(labels);
        if (keys.length === 0) return <span className="text-secondary">-</span>;
        const content = (
          <div style={{ fontSize: 12 }}>
            {keys.map(k => <div key={k} style={{ marginBottom: 2 }}>{k}: {labels[k]}</div>)}
          </div>
        );
        return (
          <Tooltip title={content} styles={{ body: { maxWidth: 400, maxHeight: 300, overflowY: 'auto' } }}>
            <Tag style={{ cursor: 'pointer' }}>{keys.length}</Tag>
          </Tooltip>
        );
      }
    },
    {
      title: '注解',
      key: 'annotations',
      render: (_: any, r: any) => {
        const annotations = r?.metadata?.annotations || {};
        const keys = Object.keys(annotations);
        if (keys.length === 0) return <span className="text-secondary">-</span>;
        const content = (
          <div style={{ fontSize: 12 }}>
            {keys.map(k => (
              <div key={k} style={{ marginBottom: 4, borderBottom: '1px dashed rgba(255,255,255,0.2)', paddingBottom: 2 }}>
                <div style={{ fontWeight: 'bold' }}>{k}</div>
                <div style={{ opacity: 0.8, wordBreak: 'break-all' }}>{annotations[k]}</div>
              </div>
            ))}
          </div>
        );
        return (
          <Tooltip title={content} styles={{ body: { maxWidth: 500, maxHeight: 400, overflowY: 'auto' } }}>
            <Tag style={{ cursor: 'pointer' }}>{keys.length}</Tag>
          </Tooltip>
        );
      }
    },
    {
      title: 'Finalizers',
      key: 'finalizers',
      render: (_: any, r: any) => {
        const finalizers = r?.metadata?.finalizers || [];
        if (!finalizers.length) return <span className="text-secondary">-</span>;
        const content = (
          <div style={{ fontSize: 12 }}>
            {finalizers.map((f: string) => <div key={f}>{f}</div>)}
          </div>
        );
        return (
          <Tooltip title={content}>
            <Tag style={{ cursor: 'pointer' }}>{finalizers.length}</Tag>
          </Tooltip>
        );
      }
    },
    {
      title: 'ManagedFields',
      key: 'managedFields',
      render: (_: any, r: any) => {
        const fields = r?.metadata?.managedFields || [];
        if (!fields.length) return <span className="text-secondary">-</span>;
        const managers = Array.from(new Set(fields.map((f: any) => f.manager))) as string[];
        const content = (
          <div style={{ fontSize: 12 }}>
             {managers.map((m) => <div key={m}>{m}</div>)}
          </div>
        );
        return (
          <Tooltip title={content}>
             <Tag style={{ cursor: 'pointer' }}>{managers.length}</Tag>
          </Tooltip>
        );
      }
    },
    {
      title: '操作',
      key: 'actions',
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const name = r?.metadata?.name || r?.name;
        const isSys = isSystemNamespace(name);
        const items: any[] = [];
        if (!isTenant && !isStandardView) {
          items.push({ key: 'opsinfo', label: '查看YAML', onClick: () => handleOpenOpsinfo(r, 'detail') });
        }
        // [系统命名空间保护] 系统命名空间不允许编辑，只能查看
        if (!isSys) {
          items.push({ key: 'edit', label: '编辑配置', onClick: () => handleEdit(r) });
        }
        return (
          <ResourceActionsDropdown 
            items={items} 
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      }
    }
  ], [cloudId, isTenant, isStandardView, handleOpenOpsinfo, handleEdit]);

  // 使用新的 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_namespaces_table_v3');

  return (
    <PageDetailSection
      asCard={false}
      // === 工具栏左侧：搜索与过滤 ===
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称/标签"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select
            allowClear
            placeholder="命名空间类型"
            value={filterType || undefined}
            onChange={(v) => setFilterType(v || '')}
            options={[
              { label: '系统', value: 'system' },
              { label: '公共', value: 'public' },
              { label: '租户', value: 'tenant' },
              { label: '管理员', value: 'admin' },
            ]}
            className="toolbar-filter-sm"
          />
          <Select
            allowClear
            placeholder="命名空间状态"
            value={filterStatus || undefined}
            onChange={(v) => setFilterStatus(v || '')}
            options={[
              { label: 'Active', value: 'Active' },
              { label: 'Terminating', value: 'Terminating' },
            ]}
            className="toolbar-filter-sm"
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setFilterType('');
              setFilterStatus('');
            }}
          >
            重置
          </button>
        </>
      }
      // === 工具栏右侧：操作按钮 ===
      toolbarRight={
        <>
          <Button
            type="primary"
            disabled={!hasNamespacesWrite}
            onClick={() => {
              if (!hasNamespacesWrite) return;
              setEditingNamespace(null);
              form.resetFields();
              form.setFieldsValue({ labelPairs: [{ key: '', value: '' }] });
              setCreating(true);
            }}
          >
            创建管理员命名空间
          </Button>
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey="harvester_namespaces_table_v3"
          />
          <Button 
            icon={<ReloadOutlined />} 
            onClick={() => {
              if (onRefresh) {
                try {
                  onRefresh(true); // 使用 force=true 跳过缓存，强制刷新
                } catch (e: any) {
                  message.error('刷新失败: ' + (e?.message || '未知错误'));
                }
              } else {
                // 如果没有传入 onRefresh，至少显示一个提示
                message.warning('刷新功能未配置');
              }
            }} 
            loading={loading}
            disabled={loading}
          />
        </>
      }
    >
      {/* === 主表格 === */}
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(r: any) => r?.metadata?.name || r?.name || Math.random().toString(36).slice(2)}
        loading={loading}
        dataSource={filtered}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
        columns={tableColumns}
      />
      
      {/* === 创建/编辑 模态框 === */}
      <StdFormModal
        open={creating}
        title={editingNamespace ? "编辑命名空间" : "创建管理员命名空间"}
        width={720}
        onCancel={() => {
          setCreating(false);
          setEditingNamespace(null);
          form.resetFields();
        }}
        onFinish={handleCreate}
        okText={editingNamespace ? "保存" : "创建"}
        form={form}
      >
          <Form.Item
            label="命名空间名称"
            name="name"
            rules={[
              { required: true, message: '请输入名称' },
              { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '仅允许小写字母、数字与连字符，且首尾为字母或数字' },
              { max: 63, message: '最长 63 个字符' }
            ]}
          >
            <Input placeholder="例如：default 或 my-space" disabled={!!editingNamespace} />
          </Form.Item>
          <Form.Item
            label="标签"
            tooltip="逐行填写键值；可添加多行。保存后将以当前列表为准写入集群（请保留需继续生效的 Tower 标签）。"
          >
            <Form.List name="labelPairs">
              {(fields, { add, remove }) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {fields.map(({ key, name: rowName, ...rest }) => (
                    <Row key={key} gutter={[8, 0]} align="middle" wrap={false}>
                      <Col flex="1 1 0" style={{ minWidth: 0 }}>
                        <Form.Item
                          {...rest}
                          name={[rowName, 'key']}
                          rules={[
                            {
                              validator: async (_, value) => {
                                const k = String(value || '').trim();
                                if (!k) return;
                                if (k.length > 253) throw new Error('键最长 253 个字符');
                                if (/[\s=]/.test(k)) throw new Error('键不能包含空格或 =');
                              },
                            },
                          ]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="键，如 env 或 example.com/name" allowClear style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col flex="1 1 0" style={{ minWidth: 0 }}>
                        <Form.Item {...rest} name={[rowName, 'value']} style={{ marginBottom: 0 }}>
                          <Input placeholder="值" allowClear style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col flex="none">
                        <Button
                          type="text"
                          danger
                          icon={<MinusCircleOutlined />}
                          disabled={fields.length <= 1}
                          onClick={() => remove(rowName)}
                          aria-label="删除此行标签"
                        />
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" onClick={() => add({ key: '', value: '' })} block icon={<PlusOutlined />}>
                    添加标签
                  </Button>
                </div>
              )}
            </Form.List>
          </Form.Item>
      </StdFormModal>

      {/* === 详情侧边抽屉 === */}
      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="Namespace"
        record={detailRecord}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
        cloudId={cloudId}
      />

      {/* 调试日志视图 */}
      {showLog && (
        <div>
          <pre className="metadata-viewer">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </div>
      )}
    </PageDetailSection>
  );
};

export default NamespacesTab;
