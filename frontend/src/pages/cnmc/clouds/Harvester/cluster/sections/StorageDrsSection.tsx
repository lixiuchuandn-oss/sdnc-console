/**
 * 集群 · 存储 DRS（SDRS）M1：策略配置 + 任务日志 + 手动迁盘
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  InputNumber,
  Row,
  Select,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from 'components/PageDetailSection';
import WriteGuard from 'components/WriteGuard';
import {
  SDRS_MODE_LABELS,
  SDRS_TASK_PHASE_LABELS,
  updateSdrsPolicy,
  type SdrsMode,
  type SdrsPolicy,
  type SdrsTaskRow,
} from 'services/harvester/storageDrs';
import StorageDrsMigrateModal from '../modals/StorageDrsMigrateModal';
import { useStorageDrsData } from '../hooks/useStorageDrsData';

export type StorageDrsSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

function phaseTagColor(phase: SdrsTaskRow['phase']): string {
  switch (phase) {
    case 'succeeded':
      return 'success';
    case 'failed':
    case 'cancelled':
      return 'error';
    case 'pending':
      return 'default';
    default:
      return 'processing';
  }
}

const StorageDrsSection: React.FC<StorageDrsSectionProps> = ({ cloudId, checkPerm }) => {
  const canRead = checkPerm('clouds.storage-drs:read') || checkPerm('clouds.unified-storage:read');
  const canWrite =
    checkPerm('clouds.storage-drs:write') || checkPerm('clouds.unified-storage:write');

  const { loading, overview, error, reload } = useStorageDrsData(cloudId, canRead);
  const [activeTab, setActiveTab] = useState('policy');
  const [policySaving, setPolicySaving] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [form] = Form.useForm<SdrsPolicy>();

  const policy = overview?.policy;
  const tasks = overview?.tasksRecent ?? [];
  const cephReady = overview?.cephReady;
  const summary = overview?.summary;

  React.useEffect(() => {
    if (!policy) return;
    form.setFieldsValue(policy);
  }, [policy, form]);

  const handleRefresh = useCallback(() => {
    void reload(true);
  }, [reload]);

  const handleSavePolicy = useCallback(async () => {
    if (!canWrite) return;
    try {
      const values = await form.validateFields();
      setPolicySaving(true);
      await updateSdrsPolicy(cloudId, values);
      message.success('策略已保存');
      void reload(true);
    } catch (e: unknown) {
      const err = e as { message?: string; errorFields?: unknown[] };
      if (err?.errorFields) return;
      message.error(err?.message || '保存失败');
    } finally {
      setPolicySaving(false);
    }
  }, [canWrite, cloudId, form, reload]);

  const taskColumns = useMemo((): ColumnsType<SdrsTaskRow> => {
    return [
      {
        title: 'VM',
        key: 'vm',
        fixed: 'left',
        render: (_: unknown, r) => `${r.vmNamespace}/${r.vmName}`,
      },
      { title: 'PVC', dataIndex: 'pvcName', key: 'pvcName' },
      {
        title: '源 Pool / Image',
        key: 'src',
        render: (_: unknown, r) => `${r.srcPool}/${r.srcImage}`,
      },
      {
        title: '目标 Pool / Image',
        key: 'dst',
        render: (_: unknown, r) => `${r.dstPool}/${r.dstImage}`,
      },
      {
        title: '阶段',
        dataIndex: 'phase',
        key: 'phase',
        render: (p: SdrsTaskRow['phase']) => (
          <Tag color={phaseTagColor(p)}>{SDRS_TASK_PHASE_LABELS[p] || p}</Tag>
        ),
      },
      {
        title: '说明',
        dataIndex: 'message',
        key: 'message',
        ellipsis: true,
        render: (v: string | null) => v || '—',
      },
      { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
      {
        title: '完成时间',
        dataIndex: 'finishedAt',
        key: 'finishedAt',
        width: 180,
        render: (v: string | null) => v || '—',
      },
    ];
  }, []);

  if (!canRead) {
    return <Alert type="warning" showIcon message="无权限查看存储 DRS" />;
  }

  const policyTab = (
    <div>
      {cephReady && !cephReady.toolboxAvailable ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={cephReady.message || 'Ceph toolbox 不可用，手动迁盘可能失败'}
        />
      ) : null}
      <Form form={form} layout="vertical" disabled={!canWrite}>
        <Row gutter={24}>
          <Col xs={24} md={8}>
            <Form.Item name="enabled" label="启用存储 DRS" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="mode" label="调度模式">
              <Select
                options={(Object.entries(SDRS_MODE_LABELS) as [SdrsMode, string][]).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={24}>
          <Col xs={24} md={8}>
            <Form.Item name="capacityThresholdPct" label="容量阈值（%）">
              <InputNumber min={50} max={99} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="latencyThresholdMs" label="时延阈值（ms）">
              <InputNumber min={1} max={500} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="M1 范围：策略配置、任务日志与手动选盘迁移；全自动调度与 DPM 联动将在后续版本提供。"
        />
        <WriteGuard granted={canWrite}>
          <Button type="primary" loading={policySaving} onClick={() => void handleSavePolicy()}>
            保存策略
          </Button>
        </WriteGuard>
      </Form>
    </div>
  );

  const tasksTab = (
    <Table
      className="std-table"
      bordered={false}
      rowKey="id"
      loading={loading}
      columns={taskColumns}
      dataSource={tasks}
      scroll={{ x: true }}
      pagination={{ size: 'small', pageSize: 20 }}
    />
  );

  return (
    <>
      <PageDetailSection
        title="存储 DRS"
        loading={loading}
        onRefresh={handleRefresh}
        toolbarRight={
          <WriteGuard granted={canWrite}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setMigrateOpen(true)}>
              手动迁移
            </Button>
          </WriteGuard>
        }
      >
        {error ? (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
        ) : null}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic title="近期任务" value={summary?.totalTasks ?? 0} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic title="运行中" value={summary?.running ?? 0} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="失败"
                value={summary?.failed ?? 0}
                valueStyle={{ color: '#cf1322' }}
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="Ceph 池"
                value={overview?.pools?.length ?? 0}
                suffix={cephReady?.dashboardAvailable ? '' : '(Dashboard 不可用)'}
              />
            </Card>
          </Col>
        </Row>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'policy', label: '策略', children: policyTab },
            { key: 'tasks', label: '任务日志', children: tasksTab },
          ]}
        />
      </PageDetailSection>

      <StorageDrsMigrateModal
        open={migrateOpen}
        cloudId={cloudId}
        onClose={() => setMigrateOpen(false)}
        onSuccess={() => void reload(true)}
      />
    </>
  );
};

export default StorageDrsSection;
