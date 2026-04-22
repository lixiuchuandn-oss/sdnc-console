/**
 * ==============================================================================
 * 模块名称: Harvester Service 管理视图 (ServicesSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/sections/ServicesSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件负责展示和管理 Kubernetes Service 资源，包括：
 * 1. Service 列表展示（支持别名/ID 双轨制）
 * 2. Service 创建
 * 3. Service 删除
 * 4. 命名空间筛选
 * 5. 别名编辑（双轨制）
 * 6. YAML 查看
 * 
 * [核心逻辑]
 * 1. 双轨制命名：通过 tower.io/alias annotation 实现别名与 ID 分离
 * 2. 命名空间筛选：支持按命名空间过滤
 * 3. PATCH 操作：使用 JSON Patch 格式更新别名
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Table, Select, Button, Tag, Space, App, Modal, Input, Form, Tooltip } from 'antd';
import { ReloadOutlined, SearchOutlined, PlusOutlined, EditTwoTone, EyeOutlined } from '@ant-design/icons';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import YamlEditor from '../../../../../../components/YamlEditor';
import { ServiceFormModal } from '../components';
import {
  deleteHarvesterService,
  patchHarvesterContainerResource,
} from '../../../../../../services/harvesterApi';

type Props = {
  services: any[];
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
  createDefaultNamespace?: string;
};

/**
 * Service API 路径
 */
const API_PATH = '/api/v1/services';

/**
 * 格式化时间
 */
const formatTime = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
  } catch {
    return timestamp;
  }
};

/**
 * 计算运行时长
 */
const calculateAge = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    const created = new Date(timestamp).getTime();
    const now = Date.now();
    const diff = now - created;

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d${hours}h`;
    if (hours > 0) return `${hours}h${minutes}m`;
    return `${minutes}m`;
  } catch {
    return '-';
  }
};

/**
 * 渲染 Service 类型
 */
const renderServiceType = (type: string) => {
  const typeMap: Record<string, { color: string; text: string }> = {
    ClusterIP: { color: 'blue', text: 'ClusterIP' },
    NodePort: { color: 'green', text: 'NodePort' },
    LoadBalancer: { color: 'orange', text: 'LoadBalancer' },
    ExternalName: { color: 'purple', text: 'ExternalName' },
  };
  const config = typeMap[type] || { color: 'default', text: type };
  return <Tag color={config.color}>{config.text}</Tag>;
};

/**
 * Service 详情组件
 */
const ServiceTable: React.FC<{
  data: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: () => void;
  namespacesOptions: string[];
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onCreateClick: () => void;
}> = ({ data, loading, cloudId, onRefresh, namespacesOptions, nsValue, onNsChange, onCreateClick }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  
  // 别名编辑状态
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();
  
  // YAML 查看状态
  const [yamlModalVisible, setYamlModalVisible] = useState(false);
  const [yamlContent, setYamlContent] = useState('');

  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return data.filter((item: any) => {
      if (kw) {
        const name = item?.metadata?.name || '';
        const ns = item?.metadata?.namespace || '';
        if (!name.toLowerCase().includes(kw) && !ns.toLowerCase().includes(kw)) {
          return false;
        }
      }
      return true;
    });
  }, [data, keyword]);

  // 别名编辑 - 打开弹窗
  const handleOpenAliasModal = useCallback((record: any) => {
    const currentAlias = record?.metadata?.annotations?.['tower.io/alias'] || '';
    setAliasRecord(record);
    setAliasModalVisible(true);
    aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
  }, [aliasForm]);

  // 别名编辑 - 提交
  const handleSubmitAlias = useCallback(async (nextAliasRaw?: string) => {
    if (!aliasRecord) return false;
    const ns = aliasRecord?.metadata?.namespace;
    const name = aliasRecord?.metadata?.name;
    if (!ns || !name) {
      message.error('未能解析资源命名空间或名称');
      return false;
    }

    const next = String(nextAliasRaw || '').trim();
    const prev = String(aliasRecord?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    if (next === prev) {
      setAliasModalVisible(false);
      return true;
    }

    const hasAnnotations = !!aliasRecord?.metadata?.annotations;
    const hasPrev = !!aliasRecord?.metadata?.annotations?.['tower.io/alias'];
    const aliasPath = '/metadata/annotations/tower.io~1alias';

    const patchBody: any[] = [];
    if (!next) {
      if (hasPrev) patchBody.push({ op: 'remove', path: aliasPath });
    } else {
      if (!hasAnnotations) {
        patchBody.push({ op: 'add', path: '/metadata/annotations', value: { 'tower.io/alias': next } });
      } else {
        patchBody.push({ op: 'add', path: aliasPath, value: next });
      }
    }

    if (patchBody.length === 0) {
      setAliasModalVisible(false);
      return true;
    }

    setAliasSubmitting(true);
    try {
      await patchHarvesterContainerResource(cloudId, API_PATH, ns, name, patchBody);
      message.success(next ? '名称修改成功' : '已清空别名');
      setAliasModalVisible(false);
      setAliasRecord(null);
      aliasForm.resetFields();
      onRefresh();
      return true;
    } catch (e: any) {
      console.error(e);
      message.error(e?.message || '名称修改失败');
      return false;
    } finally {
      setAliasSubmitting(false);
    }
  }, [aliasRecord, cloudId, message, onRefresh, aliasForm]);

  // 查看 YAML
  const handleViewYaml = useCallback((record: any) => {
    try {
      const yamlStr = yaml.dump(record, { indent: 2, lineWidth: -1, noRefs: true });
      setYamlContent(yamlStr);
      setYamlModalVisible(true);
    } catch (e: any) {
      message.error('生成 YAML 失败: ' + e.message);
    }
  }, [message]);

  // 删除操作
  const handleDelete = useCallback(async (record: any) => {
    const namespace = record?.metadata?.namespace;
    const name = record?.metadata?.name;

    try {
      await deleteHarvesterService(cloudId, namespace, name);
      message.success('删除成功');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, message, onRefresh]);

  // 表格列定义
  const columns = useMemo(() => [
    {
      title: '名称',
      key: 'name',
      width: 180,
      ellipsis: true,
      render: (_: any, record: any) => {
        const alias = record?.metadata?.annotations?.['tower.io/alias'];
        const id = record?.metadata?.name || '';
        const hasAlias = !!alias;

        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{hasAlias ? alias : id}</span>
            <Tooltip title={hasAlias ? '修改别名' : '设置别名'}>
              <Button
                type="text"
                size="small"
                icon={<EditTwoTone />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenAliasModal(record);
                }}
              />
            </Tooltip>
          </span>
        );
      },
    },
    {
      title: 'ID',
      dataIndex: ['metadata', 'name'],
      key: 'id',
      width: 200,
      ellipsis: true,
      render: (id: string) => <span style={{ color: '#888', fontSize: 12 }}>{id}</span>,
    },
    {
      title: '命名空间',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      width: 150,
      ellipsis: true,
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '类型',
      key: 'type',
      width: 120,
      render: (_: any, record: any) => renderServiceType(record?.spec?.type || 'ClusterIP'),
    },
    {
      title: '集群IP',
      key: 'clusterIP',
      width: 130,
      render: (_: any, record: any) => {
        const ip = record?.spec?.clusterIP;
        if (!ip || ip === 'None') return <span style={{ color: '#999' }}>-</span>;
        return <code style={{ fontSize: 12 }}>{ip}</code>;
      },
    },
    {
      title: '端口',
      key: 'ports',
      width: 150,
      render: (_: any, record: any) => {
        const ports = record?.spec?.ports || [];
        if (ports.length === 0) return <span style={{ color: '#999' }}>-</span>;
        const portStr = ports.map((p: any) => {
          const port = p.port;
          const targetPort = p.targetPort;
          const protocol = p.protocol || 'TCP';
          if (p.nodePort) {
            return `${port}:${targetPort}(${protocol}) nodePort:${p.nodePort}`;
          }
          return `${port}:${targetPort}(${protocol})`;
        }).join(', ');
        return (
          <Tooltip title={portStr}>
            <span style={{ fontSize: 12 }}>{ports.length} 个端口</span>
          </Tooltip>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'creationTimestamp',
      width: 180,
      render: (v: string) => (
        <Tooltip title={formatTime(v)}>
          {calculateAge(v)}
        </Tooltip>
      ),
      sorter: (a: any, b: any) => new Date(a?.metadata?.creationTimestamp || 0).getTime() - new Date(b?.metadata?.creationTimestamp || 0).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, record: any) => {
        const items = [
          {
            key: 'yaml',
            label: '查看 YAML',
            icon: <EyeOutlined />,
            onClick: () => handleViewYaml(record),
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除 Service "${record?.metadata?.name}" 吗？`,
                okType: 'danger',
                onOk: () => handleDelete(record),
              });
            },
          },
        ];

        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], [handleOpenAliasModal, handleViewYaml, handleDelete, modal]);

  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(columns, 'harvester-containers-services');

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            className="toolbar-search"
            allowClear
            placeholder="名称/命名空间"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="筛选命名空间"
            allowClear
            showSearch
            optionFilterProp="label"
            value={nsValue || undefined}
            onChange={onNsChange}
            options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              onNsChange(undefined);
            }}
          >
            重置
          </button>
        </div>
        <div className="toolbar-actions">
          <Button type="primary" onClick={onCreateClick}>
            创建 Service
          </Button>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-services"
          />
          <Tooltip title="刷新">
            <Button
              type="default"
              icon={<ReloadOutlined />}
              onClick={() => onRefresh()}
            />
          </Tooltip>
        </div>
      </div>

      <Table
        className="std-table"
        bordered={false}
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
        }}
      />

      {/* 别名编辑弹窗 */}
      <Modal
        title="名称修改"
        open={aliasModalVisible}
        centered
        okText="保存"
        cancelText="取消"
        confirmLoading={aliasSubmitting}
        onOk={async () => {
          try {
            const values = await aliasForm.validateFields();
            await handleSubmitAlias(values?.alias);
          } catch {}
        }}
        onCancel={() => {
          if (aliasSubmitting) return;
          setAliasModalVisible(false);
          setAliasRecord(null);
          aliasForm.resetFields();
        }}
      >
        <Form form={aliasForm} layout="vertical">
          <Form.Item
            name="alias"
            label="名称"
            rules={[
              { max: 64, message: '别名最长 64 个字符' },
              { required: true, message: '请输入名称' },
            ]}
          >
            <Input
              autoFocus
              placeholder="请输入名称（留空则清空别名）"
              maxLength={64}
              onPressEnter={async () => {
                if (aliasSubmitting) return;
                try {
                  const values = await aliasForm.validateFields();
                  await handleSubmitAlias(values?.alias);
                } catch {}
              }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* YAML 查看弹窗 */}
      <Modal
        title="YAML 查看"
        open={yamlModalVisible}
        onCancel={() => setYamlModalVisible(false)}
        footer={null}
        width={800}
      >
        <YamlEditor
          value={yamlContent}
          onChange={() => {}}
          maxHeight={500}
          readOnly
        />
      </Modal>
    </div>
  );
};

/**
 * Service Section 主组件
 */
const ServicesSection: React.FC<Props> = ({
  services,
  loading,
  namespacesOptions,
  cloudId,
  nsValue,
  onNsChange,
  onRefresh,
  createDefaultNamespace,
}) => {
  const formDefaultNs = createDefaultNamespace ?? nsValue ?? namespacesOptions[0] ?? 'default';
  const [createModalVisible, setCreateModalVisible] = useState(false);

  // 打开创建弹窗
  const handleOpenCreate = useCallback(() => {
    setCreateModalVisible(true);
  }, []);

  // 根据 nsValue 过滤数据，并按创建时间倒序排序
  const filteredServices = useMemo(() => {
    let result = services;
    if (nsValue) result = result.filter((item: any) => item?.metadata?.namespace === nsValue);
    return result.sort((a: any, b: any) => new Date(b?.metadata?.creationTimestamp || 0).getTime() - new Date(a?.metadata?.creationTimestamp || 0).getTime());
  }, [services, nsValue]);

  return (
    <>
      <PageDetailSection asCard={false}>
        <ServiceTable
          data={filteredServices}
          loading={loading}
          cloudId={cloudId}
          onRefresh={onRefresh}
          namespacesOptions={namespacesOptions}
          nsValue={nsValue}
          onNsChange={onNsChange}
          onCreateClick={handleOpenCreate}
        />
      </PageDetailSection>

      {/* 创建 Service 弹窗 */}
      <ServiceFormModal
        visible={createModalVisible}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        defaultNamespace={formDefaultNs}
        onSuccess={() => {
          setCreateModalVisible(false);
          onRefresh(true);
        }}
        onCancel={() => setCreateModalVisible(false)}
      />
    </>
  );
};

export default ServicesSection;
