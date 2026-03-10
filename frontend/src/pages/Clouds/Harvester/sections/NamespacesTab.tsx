import React, { useEffect, useMemo, useState } from 'react';
import { Table, Input, Tag, Button, Modal, Form, message, Select, Tabs, InputNumber, Row, Col, MenuProps, Tooltip, Descriptions } from 'antd';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { API_BASE_URL, getAuthHeaders } from '../../../../services/api';
import { createHarvesterNamespace, updateHarvesterNamespace } from '../../../../services/harvesterApi';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import StdFormModal from '../../../../components/StdFormModal';

import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';

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
  // === 状态管理 ===
  // 搜索关键字
  const [keyword, setKeyword] = useState('');
  // 是否正在创建/编辑
  const [creating, setCreating] = useState<boolean>(false);
  // 当前正在编辑的命名空间对象 (null 表示新建)
  const [editingNamespace, setEditingNamespace] = useState<any>(null);
  // 类型过滤器: all(全部) | system(系统) | user(业务)
  const [filterType, setFilterType] = useState<string>('all');
  // 状态过滤器: all(全部) | Active | Terminating
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
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
   * 解析标签字符串
   * 将 "k=v,k2=v2" 格式字符串转换为对象 {k:v, k2:v2}
   */
  const parseLabels = (rawStr?: string): Record<string,string> | undefined => {
    const s = String(rawStr || '').trim();
    if (!s) return undefined;
    const out: Record<string,string> = {};
    s.split(',').forEach(pair => {
      const [k, v] = pair.split('=');
      const kk = String(k || '').trim();
      const vv = String(v || '').trim();
      if (kk) out[kk] = vv;
    });
    return Object.keys(out).length ? out : undefined;
  };

  /**
   * 数据过滤逻辑 (Memoized)
   * 依次应用: 类型过滤 -> 状态过滤 -> 关键字搜索
   */
  const filtered = useMemo(() => {
    let res = Array.isArray(namespaces) ? namespaces : [];

    // 1. 类型过滤 (系统/业务)
    if (filterType !== 'all') {
      res = res.filter((r: any) => {
        const name = r?.metadata?.name || r?.name || '';
        const isSys = isSystemNamespace(name);
        return filterType === 'system' ? isSys : !isSys;
      });
    }

    // 2. 状态过滤 (Active/Terminating)
    if (filterStatus !== 'all') {
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
    setEditingNamespace(record);
    const name = record?.metadata?.name || record?.name;
    const labels = record?.metadata?.labels || {};
    const annotations = record?.metadata?.annotations || {};

    // 格式化标签为字符串显示
    const labelStr = Object.keys(labels)
      .map((k) => `${k}=${labels[k]}`)
      .join(',');

    // 解析资源配额 (Resource Quota)
    const rqStr = annotations['field.cattle.io/resourceQuota'];
    let rqLimit: any = {};
    try {
      const rq = rqStr ? JSON.parse(rqStr) : {};
      rqLimit = rq.limit || {};
    } catch {}

    // 解析容器默认资源限制
    const cdStr = annotations['field.cattle.io/containerDefaultResourceLimit'];
    let cdLimit: any = {};
    try {
      cdLimit = cdStr ? JSON.parse(cdStr) : {};
    } catch {}

    // 设置表单值
    form.setFieldsValue({
      name: name,
      labels: labelStr,
      // 配额字段
      rq_limitsCpu: rqLimit.limitsCpu,
      rq_limitsMemory: rqLimit.limitsMemory,
      rq_requestsCpu: rqLimit.requestsCpu,
      rq_requestsMemory: rqLimit.requestsMemory,
      rq_configMaps: rqLimit.configMaps,
      rq_pods: rqLimit.pods,
      rq_services: rqLimit.services,
      rq_secrets: rqLimit.secrets,
      rq_persistentVolumeClaims: rqLimit.persistentVolumeClaims,
      rq_servicesLoadBalancers: rqLimit.servicesLoadBalancers,
      rq_servicesNodePorts: rqLimit.servicesNodePorts,
      // 容器默认限制字段
      cd_limitsCpu: cdLimit.limitsCpu,
      cd_limitsMemory: cdLimit.limitsMemory,
      cd_requestsCpu: cdLimit.requestsCpu,
      cd_requestsMemory: cdLimit.requestsMemory,
    });
    setCreating(true);
  };

  /**
   * 处理表单提交 (创建/更新)
   */
  const handleCreate = async (values: any) => {
    try {
      const v = values;
      const name = String(v.name || '');
      
      // [系统命名空间保护] 禁止创建系统命名空间
      if (isSystemNamespace(name)) {
        message.error('禁止创建系统或受保护的命名空间');
        return;
      }
      
      const labels = parseLabels(v.labels);
      const annotations: any = {};

      // 构建资源配额配置 (Resource Quota)
      const rqLimit: any = {};
      const rqFields = [
        'limitsCpu',
        'limitsMemory',
        'requestsCpu',
        'requestsMemory',
        'configMaps',
        'pods',
        'services',
        'secrets',
        'persistentVolumeClaims',
        'servicesLoadBalancers',
        'servicesNodePorts',
      ];
      let hasRq = false;
      rqFields.forEach((f) => {
        const val = v[`rq_${f}`];
        if (val) {
          rqLimit[f] = String(val);
          hasRq = true;
        }
      });
      if (hasRq) {
        annotations['field.cattle.io/resourceQuota'] = JSON.stringify({ limit: rqLimit });
      }

      // 构建容器默认资源限制
      const cdLimit: any = {};
      const cdFields = ['limitsCpu', 'limitsMemory', 'requestsCpu', 'requestsMemory'];
      let hasCd = false;
      cdFields.forEach((f) => {
        const val = v[`cd_${f}`];
        if (val) {
          cdLimit[f] = String(val);
          hasCd = true;
        }
      });
      if (hasCd) {
        annotations['field.cattle.io/containerDefaultResourceLimit'] = JSON.stringify(cdLimit);
      }

      // 构造符合 K8s Manifest 标准的 Payload
      const payload = {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name,
          labels,
          annotations: Object.keys(annotations).length ? annotations : undefined,
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
      
      // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，但后端会优先查询数据库）
      // 静默刷新，不显示提示信息
      if (onRefresh) {
        onRefresh(true, true); // force=true 跳过缓存，silent=true 静默刷新
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
        <span>
          {r?.metadata?.name || r?.name}
        </span>
      )
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
        const isSys = isSystemNamespace(r?.metadata?.name || r?.name);
        return isSys ? 
          <span className="std-badge std-badge-default">System</span> : 
          <span className="std-badge std-badge-info">User</span>;
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
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const name = r?.metadata?.name || r?.name;
        const isSys = isSystemNamespace(name);
        const items: any[] = [];
        if (!isTenant) {
          items.push({ key: 'opsinfo', label: '运维信息', onClick: () => handleOpenOpsinfo(r, 'detail') });
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
  ], [cloudId, isTenant, handleOpenOpsinfo, handleEdit]);

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
            placeholder="关键字（名称/标签）"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select
            value={filterType}
            onChange={setFilterType}
            options={[
              { label: '所有类型', value: 'all' },
              { label: '系统', value: 'system' },
              { label: '业务', value: 'user' },
            ]}
            className="toolbar-filter-sm"
          />
          <Select
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { label: '所有状态', value: 'all' },
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
              setFilterType('all');
              setFilterStatus('all');
            }}
          >
            重置
          </button>
        </>
      }
      // === 工具栏右侧：操作按钮 ===
      toolbarRight={
        <>
          <Button type="primary" onClick={() => { form.resetFields(); setCreating(true); }}>新增命名空间</Button>
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey="harvester_namespaces_table_v3"
          />
          <Button 
            icon={<ReloadOutlined />} 
            onClick={() => {
              console.log('[NamespacesTab] 刷新按钮被点击, loading:', loading, 'onRefresh:', !!onRefresh);
              if (onRefresh) {
                try {
                  onRefresh(true); // 使用 force=true 跳过缓存，强制刷新
                } catch (e: any) {
                  console.error('[NamespacesTab] 刷新按钮执行出错:', e);
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
        bordered
        rowKey={(r: any) => r?.metadata?.name || r?.name || Math.random().toString(36).slice(2)}
        loading={loading}
        dataSource={filtered}
        pagination={{
          size: 'small',
          showQuickJumper: false,
        }}
        columns={tableColumns}
      />
      
      {/* === 创建/编辑 模态框 === */}
      <StdFormModal
        open={creating}
        title={editingNamespace ? "编辑命名空间" : "新增命名空间"}
        width={600}
        onCancel={() => { setCreating(false); setEditingNamespace(null); form.resetFields(); }}
        onFinish={handleCreate}
        okText={editingNamespace ? "保存" : "创建"}
        form={form}
      >
          <Tabs
            defaultActiveKey="basic"
            items={[
              {
                key: 'basic',
                label: '基础信息',
                children: (
                  <>
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
                    <Form.Item label="标签（可选）" name="labels" tooltip="以逗号分隔的 k=v 列表，如 env=dev,team=net" >
                      <Input placeholder="k=v,k2=v2" />
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'quota',
                label: '资源配额',
                children: (
                  <Row gutter={16}>
                     <Col span={12}>
                        <Form.Item label="CPU 上限 (limitsCpu)" name="rq_limitsCpu" tooltip="例如：1000m, 1, 2.5">
                           <Input placeholder="无限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="内存上限 (limitsMemory)" name="rq_limitsMemory" tooltip="例如：1Gi, 512Mi">
                           <Input placeholder="无限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="CPU 下限 (requestsCpu)" name="rq_requestsCpu">
                           <Input placeholder="无限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="内存下限 (requestsMemory)" name="rq_requestsMemory">
                           <Input placeholder="无限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="配置字典 (ConfigMaps)" name="rq_configMaps">
                           <Input placeholder="数量限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="Pods" name="rq_pods">
                           <Input placeholder="数量限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="Services" name="rq_services">
                           <Input placeholder="数量限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="Secrets" name="rq_secrets">
                           <Input placeholder="数量限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="PVCs" name="rq_persistentVolumeClaims">
                           <Input placeholder="数量限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="Services (LB)" name="rq_servicesLoadBalancers">
                           <Input placeholder="数量限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="Services (NodePort)" name="rq_servicesNodePorts">
                           <Input placeholder="数量限制" />
                        </Form.Item>
                     </Col>
                  </Row>
                ),
              },
              {
                key: 'container',
                label: '容器默认限制',
                children: (
                  <Row gutter={16}>
                     <Col span={12}>
                        <Form.Item label="CPU 上限 (limitsCpu)" name="cd_limitsCpu" tooltip="例如：1000m">
                           <Input placeholder="无限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="内存上限 (limitsMemory)" name="cd_limitsMemory" tooltip="例如：512Mi">
                           <Input placeholder="无限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="CPU 下限 (requestsCpu)" name="cd_requestsCpu">
                           <Input placeholder="无限制" />
                        </Form.Item>
                     </Col>
                     <Col span={12}>
                        <Form.Item label="内存下限 (requestsMemory)" name="cd_requestsMemory">
                           <Input placeholder="无限制" />
                        </Form.Item>
                     </Col>
                  </Row>
                ),
              },
            ]}
          />
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
