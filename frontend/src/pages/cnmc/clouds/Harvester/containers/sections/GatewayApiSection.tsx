import React, { useState, useMemo } from 'react';
import { Tabs, Alert, Button, message, Tag, Table, Popconfirm, Select } from 'antd';
import { ApiOutlined, DeleteOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import {
  deleteGateway,
  deleteHttpRoute,
  deleteGrpcRoute,
} from '../../../../../../services/harvesterApi';
import { GatewayFormModal, HTTPRouteFormModal, GRPCRouteFormModal } from '../components';

interface GatewayApiSectionProps {
  cloudId: string;
  gatewayApiStatus: { installed: boolean; resources: { gatewayClass: boolean; gateway: boolean; httpRoute: boolean; grpcRoute: boolean } } | null;
  gatewayClasses: any[];
  gateways: any[];
  httpRoutes: any[];
  grpcRoutes: any[];
  loading: boolean;
  namespacesOptions: string[];
  nsValue?: string;
  onNsChange?: (v?: string) => void;
  services?: any[];
  onRefresh: (force?: boolean) => void;
  createDefaultNamespace?: string;
}

/**
 * Gateway API 管理组件
 * 
 * 支持 Kubernetes Gateway API (下一代 Ingress)
 * 包含 GatewayClass, Gateway, HTTPRoute, GRPCRoute 四种资源
 */
const GatewayApiSection: React.FC<GatewayApiSectionProps> = ({
  cloudId,
  gatewayApiStatus,
  gatewayClasses,
  gateways,
  httpRoutes,
  grpcRoutes,
  loading,
  namespacesOptions,
  nsValue,
  onNsChange,
  services,
  onRefresh,
  createDefaultNamespace,
}) => {
  const formDefaultNs = createDefaultNamespace ?? nsValue ?? 'default';
  const [activeSubTab, setActiveSubTab] = useState('gatewayclasses');
  
  // 创建弹窗状态
  const [gatewayModalOpen, setGatewayModalOpen] = useState(false);
  const [httpRouteModalOpen, setHttpRouteModalOpen] = useState(false);
  const [grpcRouteModalOpen, setGrpcRouteModalOpen] = useState(false);

  // 检查 Gateway API 是否已安装
  const isInstalled = gatewayApiStatus?.installed ?? false;

  // GatewayClass 表格列
  const gatewayClassColumns = [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
    },
    {
      title: '控制器',
      dataIndex: ['spec', 'controllerName'],
      key: 'controller',
      render: (text: string) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: '描述',
      dataIndex: ['spec', 'description'],
      key: 'description',
      ellipsis: true,
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'createdAt',
      render: (text: string) => text ? new Date(text).toLocaleString() : '-',
    },
  ];

  // Gateway 表格列
  const gatewayColumns = [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
    },
    {
      title: '项目',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
    },
    {
      title: 'GatewayClass',
      dataIndex: ['spec', 'gatewayClassName'],
      key: 'gatewayClassName',
    },
    {
      title: '监听器',
      dataIndex: ['spec', 'listeners'],
      key: 'listeners',
      render: (listeners: any[]) => listeners?.length || 0,
    },
    {
      title: '状态',
      dataIndex: ['status', 'conditions'],
      key: 'status',
      render: (conditions: any[]) => {
        const ready = conditions?.find(c => c.type === 'Ready');
        return ready?.status === 'True' 
          ? <Tag color="green">Ready</Tag>
          : <Tag color="orange">Not Ready</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'createdAt',
      render: (text: string) => text ? new Date(text).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Popconfirm
          title="确定删除此 Gateway？"
          onConfirm={() => handleDeleteGateway(record)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="link" danger size="small" icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  // HTTPRoute 表格列
  const httpRouteColumns = [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
    },
    {
      title: '项目',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
    },
    {
      title: '主机名',
      dataIndex: ['spec', 'hostnames'],
      key: 'hostnames',
      ellipsis: true,
      render: (hostnames: string[]) => hostnames?.join(', ') || '*',
    },
    {
      title: '规则数',
      dataIndex: ['spec', 'rules'],
      key: 'rules',
      render: (rules: any[]) => rules?.length || 0,
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'createdAt',
      render: (text: string) => text ? new Date(text).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Popconfirm
          title="确定删除此 HTTPRoute？"
          onConfirm={() => handleDeleteHttpRoute(record)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="link" danger size="small" icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  // GRPCRoute 表格列
  const grpcRouteColumns = [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
    },
    {
      title: '项目',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
    },
    {
      title: '主机名',
      dataIndex: ['spec', 'hostnames'],
      key: 'hostnames',
      ellipsis: true,
      render: (hostnames: string[]) => hostnames?.join(', ') || '*',
    },
    {
      title: '规则数',
      dataIndex: ['spec', 'rules'],
      key: 'rules',
      render: (rules: any[]) => rules?.length || 0,
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'createdAt',
      render: (text: string) => text ? new Date(text).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Popconfirm
          title="确定删除此 GRPCRoute？"
          onConfirm={() => handleDeleteGrpcRoute(record)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="link" danger size="small" icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  // 删除 Gateway
  const handleDeleteGateway = async (record: any) => {
    try {
      await deleteGateway(cloudId, record.metadata.namespace, record.metadata.name);
      message.success('Gateway 删除成功');
      onRefresh(true);
    } catch (error: any) {
      message.error(`删除失败: ${error?.message || '未知错误'}`);
    }
  };

  // 删除 HTTPRoute
  const handleDeleteHttpRoute = async (record: any) => {
    try {
      await deleteHttpRoute(cloudId, record.metadata.namespace, record.metadata.name);
      message.success('HTTPRoute 删除成功');
      onRefresh(true);
    } catch (error: any) {
      message.error(`删除失败: ${error?.message || '未知错误'}`);
    }
  };

  // 删除 GRPCRoute
  const handleDeleteGrpcRoute = async (record: any) => {
    try {
      await deleteGrpcRoute(cloudId, record.metadata.namespace, record.metadata.name);
      message.success('GRPCRoute 删除成功');
      onRefresh(true);
    } catch (error: any) {
      message.error(`删除失败: ${error?.message || '未知错误'}`);
    }
  };

  const filteredGateways = useMemo(() => {
    if (!nsValue) return gateways;
    return gateways.filter((g: any) => g?.metadata?.namespace === nsValue);
  }, [gateways, nsValue]);

  const filteredHttpRoutes = useMemo(() => {
    if (!nsValue) return httpRoutes;
    return httpRoutes.filter((r: any) => r?.metadata?.namespace === nsValue);
  }, [httpRoutes, nsValue]);

  const filteredGrpcRoutes = useMemo(() => {
    if (!nsValue) return grpcRoutes;
    return grpcRoutes.filter((r: any) => r?.metadata?.namespace === nsValue);
  }, [grpcRoutes, nsValue]);

  // 如果 Gateway API 未安装，显示提示
  if (!loading && !isInstalled) {
    return (
      <Alert
        type="warning"
        showIcon
        icon={<ExclamationCircleOutlined />}
        message="Gateway API 未安装"
        description={
          <div>
            <p>当前集群未安装 Gateway API CRD。Gateway API 是 Kubernetes 下一代流量管理 API，将逐步取代 Ingress。</p>
            <p>请安装 Gateway API CRD 后刷新页面。安装方法：</p>
            <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
              kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.1.0/standard-install.yaml
            </pre>
            <Button type="primary" onClick={() => onRefresh(true)} style={{ marginTop: 8 }}>
              刷新检测
            </Button>
          </div>
        }
      />
    );
  }

  const tabItems = [
    {
      key: 'gatewayclasses',
      label: 'GatewayClass',
      children: (
        <Table
          className="std-table"
          scroll={{ x: true }}
          bordered={false}
          columns={gatewayClassColumns}
          dataSource={gatewayClasses}
          rowKey={(record) => record.metadata.uid || record.metadata.name}
          loading={loading}
          pagination={{
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      ),
    },
    {
      key: 'gateways',
      label: (
        <span>
          Gateway
          <Button
            type="primary"
            style={{ marginLeft: 8 }}
            onClick={() => setGatewayModalOpen(true)}
          >
            创建
          </Button>
        </span>
      ),
      children: (
        <Table
          className="std-table"
          scroll={{ x: true }}
          bordered={false}
          columns={gatewayColumns}
          dataSource={filteredGateways}
          rowKey={(record) => record.metadata.uid || `${record.metadata.namespace}/${record.metadata.name}`}
          loading={loading}
          pagination={{
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      ),
    },
    {
      key: 'httproutes',
      label: (
        <span>
          HTTP路由
          <Button
            type="primary"
            style={{ marginLeft: 8 }}
            onClick={() => setHttpRouteModalOpen(true)}
          >
            创建
          </Button>
        </span>
      ),
      children: (
        <Table
          className="std-table"
          scroll={{ x: true }}
          bordered={false}
          columns={httpRouteColumns}
          dataSource={filteredHttpRoutes}
          rowKey={(record) => record.metadata.uid || `${record.metadata.namespace}/${record.metadata.name}`}
          loading={loading}
          pagination={{
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      ),
    },
    {
      key: 'grpcroutes',
      label: (
        <span>
          gRPC路由
          <Button
            type="primary"
            style={{ marginLeft: 8 }}
            onClick={() => setGrpcRouteModalOpen(true)}
          >
            创建
          </Button>
        </span>
      ),
      children: (
        <Table
          className="std-table"
          scroll={{ x: true }}
          bordered={false}
          columns={grpcRouteColumns}
          dataSource={filteredGrpcRoutes}
          rowKey={(record) => record.metadata.uid || `${record.metadata.namespace}/${record.metadata.name}`}
          loading={loading}
          pagination={{
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      ),
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      onRefresh={onRefresh}
      refreshLoading={loading}
      toolbarLeft={
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="筛选项目"
          value={nsValue || undefined}
          onChange={(v) => onNsChange?.(v)}
          options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
          className="toolbar-filter-sm"
        />
      }
    >
      <Alert
        type="info"
        showIcon
        icon={<ApiOutlined />}
        message="Gateway API 是 Kubernetes 下一代流量管理 API，将逐步取代 Ingress（Ingress-nginx 将于 2026 年 3 月停止维护）。"
        style={{ marginBottom: 16 }}
      />
      <Tabs type="line" activeKey={activeSubTab} onChange={setActiveSubTab} items={tabItems} />

      {/* Gateway 创建弹窗 */}
      <GatewayFormModal
        visible={gatewayModalOpen}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        gatewayClasses={gatewayClasses}
        defaultNamespace={formDefaultNs}
        onSuccess={() => {
          setGatewayModalOpen(false);
          onRefresh(true);
        }}
        onCancel={() => setGatewayModalOpen(false)}
      />

      {/* HTTPRoute 创建弹窗 */}
      <HTTPRouteFormModal
        visible={httpRouteModalOpen}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        gateways={gateways}
        services={services}
        defaultNamespace={formDefaultNs}
        onSuccess={() => {
          setHttpRouteModalOpen(false);
          onRefresh(true);
        }}
        onCancel={() => setHttpRouteModalOpen(false)}
      />

      {/* GRPCRoute 创建弹窗 */}
      <GRPCRouteFormModal
        visible={grpcRouteModalOpen}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        gateways={gateways}
        services={services}
        defaultNamespace={formDefaultNs}
        onSuccess={() => {
          setGrpcRouteModalOpen(false);
          onRefresh(true);
        }}
        onCancel={() => setGrpcRouteModalOpen(false)}
      />
    </PageDetailSection>
  );
};

export default GatewayApiSection;