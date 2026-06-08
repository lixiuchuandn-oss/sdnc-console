/**
 * 计算资源 · DRS 调度规则（MetricRule CR）
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Input, Table, Tooltip } from 'antd';
import { QuestionCircleOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { createHarvesterToolbarRefresh } from '../../shared/lib/harvesterSectionRefresh';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import MetricRuleConfigDrawer from '../drawers/MetricRuleConfigDrawer';
import { useMetricRuleCrActions } from '../hooks/useMetricRuleCrActions';
import { useDrsSectionData } from '../hooks/useDrsSectionData';
import { buildMetricRulesTableColumns } from '../lib/drsMetricRulesTableColumns';
import { METRIC_RULE_MAX_COUNT } from '../lib/drsMetricRuleForm';
import {
  filterMetricRulesForTable,
  metricRuleRowFields,
  type MetricRuleTableRow,
} from '../lib/drsMetricRuleUtils';

import {
  canReadDrsTab,
  canWriteDrs,
} from '../../../../../../constants/computeClusterPermissions';

const METRIC_RULES_TABLE_KEY = 'harvester_drs_metric_rules_table';

const METRIC_RULE_CDRS_INFO_TOOLTIP = (
  <>
    集群级 CDRS 调度规则
    <br />
    CPU 与内存调度条件可同时配置，满足任一条件即可触发迁移
  </>
);

const METRIC_RULE_SINGLE_LIMIT_TOOLTIP = (
  <>
    集群仅允许配置 {METRIC_RULE_MAX_COUNT} 条调度规则
    <br />
    如需调整策略，请编辑或删除已有规则后再新建
  </>
);

export type DrsRulesSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

const DrsRulesSection: React.FC<DrsRulesSectionProps> = ({ cloudId, checkPerm }) => {
  const canRead = canReadDrsTab(checkPerm);
  const canManageMetricRule = canWriteDrs(checkPerm);

  const [metricKeyword, setMetricKeyword] = useState('');
  const [metricRuleDrawerOpen, setMetricRuleDrawerOpen] = useState(false);
  const [editingMetricRule, setEditingMetricRule] = useState<MetricRuleTableRow | null>(null);
  const [metricRuleSaving, setMetricRuleSaving] = useState(false);

  const { loading, metricRules, metricRulesAvailable, metricRulesError, loadAll } =
    useDrsSectionData(cloudId, canRead);

  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);

  const handleRefresh = useMemo(() => createHarvesterToolbarRefresh(loadAll), [loadAll]);

  const closeMetricRuleDrawer = useCallback(() => {
    setMetricRuleDrawerOpen(false);
    setEditingMetricRule(null);
  }, []);

  const hasReachedRuleLimit = metricRules.length >= METRIC_RULE_MAX_COUNT;
  const showCreateMetricRuleAction = canManageMetricRule && metricRulesAvailable;

  const openCreateMetricRule = useCallback(() => {
    if (hasReachedRuleLimit) return;
    setEditingMetricRule(null);
    setMetricRuleDrawerOpen(true);
  }, [hasReachedRuleLimit]);

  const openEditMetricRule = useCallback((record: MetricRuleTableRow) => {
    setEditingMetricRule(record);
    setMetricRuleDrawerOpen(true);
  }, []);

  const { handleDeleteMetricRule, handleSubmitMetricRule } = useMetricRuleCrActions({
    cloudId,
    canManageMetricRule,
    editingMetricRule,
    existingRuleCount: metricRules.length,
    loadAll,
    closeConfigDrawer: closeMetricRuleDrawer,
    setConfigSaving: setMetricRuleSaving,
  });

  const handleOpenMetricRuleYaml = useCallback(
    (record: MetricRuleTableRow) => {
      openYamlDrawer({ ...record, kind: 'MetricRule' }, { title: '调度规则配置' });
    },
    [openYamlDrawer],
  );

  const filteredMetricRules = useMemo(
    () => filterMetricRulesForTable(metricRules as MetricRuleTableRow[], metricKeyword),
    [metricKeyword, metricRules],
  );

  const metricRuleColumnsAll = useMemo(
    () =>
      buildMetricRulesTableColumns({
        canManage: canManageMetricRule,
        onOpenYaml: handleOpenMetricRuleYaml,
        onEdit: openEditMetricRule,
        onDelete: handleDeleteMetricRule,
      }),
    [canManageMetricRule, handleDeleteMetricRule, handleOpenMetricRuleYaml, openEditMetricRule],
  );

  const { displayColumns: metricRuleColumns } = useTableColumnSettings(
    metricRuleColumnsAll,
    METRIC_RULES_TABLE_KEY,
  );

  const resetMetricFilters = useCallback(() => {
    setMetricKeyword('');
  }, []);

  if (!canRead) {
    return <Alert type="warning" showIcon message="无权限查看 DRS 规则" />;
  }

  return (
    <>
      <PageDetailSection
        asCard={false}
        autoStyleInputs={false}
        toolbarLeft={
          <>
            <Input
              allowClear
              placeholder="规则名称 / 调度指标（CPU、内存）"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={metricKeyword}
              onChange={(e) => setMetricKeyword(e.target.value)}
              className="toolbar-search"
            />
            <button type="button" className="toolbar-reset-btn" onClick={resetMetricFilters}>
              重置
            </button>
          </>
        }
        toolbarRight={
          <div className="toolbar-actions">
            {showCreateMetricRuleAction ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Button
                  type="primary"
                  disabled={hasReachedRuleLimit}
                  onClick={openCreateMetricRule}
                >
                  创建调度规则
                </Button>
                <Tooltip title={METRIC_RULE_CDRS_INFO_TOOLTIP}>
                  <QuestionCircleOutlined
                    style={{ color: 'rgba(0,0,0,.45)', cursor: 'help', fontSize: 12 }}
                  />
                </Tooltip>
                {hasReachedRuleLimit ? (
                  <Tooltip title={METRIC_RULE_SINGLE_LIMIT_TOOLTIP}>
                    <QuestionCircleOutlined
                      style={{ color: 'rgba(0,0,0,.45)', cursor: 'help', fontSize: 12 }}
                    />
                  </Tooltip>
                ) : null}
              </span>
            ) : null}
            <TableColumnSettingsButton
              allColumns={metricRuleColumnsAll}
              settingsKey={METRIC_RULES_TABLE_KEY}
            />
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
          </div>
        }
      >
        {!metricRulesAvailable ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="无法从集群拉取调度规则列表"
            description={
              metricRulesError || '请确认云实例 API 地址/令牌正确，且集群 CDRS 服务可用。'
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

export default DrsRulesSection;
