import React, { useEffect, useMemo, useState } from 'react';
import { Table, Input, Tag, Button, Modal, Form, message, Select, Space, Tabs, InputNumber, Row, Col, MenuProps, Tooltip, Descriptions } from 'antd';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { API_BASE_URL, getAuthHeaders, createHarvesterNamespace, deleteHarvesterNamespace, updateHarvesterNamespace } from '../../../../services/api';
import { ReloadOutlined } from '@ant-design/icons';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';

import TableColumnSettings from '../../../../components/TableColumnSettings';

type Props = {
  cloudId: string;
  namespaces?: any[];
  loading?: boolean;
  onRefresh?: () => void;
  showLog?: boolean;
  raw?: any;
};

const phaseBadge = (phase?: string) => {
  const k = String(phase || '').toLowerCase();
  const color = (function () {
    if (k === 'active') return 'green';
    if (k === 'terminating') return 'orange';
    return undefined;
  })();
  return <Tag color={color}>{phase || '-'}</Tag>;
};

const isSystemNamespace = (name: string) => {
  const n = String(name || '').toLowerCase();
  
  // Exact matches
  if (['cloud-public', 'ingress-nginx'].includes(n)) return true;

  // Prefix matches
  const prefixes = [
    'cattle',
    'fleet',
    'longhorn',
    'kube',
    'harvester',
    'cluster-fleet',
    'cluster',
    'local',
    'user'
  ];
  
  return prefixes.some(p => n.startsWith(p));
};

const NamespacesTab: React.FC<Props> = ({ cloudId, namespaces = [], loading = false, onRefresh, showLog, raw }) => {
  const [keyword, setKeyword] = useState('');
  const [creating, setCreating] = useState<boolean>(false);
  const [editingNamespace, setEditingNamespace] = useState<any>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  
  // Detail Modal State
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailResource, setDetailResource] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');
  const [detailLoading, setDetailLoading] = useState(false);

  const [form] = Form.useForm();

  const handleOpenDetail = async (record: any) => {
    const name = record?.metadata?.name || record?.name;
    setDetailRecord(record);
    setDetailResource(null);
    setDetailVisible(true);
    setDetailActiveTab('detail');
    setDetailLoading(true);

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/clouds/${encodeURIComponent(cloudId)}/resources/harvester/namespaces/${encodeURIComponent(name)}?force=true`,
        {
          method: 'GET',
          headers: getAuthHeaders(),
          credentials: 'include',
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setDetailResource(json?.data || json);
    } catch (e: any) {
      message.error(e?.message || '获取详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

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

  const filtered = useMemo(() => {
    let res = Array.isArray(namespaces) ? namespaces : [];

    // Filter by Type
    if (filterType !== 'all') {
      res = res.filter((r: any) => {
        const name = r?.metadata?.name || r?.name || '';
        const isSys = isSystemNamespace(name);
        return filterType === 'system' ? isSys : !isSys;
      });
    }

    // Filter by Status
    if (filterStatus !== 'all') {
      res = res.filter((r: any) => {
        const phase = r?.status?.phase || 'Unknown';
        return phase === filterStatus;
      });
    }

    // Filter by Keyword
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

  const handleDelete = async (name: string) => {
    try {
      await deleteHarvesterNamespace(cloudId, name);
      message.success('删除成功');
      onRefresh?.();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const handleEdit = (record: any) => {
    setEditingNamespace(record);
    const name = record?.metadata?.name || record?.name;
    const labels = record?.metadata?.labels || {};
    const annotations = record?.metadata?.annotations || {};

    const labelStr = Object.keys(labels)
      .map((k) => `${k}=${labels[k]}`)
      .join(',');

    const rqStr = annotations['field.cattle.io/resourceQuota'];
    let rqLimit: any = {};
    try {
      const rq = rqStr ? JSON.parse(rqStr) : {};
      rqLimit = rq.limit || {};
    } catch {}

    const cdStr = annotations['field.cattle.io/containerDefaultResourceLimit'];
    let cdLimit: any = {};
    try {
      cdLimit = cdStr ? JSON.parse(cdStr) : {};
    } catch {}

    form.setFieldsValue({
      name: name,
      labels: labelStr,
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
      cd_limitsCpu: cdLimit.limitsCpu,
      cd_limitsMemory: cdLimit.limitsMemory,
      cd_requestsCpu: cdLimit.requestsCpu,
      cd_requestsMemory: cdLimit.requestsMemory,
    });
    setCreating(true);
  };

  const handleCreate = async () => {
    try {
      const v = await form.validateFields();
      const name = String(v.name || '');
      const labels = parseLabels(v.labels);
      const annotations: any = {};

      // Resource Quota
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

      // Container Default Resource Limit
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

      const payload = {
        name,
        labels,
        annotations: Object.keys(annotations).length ? annotations : undefined,
      };

      if (editingNamespace) {
        await updateHarvesterNamespace(cloudId, name, payload);
        message.success('更新成功');
      } else {
        await createHarvesterNamespace(cloudId, payload);
        message.success('创建成功');
      }

      setCreating(false);
      setEditingNamespace(null);
      form.resetFields();
      onRefresh?.();
    } catch (e: any) {
      message.error(e?.message || (editingNamespace ? '更新失败' : '创建失败'));
    }
  };

  const allColumns = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (_: any, r: any) => <span>{r?.metadata?.name || r?.name}</span>
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
      render: (v: string) => v ? new Date(v).toLocaleString() : '-'
    },
    {
      title: '类型',
      key: 'type',
      render: (_: any, r: any) => {
        const isSys = isSystemNamespace(r?.metadata?.name || r?.name);
        return isSys ? <Tag color="default">System</Tag> : <Tag color="processing">User</Tag>;
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
          <Tooltip title={content} overlayInnerStyle={{ maxWidth: 400, maxHeight: 300, overflowY: 'auto' }}>
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
          <Tooltip title={content} overlayInnerStyle={{ maxWidth: 500, maxHeight: 400, overflowY: 'auto' }}>
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
      render: (_: any, r: any) => {
        const name = r?.metadata?.name || r?.name;
        const isSys = isSystemNamespace(name);
        return (
          <ResourceActionsDropdown 
            items={[
              { key: 'view', label: '数据查看', onClick: () => handleOpenDetail(r) },
              { key: 'edit', label: '编辑配置', onClick: () => handleEdit(r) },
              { type: 'divider' },
              { 
                key: 'delete', 
                label: '删除', 
                danger: true, 
                disabled: isSys,
                onClick: () => Modal.confirm({
                  title: `确认删除 ${name}?`,
                  content: '删除后无法恢复',
                  okText: '删除',
                  okButtonProps: { danger: true },
                  onOk: () => handleDelete(name)
                }) 
              }
            ]} 
          />
        );
      }
    }
  ], [cloudId]);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <Space>
          <Input
            allowClear
            placeholder="关键字（名称/标签）"
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
        </Space>
      }
      toolbarRight={
        <>
          <Button type="primary" onClick={() => { form.resetFields(); setCreating(true); }}>新增命名空间</Button>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_namespaces_table_v3"
          />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} />
        </>
      }
    >
      <Table
        className="std-table"
        bordered
        rowKey={(r: any) => r?.metadata?.name || r?.name || Math.random().toString(36).slice(2)}
        loading={loading}
        dataSource={filtered}
        pagination={{ size: 'small', showSizeChanger: true, pageSize: 10, pageSizeOptions: [10, 20, 50, 100] }}
        columns={tableColumns}
        scroll={{ x: 'max-content' }}
      />
      
      {/* Create Modal */}
      <Modal
        open={creating}
        title={editingNamespace ? "编辑命名空间" : "新增命名空间"}
        width={720}
        destroyOnClose
        onCancel={() => { setCreating(false); setEditingNamespace(null); form.resetFields(); }}
        onOk={handleCreate}
        okText="提交"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
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
        </Form>
      </Modal>

      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        record={detailRecord}
        resource={detailResource}
        loading={detailLoading}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
        renderDetail={(res) => (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="名称">{res?.metadata?.name || '-'}</Descriptions.Item>
            <Descriptions.Item label="UID">{res?.metadata?.uid || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{res?.metadata?.creationTimestamp || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">{res?.status?.phase || '-'}</Descriptions.Item>
            <Descriptions.Item label="标签">
              {res?.metadata?.labels ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {Object.keys(res.metadata.labels).map(k => (
                    <Tag key={k} style={{ marginRight: 0 }}>{k}={res.metadata.labels[k]}</Tag>
                  ))}
                </div>
              ) : '-'}
            </Descriptions.Item>
          </Descriptions>
        )}
      />

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
