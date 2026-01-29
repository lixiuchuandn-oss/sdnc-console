import React, { useEffect, useMemo, useState } from 'react';
import { Table, Input, Tag, Button, Modal, Form, message, Select, Space, Tabs, InputNumber, Row, Col, MenuProps } from 'antd';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { API_BASE_URL, getAuthHeaders, createHarvesterNamespace, deleteHarvesterNamespace, updateHarvesterNamespace } from '../../../../services/api';
import { ReloadOutlined, SettingOutlined } from '@ant-design/icons';

type Props = {
  cloudId: string;
  showLog?: boolean;
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
  return (
    n === 'kube-system' ||
    n === 'kube-public' ||
    n === 'kube-node-lease' ||
    n === 'cloud-public' ||
    n === 'cattle-system' ||
    n === 'cattle-global-data' ||
    n === 'cattle-global-nt' ||
    n === 'cattle-monitoring-system' ||
    n === 'cattle-fleet-system' ||
    n === 'cattle-fleet-local-system' ||
    n === 'longhorn-system' ||
    n === 'ingress-nginx' ||
    n === 'harvester-system' ||
    n.startsWith('cattle-') ||
    n.startsWith('fleet-') ||
    n.startsWith('longhorn-') ||
    n.startsWith('kube-') ||
    n.startsWith('kubeeye-') ||
    n.startsWith('kubeovn-') ||
    n.startsWith('cluster-fleet-')
  );
};

const NamespacesTab: React.FC<Props> = ({ cloudId, showLog }) => {
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [namespaces, setNamespaces] = useState<any[]>([]);
  const [raw, setRaw] = useState<any | null>(null);
  const [creating, setCreating] = useState<boolean>(false);
  const [editingNamespace, setEditingNamespace] = useState<any>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
  // Detail Modal State
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailNamespace, setDetailNamespace] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [form] = Form.useForm();

  const fetchNamespaces = async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `${API_BASE_URL}/api/clouds/${encodeURIComponent(cloudId)}/resources/harvester/namespaces`,
        {
          method: 'GET',
          headers: getAuthHeaders(),
          credentials: 'include',
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRaw(json);
      const items: any[] = Array.isArray(json?.data?.items) ? json.data.items : (Array.isArray(json?.items) ? json.items : []);
      setNamespaces(items);
    } catch (e: any) {
      // 留空
    } finally {
      setLoading(false);
    }
  };

  const fetchNamespaceDetail = async (name: string) => {
    try {
      setDetailLoading(true);
      setDetailVisible(true);
      setDetailNamespace(null);
      const res = await fetch(
        `${API_BASE_URL}/api/clouds/${encodeURIComponent(cloudId)}/resources/harvester/namespaces/${encodeURIComponent(name)}`,
        {
          method: 'GET',
          headers: getAuthHeaders(),
          credentials: 'include',
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setDetailNamespace(json?.data || json);
    } catch (e: any) {
      message.error(e?.message || '获取详情失败');
      setDetailVisible(false);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    fetchNamespaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudId]);


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
      fetchNamespaces();
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
      fetchNamespaces();
    } catch (e: any) {
      message.error(e?.message || (editingNamespace ? '更新失败' : '创建失败'));
    }
  };

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
            style={{ width: 240 }}
          />
          <Select
            value={filterType}
            onChange={setFilterType}
            options={[
              { label: '所有类型', value: 'all' },
              { label: '系统', value: 'system' },
              { label: '业务', value: 'user' },
            ]}
            style={{ width: 120 }}
          />
          <Select
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { label: '所有状态', value: 'all' },
              { label: 'Active', value: 'Active' },
              { label: 'Terminating', value: 'Terminating' },
            ]}
            style={{ width: 120 }}
          />
        </Space>
      }
      toolbarRight={
        <>
          <Button type="primary" onClick={() => { form.resetFields(); setCreating(true); }}>新增命名空间</Button>
          <Button icon={<SettingOutlined />} />
          <Button icon={<ReloadOutlined />} onClick={fetchNamespaces} />
        </>
      }
    >
      <Table
        bordered
        rowKey={(r: any) => r?.metadata?.name || r?.name || Math.random().toString(36).slice(2)}
        loading={loading}
        dataSource={filtered}
        pagination={{ showSizeChanger: true, pageSize: 10, pageSizeOptions: [10, 20, 50, 100] }}
        columns={[
          {
            title: '名称',
            key: 'name',
            render: (_: any, r: any) => r?.metadata?.name || r?.name || '-',
          },
          {
            title: '类型',
            key: 'type',
            width: 100,
            filters: [
              { text: '系统', value: 'system' },
              { text: '业务', value: 'user' },
            ],
            onFilter: (value: any, record: any) => {
              const name = record?.metadata?.name || record?.name || '';
              const isSys = isSystemNamespace(name);
              if (value === 'system') return isSys;
              if (value === 'user') return !isSys;
              return true;
            },
            render: (_: any, r: any) => {
              const name = r?.metadata?.name || r?.name || '';
              if (isSystemNamespace(name)) {
                return <Tag color="gold">系统</Tag>;
              }
              return <Tag>业务</Tag>;
            },
          },
          {
            title: '状态',
            key: 'phase',
            render: (_: any, r: any) => phaseBadge(r?.status?.phase || r?.status || '-'),
          },
          {
            title: '标签数量',
            key: 'labelsCount',
            render: (_: any, r: any) => {
              const labels = r?.metadata?.labels || {};
              const count = Object.keys(labels || {}).length;
              return count > 0 ? <Tag>{count}</Tag> : '-';
            },
          },
          {
            title: '创建时间',
            key: 'ctime',
            render: (_: any, r: any) => r?.metadata?.creationTimestamp || '-',
          },
          {
            title: '操作',
            key: 'op',
            width: 120,
            render: (_: any, r: any) => {
              const name = r?.metadata?.name || r?.name;
              const isSys = isSystemNamespace(name);
              
              const items: MenuProps['items'] = [
                {
                  key: 'edit',
                  label: '编辑配置',
                  disabled: isSys,
                  onClick: () => handleEdit(r),
                },
                {
                  key: 'view_metadata',
                  label: '查看元数据',
                  onClick: () => fetchNamespaceDetail(name),
                },
                {
                   type: 'divider',
                },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  disabled: isSys,
                  onClick: () => {
                    Modal.confirm({
                      title: `确认删除命名空间 ${name}？`,
                      content: '删除后无法恢复，其中的资源也将被删除。',
                      okText: '确认',
                      cancelText: '取消',
                      onOk: () => handleDelete(name),
                    });
                  },
                },
              ];

              return <ResourceActionsDropdown items={items} />;
            },
          },
        ] as any}
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

      {/* Detail Modal (Metadata View) */}
      <Modal
        open={detailVisible}
        title="元数据查看"
        width={800}
        footer={null}
        onCancel={() => setDetailVisible(false)}
      >
        {detailLoading ? (
           <div style={{ textAlign: 'center', padding: 20 }}>加载中...</div>
        ) : (
          <Tabs
            defaultActiveKey="raw"
            items={[
              {
                key: 'raw',
                label: 'Harvester 资源',
                children: (
                  <Input.TextArea
                    readOnly
                    value={detailNamespace ? JSON.stringify(detailNamespace, null, 2) : ''}
                    rows={20}
                    style={{ fontFamily: 'monospace', color: '#333' }}
                  />
                ),
              },
            ]}
          />
        )}
      </Modal>

      {showLog && (
        <div style={{ marginTop: 12 }}>
          <pre
            style={{
              background: '#f7f7f7',
              padding: 12,
              borderRadius: 8,
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {JSON.stringify(raw, null, 2)}
          </pre>
        </div>
      )}
    </PageDetailSection>
  );
};

export default NamespacesTab;
