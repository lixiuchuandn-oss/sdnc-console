/**
 * ==============================================================================
 * 模块名称: 工作负载选择弹窗 (WorkloadSelectModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/WorkloadSelectModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 用于选择工作负载（Deployment/StatefulSet/DaemonSet），
 * 自动提取 selector 和端口信息，用于 Service 创建时快速导入。
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Table, Input, Tabs, Empty, Spin, Tag, Space, App } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import {
  fetchHarvesterDeployments,
  fetchHarvesterStatefulSets,
  fetchHarvesterDaemonSets,
} from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';

export interface WorkloadInfo {
  name: string;
  namespace: string;
  type: 'Deployment' | 'StatefulSet' | 'DaemonSet';
  labels: Record<string, string>;
  selector: Record<string, string>;
  ports: Array<{ name: string; port: number; protocol?: string }>;
  displayName: string;
}

interface WorkloadSelectModalProps {
  open: boolean;
  cloudId: string;
  namespace?: string;
  onCancel: () => void;
  onOk: (workload: WorkloadInfo) => void;
}

const WORKLOAD_TYPE_MAP: Record<string, string> = {
  Deployment: 'Deployment',
  StatefulSet: 'StatefulSet',
  DaemonSet: 'DaemonSet',
};

const WorkloadSelectModal: React.FC<WorkloadSelectModalProps> = ({
  open,
  cloudId,
  namespace,
  onCancel,
  onOk,
}) => {
  const { message } = App.useApp();
  const [activeTab, setActiveTab] = useState('Deployment');
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [deployments, setDeployments] = useState<any[]>([]);
  const [statefulSets, setStatefulSets] = useState<any[]>([]);
  const [daemonSets, setDaemonSets] = useState<any[]>([]);
  const [selectedRow, setSelectedRow] = useState<WorkloadInfo | null>(null);

  const fetchWorkloads = async () => {
    setLoading(true);
    try {
      const ns = namespace || undefined;
      const [deployRes, stsRes, dsRes] = await Promise.all([
        fetchHarvesterDeployments(cloudId, ns),
        fetchHarvesterStatefulSets(cloudId, ns),
        fetchHarvesterDaemonSets(cloudId, ns),
      ]);

      const filterSystem = (items: any[]) => {
        if (!Array.isArray(items)) return [];
        return items.filter((item: any) => !isSystemNamespace(item.metadata?.namespace || ''));
      };

      setDeployments(filterSystem(deployRes?.data?.items || deployRes?.items || []));
      setStatefulSets(filterSystem(stsRes?.data?.items || stsRes?.items || []));
      setDaemonSets(filterSystem(dsRes?.data?.items || dsRes?.items || []));
    } catch (error) {
      console.error('Failed to fetch workloads:', error);
      message.error('获取工作负载列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchWorkloads();
      setSelectedRow(null);
      setKeyword('');
    }
  }, [open, cloudId, namespace]);

  const extractPortsFromWorkload = (workload: any): Array<{ name: string; port: number; protocol?: string }> => {
    const portsMap = new Map<string, { name: string; port: number; protocol?: string }>();
    const containers = workload?.spec?.template?.spec?.containers || [];

    containers.forEach((container: any) => {
      const containerPorts = container.ports || [];
      containerPorts.forEach((p: any) => {
        const key = p.name ? `${p.name}:${p.containerPort}` : `port:${p.containerPort}`;
        if (!portsMap.has(key)) {
          portsMap.set(key, {
            name: p.name || '',
            port: p.containerPort,
            protocol: p.protocol,
          });
        }
      });
    });

    return Array.from(portsMap.values());
  };

  const convertToWorkloadInfo = (item: any, type: 'Deployment' | 'StatefulSet' | 'DaemonSet'): WorkloadInfo => {
    return {
      name: item.metadata.name,
      namespace: item.metadata.namespace,
      type,
      labels: item.metadata.labels || {},
      selector: item.spec.selector?.matchLabels || {},
      ports: extractPortsFromWorkload(item),
      displayName: item.metadata?.annotations?.['tower.io/alias'] || item.metadata.name,
    };
  };

  const currentData = useMemo(() => {
    let data: any[] = [];
    if (activeTab === 'Deployment') data = deployments;
    else if (activeTab === 'StatefulSet') data = statefulSets;
    else if (activeTab === 'DaemonSet') data = daemonSets;

    if (keyword) {
      const lowerKeyword = keyword.toLowerCase();
      data = data.filter((item: any) => {
        const name = item.metadata.name.toLowerCase();
        const displayName = (item.metadata?.annotations?.['tower.io/alias'] || '').toLowerCase();
        return name.includes(lowerKeyword) || displayName.includes(lowerKeyword);
      });
    }

    return data.map(item => convertToWorkloadInfo(item, activeTab as any));
  }, [activeTab, deployments, statefulSets, daemonSets, keyword]);

  const columns = [
    {
      title: '名称',
      dataIndex: 'displayName',
      key: 'displayName',
      render: (text: string, record: WorkloadInfo) => (
        <Space>
          <span>{text}</span>
          {record.displayName !== record.name && (
            <Tag color="blue" style={{ marginLeft: 4 }}>{record.name}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '命名空间',
      dataIndex: 'namespace',
      key: 'namespace',
      width: 120,
    },
    {
      title: '选择器',
      dataIndex: 'selector',
      key: 'selector',
      width: 200,
      render: (selector: Record<string, string>) => (
        <Space size={4} wrap>
          {Object.entries(selector).map(([k, v]) => (
            <Tag key={k} color="green">{k}={v}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '端口数',
      dataIndex: 'ports',
      key: 'ports',
      width: 80,
      render: (ports: any[]) => ports.length || '-',
    },
  ];

  const handleOk = () => {
    if (selectedRow) {
      onOk(selectedRow);
    }
  };

  return (
    <Modal
      title="从工作负载导入"
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okButtonProps={{ disabled: !selectedRow }}
      width={800}
      destroyOnClose
    >
      <Spin spinning={loading}>
        <Input
          placeholder="搜索工作负载名称"
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ marginBottom: 12 }}
          allowClear
        />
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'Deployment', label: `Deployment (${deployments.length})` },
            { key: 'StatefulSet', label: `StatefulSet (${statefulSets.length})` },
            { key: 'DaemonSet', label: `DaemonSet (${daemonSets.length})` },
          ]}
        />
        <Table
          size="small"
          rowKey="name"
          columns={columns}
          dataSource={currentData}
          pagination={{ pageSize: 10, size: 'small', showTotal: (total) => `共 ${total} 条` }}
          scroll={{ y: 400 }}
          locale={{ emptyText: <Empty description="暂无工作负载" /> }}
          onRow={(record) => ({
            onClick: () => setSelectedRow(record),
            style: {
              cursor: 'pointer',
              background: selectedRow?.name === record.name && selectedRow?.namespace === record.namespace ? '#e6f7ff' : undefined,
            },
          })}
        />
      </Spin>
    </Modal>
  );
};

export default WorkloadSelectModal;
