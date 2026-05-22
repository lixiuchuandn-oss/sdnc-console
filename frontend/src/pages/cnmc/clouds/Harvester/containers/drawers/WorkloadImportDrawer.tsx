/**
 * 从工作负载导入：列表/拉取/选择与「导入」确认均在此文件内（高内聚）。
 * 默认导出抽屉；若需 `Modal` 壳，在本文件导入命名导出 `WorkloadImportPicker` 即可。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { App, Button, Drawer, Empty, Flex, Input, Spin, Table, Tabs, Tag, Space } from 'antd';
import {
  fetchHarvesterDeployments,
  fetchHarvesterStatefulSets,
  fetchHarvesterDaemonSets,
} from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface WorkloadInfo {
  name: string;
  namespace: string;
  type: 'Deployment' | 'StatefulSet' | 'DaemonSet';
  labels: Record<string, string>;
  selector: Record<string, string>;
  ports: Array<{ name: string; port: number; protocol?: string }>;
  displayName: string;
}

export type WorkloadImportFooterRender = (ctx: {
  selectedRow: WorkloadInfo | null;
  onCancel: () => void;
  onImport: () => void;
}) => React.ReactNode;

export interface WorkloadImportPickerProps {
  open: boolean;
  cloudId: string;
  namespace?: string;
  onCancel: () => void;
  onPick: (workload: WorkloadInfo) => void;
  renderFooter: WorkloadImportFooterRender;
}

export interface WorkloadImportDrawerProps {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  namespace?: string;
  onImport: (workload: WorkloadInfo) => void;
}

// ---------------------------------------------------------------------------
// 纯函数（与 React 无关）
// ---------------------------------------------------------------------------

function extractPortsFromWorkload(workload: any): Array<{ name: string; port: number; protocol?: string }> {
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
}

function toWorkloadInfo(item: any, type: WorkloadInfo['type']): WorkloadInfo {
  return {
    name: item.metadata.name,
    namespace: item.metadata.namespace,
    type,
    labels: item.metadata.labels || {},
    selector: item.spec.selector?.matchLabels || {},
    ports: extractPortsFromWorkload(item),
    displayName: item.metadata?.annotations?.['tower.io/alias'] || item.metadata.name,
  };
}

// ---------------------------------------------------------------------------
// 选择器主体（抽屉与 Modal 共用）
// ---------------------------------------------------------------------------

export const WorkloadImportPicker: React.FC<WorkloadImportPickerProps> = ({
  open,
  cloudId,
  namespace,
  onCancel,
  onPick,
  renderFooter,
}) => {
  const { message } = App.useApp();
  const [activeTab, setActiveTab] = useState('Deployment');
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [deployments, setDeployments] = useState<unknown[]>([]);
  const [statefulSets, setStatefulSets] = useState<unknown[]>([]);
  const [daemonSets, setDaemonSets] = useState<unknown[]>([]);
  const [selectedRow, setSelectedRow] = useState<WorkloadInfo | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const ns = namespace || undefined;
        const [deployRes, stsRes, dsRes] = await Promise.all([
          fetchHarvesterDeployments(cloudId, ns),
          fetchHarvesterStatefulSets(cloudId, ns),
          fetchHarvesterDaemonSets(cloudId, ns),
        ]);

        const filterSystem = (items: unknown[]) => {
          if (!Array.isArray(items)) return [];
          return items.filter((item: any) => !isSystemNamespace(item.metadata?.namespace || ''));
        };

        if (cancelled) return;
        setDeployments(filterSystem(deployRes?.data?.items || deployRes?.items || []));
        setStatefulSets(filterSystem(stsRes?.data?.items || stsRes?.items || []));
        setDaemonSets(filterSystem(dsRes?.data?.items || dsRes?.items || []));
      } catch (error) {
        console.error('Failed to fetch workloads:', error);
        if (!cancelled) message.error('获取工作负载列表失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    setSelectedRow(null);
    setKeyword('');

    return () => {
      cancelled = true;
    };
  }, [open, cloudId, namespace, message]);

  const currentData = useMemo(() => {
    let data: unknown[] = [];
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

    return data.map((item) => toWorkloadInfo(item, activeTab as WorkloadInfo['type']));
  }, [activeTab, deployments, statefulSets, daemonSets, keyword]);

  const columns = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'displayName',
        key: 'displayName',
        render: (text: string, record: WorkloadInfo) => (
          <Space>
            <span>{text}</span>
            {record.displayName !== record.name ? (
              <Tag color="blue" style={{ marginLeft: 4 }}>
                {record.name}
              </Tag>
            ) : null}
          </Space>
        ),
      },
      {
        title: '项目',
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
              <Tag key={k} color="green">
                {k}={v}
              </Tag>
            ))}
          </Space>
        ),
      },
      {
        title: '端口数',
        dataIndex: 'ports',
        key: 'ports',
        width: 80,
        render: (ports: unknown[]) => ports.length || '-',
      },
    ],
    [],
  );

  const handleImport = () => {
    if (!selectedRow) {
      message.warning('请选择工作负载');
      return;
    }
    onPick(selectedRow);
  };

  return (
    <>
      <Spin spinning={loading}>
        <Input
          placeholder="搜索工作负载名称"
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
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
          rowKey={(r) => `${r.namespace}/${r.name}/${r.type}`}
          columns={columns}
          dataSource={currentData}
          pagination={{ pageSize: 10, size: 'small', showTotal: (total) => `共 ${total} 条` }}
          scroll={{ y: 400 }}
          locale={{ emptyText: <Empty description="暂无工作负载" /> }}
          onRow={(record) => ({
            onClick: () => setSelectedRow(record),
            style: {
              cursor: 'pointer',
              background:
                selectedRow?.name === record.name &&
                selectedRow?.namespace === record.namespace &&
                selectedRow?.type === record.type
                  ? '#e6f7ff'
                  : undefined,
            },
          })}
        />
      </Spin>
      {renderFooter({ selectedRow, onCancel, onImport: handleImport })}
    </>
  );
};

// ---------------------------------------------------------------------------
// 抽屉
// ---------------------------------------------------------------------------

const workloadImportDrawerFooter: WorkloadImportFooterRender = ({ selectedRow, onCancel, onImport }) => (
  <Flex justify="flex-end" gap="small" style={{ marginTop: 16 }}>
    <Button onClick={onCancel}>取消</Button>
    <Button type="primary" disabled={!selectedRow} onClick={onImport}>
      导入
    </Button>
  </Flex>
);

const WorkloadImportDrawer: React.FC<WorkloadImportDrawerProps> = ({
  open,
  onClose,
  cloudId,
  namespace,
  onImport,
}) => (
  <Drawer title="工作负载导入" open={open} onClose={onClose} width={800} destroyOnHidden footer={null}>
    <WorkloadImportPicker
      open={open}
      cloudId={cloudId}
      namespace={namespace}
      onCancel={onClose}
      onPick={(w) => {
        onImport(w);
        onClose();
      }}
      renderFooter={workloadImportDrawerFooter}
    />
  </Drawer>
);

export default WorkloadImportDrawer;
