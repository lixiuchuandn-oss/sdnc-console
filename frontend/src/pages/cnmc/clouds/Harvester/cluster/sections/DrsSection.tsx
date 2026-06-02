/**
 * 集群 · DRS 管理
 * MetricRule CR + DRS 迁移记录（带 hci.manager.system/auto-scheduled-fingerprint 的 VMIM）。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Input, Row, Select, Statistic, Table, Tabs, message } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import SharedToolbar from 'components/SharedToolbar';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { abortHarvesterMigration } from 'services/harvester/vm';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import MetricRuleConfigDrawer from '../drawers/MetricRuleConfigDrawer';
import { useMetricRuleCrActions } from '../hooks/useMetricRuleCrActions';
import { buildMetricRulesTableColumns } from '../lib/drsMetricRulesTableColumns';
import {
  filterMetricRulesForTable,
  metricRuleRowFields,
  type MetricRuleTableRow,
} from '../lib/drsMetricRuleUtils';
import { useDrsSectionData } from '../hooks/useDrsSectionData';
import {
  buildMigrationsTableColumns,
  type MigrationsTableActions,
} from '../../ecs/lib/migrationsTableColumns';
import {
  buildMigrationNamespaceOptions,
  buildMigrationStatusOptions,
  filterMigrationsForTable,
  migrationRowFields,
  type MigrationTableRow,
} from '../../ecs/lib/migrationsSectionUtils';

const METRIC_RULES_TABLE_KEY = 'harvester_drs_metric_rules_table';
const REALLOCATION_TABLE_KEY = 'harvester_drs_reallocation_migrations_table';

export type DrsSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  vms?: unknown[];
  isTenant?: boolean;
};

const DrsSection: React.FC<DrsSectionProps> = ({
  cloudId,
  checkPerm,
  vms,
  isTenant = false,
}) => {
  const [activeTab, setActiveTab] = useState('metricRules');
  const [metricKeyword, setMetricKeyword] = useState('');
  const [reallocationKeyword, setReallocationKeyword] = useState('');
  const [reallocationStatusFilter, setReallocationStatusFilter] = useState('');
  const [reallocationNamespaceFilter, setReallocationNamespaceFilter] = useState('');

  const canRead = checkPerm('clouds.drs:read') || checkPerm('clouds.migrations:read');
  const canManageMetricRule = checkPerm('clouds.drs:write');
  const canWriteMigration =
    checkPerm('clouds.migrations:write') || checkPerm('clouds.ecs:write');

  const [metricRuleDrawerOpen, setMetricRuleDrawerOpen] = useState(false);
  const [editingMetricRule, setEditingMetricRule] = useState<MetricRuleTableRow | null>(null);
  const [metricRuleSaving, setMetricRuleSaving] = useState(false);

  const {
    loading,
    summary,
    metricRules,
    metricRulesAvailable,
    metricRulesError,
    reallocationMigrations,
    loadAll,
  } = useDrsSectionData(cloudId, canRead);

  const {
    yamlDrawerOpen,
    yamlViewLink,
    yamlDrawerTitle,
    openYamlDrawer,
    closeYamlDrawer,
  } = useHarvesterResourceLinkYamlDrawer(cloudId);

  const handleRefresh = useCallback(() => {
    void loadAll(true);
  }, [loadAll]);

  const closeMetricRuleDrawer = useCallback(() => {
    setMetricRuleDrawerOpen(false);
    setEditingMetricRule(null);
  }, []);

  const openCreateMetricRule = useCallback(() => {
    setEditingMetricRule(null);
    setMetricRuleDrawerOpen(true);
  }, []);

  const openEditMetricRule = useCallback((record: MetricRuleTableRow) => {
    setEditingMetricRule(record);
    setMetricRuleDrawerOpen(true);
  }, []);

  const { handleDeleteMetricRule, handleSubmitMetricRule } = useMetricRuleCrActions({
    cloudId,
    canManageMetricRule,
    editingMetricRule,
    loadAll,
    closeConfigDrawer: closeMetricRuleDrawer,
    setConfigSaving: setMetricRuleSaving,
  });

  const handleOpenMetricRuleYaml = useCallback(
    (record: MetricRuleTableRow) => {
      openYamlDrawer({ ...record, kind: 'MetricRule' }, { title: 'MetricRule YAML' });
    },
    [openYamlDrawer],
  );

  const handleOpenMigrationYaml = useCallback(
    (record: MigrationTableRow) => {
      openYamlDrawer(
        { ...record, kind: 'VirtualMachineInstanceMigration' },
        { title: 'DRS 迁移记录 YAML' },
      );
    },
    [openYamlDrawer],
  );

  const handleAbortMigration = useCallback(
    async (record: MigrationTableRow) => {
      try {
        const row = record as { spec?: { vmiName?: string }; metadata?: { namespace?: string } };
        const vmName = row.spec?.vmiName;
        const namespace = row.metadata?.namespace;
        if (!vmName || !namespace) {
          message.error('无法解析关联的虚拟机信息');
          return;
        }
        await abortHarvesterMigration(cloudId, `${namespace}/${vmName}`);
        message.success('已发送取消请求');
        void loadAll(true);
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '取消失败');
      }
    },
    [cloudId, loadAll],
  );

  const filteredMetricRules = useMemo(
    () => filterMetricRulesForTable(metricRules as MetricRuleTableRow[], metricKeyword),
    [metricKeyword, metricRules],
  );

  const filteredReallocationMigrations = useMemo(
    () =>
      filterMigrationsForTable(
        reallocationMigrations,
        {
          keyword: reallocationKeyword,
          statusFilter: reallocationStatusFilter,
          namespaceFilter: reallocationNamespaceFilter,
          triggerFilter: '',
        },
        vms,
      ),
    [
      reallocationKeyword,
      reallocationMigrations,
      reallocationNamespaceFilter,
      reallocationStatusFilter,
      vms,
    ],
  );

  const reallocationStatusOptions = useMemo(
    () => buildMigrationStatusOptions(reallocationMigrations),
    [reallocationMigrations],
  );
  const reallocationNamespaceOptions = useMemo(
    () => buildMigrationNamespaceOptions(reallocationMigrations),
    [reallocationMigrations],
  );

  const metricRuleColumnsAll = useMemo(
    () =>
      buildMetricRulesTableColumns({
        canManage: canManageMetricRule,
        onOpenYaml: handleOpenMetricRuleYaml,
        onEdit: openEditMetricRule,
        onDelete: handleDeleteMetricRule,
      }),
    [
      canManageMetricRule,
      handleDeleteMetricRule,
      handleOpenMetricRuleYaml,
      openEditMetricRule,
    ],
  );

  const { displayColumns: metricRuleColumns } = useTableColumnSettings(
    metricRuleColumnsAll,
    METRIC_RULES_TABLE_KEY,
  );

  const migrationActions: MigrationsTableActions = useMemo(
    () => ({
      isTenant,
      vms,
      canWrite: canWriteMigration,
      onOpenYaml: handleOpenMigrationYaml,
      onAbort: handleAbortMigration,
    }),
    [canWriteMigration, handleAbortMigration, handleOpenMigrationYaml, isTenant, vms],
  );

  const reallocationColumnsAll = useMemo(() => {
    return buildMigrationsTableColumns(migrationActions).filter((c) => c.key !== 'trigger');
  }, [migrationActions]);

  const { displayColumns: reallocationColumns } = useTableColumnSettings(
    reallocationColumnsAll,
    REALLOCATION_TABLE_KEY,
  );

  const resetMetricFilters = useCallback(() => {
    setMetricKeyword('');
  }, []);

  const resetReallocationFilters = useCallback(() => {
    setReallocationKeyword('');
    setReallocationNamespaceFilter('');
    setReallocationStatusFilter('');
  }, []);

  const metricRulesToolbarLeft = useMemo(
    () => (
      <>
        <Input
          allowClear
            placeholder="规则名称 / 指标类型（cpu、memory）"
          suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          value={metricKeyword}
          onChange={(e) => setMetricKeyword(e.target.value)}
          className="toolbar-search"
        />
        <button type="button" className="toolbar-reset-btn" onClick={resetMetricFilters}>
          重置
        </button>
      </>
    ),
    [metricKeyword, resetMetricFilters],
  );

  const reallocationToolbarLeft = useMemo(
    () => (
      <>
        <Input
          allowClear
          placeholder="任务ID/虚拟机/触发指纹"
          suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          value={reallocationKeyword}
          onChange={(e) => setReallocationKeyword(e.target.value)}
          className="toolbar-search"
        />
        {!isTenant ? (
          <Select
            allowClear
            showSearch
            placeholder="命名空间"
            value={reallocationNamespaceFilter || undefined}
            onChange={(v) => setReallocationNamespaceFilter(v || '')}
            className="toolbar-filter-sm"
            options={reallocationNamespaceOptions.map((v) => ({ value: v, label: v }))}
          />
        ) : null}
        <Select
          allowClear
          placeholder="状态"
          value={reallocationStatusFilter || undefined}
          onChange={(v) => setReallocationStatusFilter(v || '')}
          className="toolbar-filter-sm"
          options={reallocationStatusOptions}
        />
        <button type="button" className="toolbar-reset-btn" onClick={resetReallocationFilters}>
          重置
        </button>
      </>
    ),
    [
      isTenant,
      reallocationKeyword,
      reallocationNamespaceFilter,
      reallocationNamespaceOptions,
      reallocationStatusFilter,
      reallocationStatusOptions,
      resetReallocationFilters,
    ],
  );

  const metricRulesToolbarRight = useMemo(
    () => (
      <div className="toolbar-actions">
        {canManageMetricRule && metricRulesAvailable ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateMetricRule}>
            创建调度规则
          </Button>
        ) : null}
        <TableColumnSettingsButton
          allColumns={metricRuleColumnsAll}
          settingsKey={METRIC_RULES_TABLE_KEY}
        />
        <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
      </div>
    ),
    [
      canManageMetricRule,
      handleRefresh,
      loading,
      metricRuleColumnsAll,
      metricRulesAvailable,
      openCreateMetricRule,
    ],
  );

  const reallocationToolbarRight = useMemo(
    () => (
      <div className="toolbar-actions">
        <TableColumnSettingsButton
          allColumns={reallocationColumnsAll}
          settingsKey={REALLOCATION_TABLE_KEY}
        />
        <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
      </div>
    ),
    [handleRefresh, loading, reallocationColumnsAll],
  );

  const tabItems = useMemo(
    () => [
      {
        key: 'metricRules',
        label: `调度规则 (${summary.metricRuleCount})`,
        children: (
          <>
            <SharedToolbar
              left={metricRulesToolbarLeft}
              right={metricRulesToolbarRight}
              style={{ marginBottom: 16 }}
            />
            {!metricRulesAvailable ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="无法从集群拉取 MetricRule 列表"
                description={
                  metricRulesError ||
                  '请确认云实例 API 地址/令牌正确，且已安装 metricrules.hms.rivercloud.com CRD。'
                }
              />
            ) : null}
            <Table
              className="std-table"
              bordered={false}
              scroll={{ x: true }}
              rowKey={(r) => String(metricRuleRowFields.uidOrKey(r))}
              columns={metricRuleColumns}
              dataSource={filteredMetricRules}
              loading={loading}
              pagination={{ showTotal: (total) => `共 ${total} 条`, size: 'small' }}
            />
          </>
        ),
      },
      {
        key: 'reallocation',
        label: `DRS 迁移记录 (${summary.reallocationMigrationCount})`,
        children: (
          <>
            <SharedToolbar
              left={reallocationToolbarLeft}
              right={reallocationToolbarRight}
              style={{ marginBottom: 16 }}
            />
            <Table
              className="std-table"
              bordered={false}
              scroll={{ x: true }}
              rowKey={(r) => String(migrationRowFields.uidOrKey(r))}
              columns={reallocationColumns}
              dataSource={filteredReallocationMigrations}
              loading={loading}
              pagination={{ showTotal: (total) => `共 ${total} 条`, size: 'small' }}
            />
          </>
        ),
      },
    ],
    [
      filteredMetricRules,
      filteredReallocationMigrations,
      loading,
      metricRuleColumns,
      metricRulesAvailable,
      metricRulesError,
      metricRulesToolbarLeft,
      metricRulesToolbarRight,
      reallocationColumns,
      reallocationToolbarLeft,
      reallocationToolbarRight,
      summary.metricRuleCount,
      summary.reallocationMigrationCount,
    ],
  );

  if (!canRead) {
    return (
      <PageDetailSection title="DRS 调度">
        <Alert type="warning" showIcon message="无权限查看 DRS 信息" />
      </PageDetailSection>
    );
  }

  return (
    <>
      <PageDetailSection asCard={false} title="DRS 调度">
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic title="MetricRule 规则" value={summary.metricRuleCount} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic title="已启用规则" value={summary.enabledMetricRuleCount} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic title="DRS 迁移记录" value={summary.reallocationMigrationCount} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic
                title="进行中 DRS 迁移"
                value={summary.runningReallocationMigrationCount}
                valueStyle={
                  summary.runningReallocationMigrationCount > 0
                    ? { color: '#1677ff' }
                    : undefined
                }
              />
            </Card>
          </Col>
        </Row>

        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      </PageDetailSection>

      <MetricRuleConfigDrawer
        open={metricRuleDrawerOpen}
        editing={editingMetricRule}
        saving={metricRuleSaving}
        onClose={closeMetricRuleDrawer}
        onSubmit={handleSubmitMetricRule}
      />

      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle || 'YAML'}
      />
    </>
  );
};

export default DrsSection;
