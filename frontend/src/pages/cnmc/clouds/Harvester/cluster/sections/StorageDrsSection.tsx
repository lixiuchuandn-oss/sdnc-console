/**
 * 集群 · 存储 DRS（SDRS）M1：策略配置 + 任务日志 + 手动迁盘
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from 'components/PageDetailSection';
import SharedToolbar from 'components/SharedToolbar';
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

const { Text } = Typography;

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

function filterTasks(rows: SdrsTaskRow[], keyword: string): SdrsTaskRow[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return rows;
  return rows.filter((r) => {
    const hay = [r.vmNamespace, r.vmName, r.pvcName, r.srcPool, r.dstPool, r.phase, r.message]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(kw);
  });
}

const StorageDrsSection: React.FC<StorageDrsSectionProps> = ({ cloudId, checkPerm }) => {
  const canRead = checkPerm('clouds.storage-drs:read') || checkPerm('clouds.unified-storage:read');
  const canWrite =
    checkPerm('clouds.storage-drs:write') || checkPerm('clouds.unified-storage:write');

  const { loading, overview, error, reload } = useStorageDrsData(cloudId, canRead);
  const [activeTab, setActiveTab] = useState('policy');
  const [policySaving, setPolicySaving] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [taskKeyword, setTaskKeyword] = useState('');
  const [form] = Form.useForm<SdrsPolicy>();

  const policy = overview?.policy;
  const tasks = useMemo(() => overview?.tasksRecent ?? [], [overview?.tasksRecent]);
  const cephReady = overview?.cephReady;
  const filteredTasks = useMemo(() => filterTasks(tasks, taskKeyword), [tasks, taskKeyword]);

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
        title: '源存储池 / 卷',
        key: 'src',
        render: (_: unknown, r) => `${r.srcPool}/${r.srcImage}`,
      },
      {
        title: '目标存储池 / 卷',
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
      { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt' },
      {
        title: '完成时间',
        dataIndex: 'finishedAt',
        key: 'finishedAt',
        render: (v: string | null) => v || '—',
      },
    ];
  }, []);

  const policyToolbarRight = useMemo(
    () => (
      <div className="toolbar-actions">
        <WriteGuard canWrite={canWrite}>
          <Button type="primary" loading={policySaving} onClick={() => void handleSavePolicy()}>
            保存策略
          </Button>
        </WriteGuard>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
      </div>
    ),
    [canWrite, handleRefresh, handleSavePolicy, loading, policySaving],
  );

  const tasksToolbarLeft = useMemo(
    () => (
      <>
        <Input
          allowClear
          placeholder="VM / PVC / 存储池 / 阶段"
          suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          value={taskKeyword}
          onChange={(e) => setTaskKeyword(e.target.value)}
          className="toolbar-search"
        />
        <button type="button" className="toolbar-reset-btn" onClick={() => setTaskKeyword('')}>
          重置
        </button>
      </>
    ),
    [taskKeyword],
  );

  const tasksToolbarRight = useMemo(
    () => (
      <div className="toolbar-actions">
        <WriteGuard canWrite={canWrite}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setMigrateOpen(true)}>
            手动迁移
          </Button>
        </WriteGuard>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
      </div>
    ),
    [canWrite, handleRefresh, loading],
  );

  const tabItems = useMemo(
    () => [
      {
        key: 'policy',
        label: '策略',
        children: (
          <>
            <SharedToolbar right={policyToolbarRight} style={{ marginBottom: 16 }} />
            {cephReady && !cephReady.toolboxAvailable ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message={cephReady.message || '存储运维工具未就绪，手动迁盘可能失败'}
              />
            ) : null}
            <Form
              form={form}
              layout="horizontal"
              labelCol={{ flex: '120px' }}
              wrapperCol={{ flex: 'auto' }}
              labelAlign="left"
              colon={false}
              disabled={!canWrite}
              requiredMark={false}
            >
              <Card title="基本设置" size="small" style={{ marginBottom: 16 }}>
                <Row gutter={[24, 0]}>
                  <Col xs={24} lg={12}>
                    <Form.Item
                      name="enabled"
                      label="启用存储智能调度"
                      valuePropName="checked"
                      tooltip="关闭后仅保留任务记录与手动迁移，不触发自动调度"
                    >
                      <Switch checkedChildren="开" unCheckedChildren="关" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Form.Item
                      name="mode"
                      label="调度模式"
                      tooltip="M1 支持手动与策略配置；全自动调度将在后续版本开放"
                    >
                      <Select
                        style={{ maxWidth: 280 }}
                        options={(Object.entries(SDRS_MODE_LABELS) as [SdrsMode, string][]).map(
                          ([value, label]) => ({ value, label }),
                        )}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>

              <Card title="触发阈值" size="small" style={{ marginBottom: 16 }}>
                <Row gutter={[24, 0]}>
                  <Col xs={24} lg={12}>
                    <Form.Item
                      name="capacityThresholdPct"
                      label="容量阈值"
                      tooltip="存储池使用率超过该比例时可触发迁盘建议（半自动/自动模式）"
                    >
                      <InputNumber
                        min={50}
                        max={99}
                        precision={0}
                        addonAfter="%"
                        style={{ width: 160 }}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Form.Item
                      name="latencyThresholdMs"
                      label="时延阈值"
                      tooltip="块设备 IO 时延超过该值时可触发迁盘建议（半自动/自动模式）"
                    >
                      <InputNumber
                        min={1}
                        max={500}
                        precision={0}
                        addonAfter="ms"
                        style={{ width: 160 }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>

              <Card
                title="存储就绪状态"
                size="small"
                extra={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    迁盘所需集群组件是否可用
                  </Text>
                }
              >
                <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                  <Descriptions.Item label="存储监控">
                    {cephReady?.dashboardAvailable ? (
                      <Tag color="success">可用</Tag>
                    ) : (
                      <Tag>不可用</Tag>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="迁盘工具">
                    {cephReady?.toolboxAvailable ? (
                      <Text>
                        {cephReady.toolboxNamespace}/{cephReady.toolboxPod}
                      </Text>
                    ) : (
                      <Text type="secondary">未检测到运维工具 Pod</Text>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="存储池数量">
                    {overview?.pools?.length ?? 0}
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </Form>
          </>
        ),
      },
      {
        key: 'tasks',
        label: `任务日志 (${tasks.length})`,
        children: (
          <>
            <SharedToolbar
              left={tasksToolbarLeft}
              right={tasksToolbarRight}
              style={{ marginBottom: 16 }}
            />
            <Table
              className="std-table"
              bordered={false}
              rowKey="id"
              loading={loading}
              columns={taskColumns}
              dataSource={filteredTasks}
              scroll={{ x: true }}
              pagination={{ showTotal: (total) => `共 ${total} 条`, size: 'small', pageSize: 20 }}
            />
          </>
        ),
      },
    ],
    [
      canWrite,
      cephReady,
      filteredTasks,
      form,
      loading,
      overview?.pools?.length,
      policyToolbarRight,
      taskColumns,
      tasks.length,
      tasksToolbarLeft,
      tasksToolbarRight,
    ],
  );

  if (!canRead) {
    return (
      <PageDetailSection title="存储智能调度">
        <Alert type="warning" showIcon message="无权限查看存储智能调度" />
      </PageDetailSection>
    );
  }

  return (
    <>
      <PageDetailSection asCard={false}>
        {error ? (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
        ) : null}

        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
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
