/**
 * 计算资源 · DRS 调度规则（MetricRule CR）
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Input, Table } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import SharedToolbar from 'components/SharedToolbar';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import MetricRuleConfigDrawer from '../drawers/MetricRuleConfigDrawer';
import { useMetricRuleCrActions } from '../hooks/useMetricRuleCrActions';
import { useDrsSectionData } from '../hooks/useDrsSectionData';
import { buildMetricRulesTableColumns } from '../lib/drsMetricRulesTableColumns';
import {
  filterMetricRulesForTable,
  metricRuleRowFields,
  type MetricRuleTableRow,
} from '../lib/drsMetricRuleUtils';

const METRIC_RULES_TABLE_KEY = 'harvester_drs_metric_rules_table';

export type DrsRulesSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

const DrsRulesSection: React.FC<DrsRulesSectionProps> = ({ cloudId, checkPerm }) => {
  const canRead = checkPerm('clouds.drs:read');
  const canManageMetricRule = checkPerm('clouds.drs:write');

  const [metricKeyword, setMetricKeyword] = useState('');
  const [metricRuleDrawerOpen, setMetricRuleDrawerOpen] = useState(false);
  const [editingMetricRule, setEditingMetricRule] = useState<MetricRuleTableRow | null>(null);
  const [metricRuleSaving, setMetricRuleSaving] = useState(false);

  const { loading, metricRules, metricRulesAvailable, metricRulesError, loadAll } =
    useDrsSectionData(cloudId, canRead);

  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);

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
      <SharedToolbar
        left={
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
        }
        right={
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
        }
        style={{ marginBottom: 16 }}
      />

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
