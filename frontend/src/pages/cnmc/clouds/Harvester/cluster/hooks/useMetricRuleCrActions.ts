import { useCallback } from 'react';
import { message } from 'antd';
import {
  createHarvesterMetricRuleCr,
  deleteHarvesterMetricRuleCr,
  updateHarvesterMetricRuleCr,
  type MetricRuleCrSpec,
} from 'services/harvester/drs';
import type { MetricRuleTableRow } from '../lib/drsMetricRuleUtils';
import { apiErrorMessage } from '../lib/physicalSwitchesSectionUtils';
import { metricRuleRowFields } from '../lib/drsMetricRuleUtils';
import { confirmHighRiskDelete, DRS_RULE_RISK_ITEMS } from '../../shared/lib/highRiskConfirm';
import { runHarvesterSectionRefresh } from '../../shared/lib/harvesterSectionRefresh';
import { METRIC_RULE_MAX_COUNT } from '../lib/drsMetricRuleForm';

export type UseMetricRuleCrActionsOptions = {
  cloudId: string;
  canManageMetricRule: boolean;
  editingMetricRule: MetricRuleTableRow | null;
  existingRuleCount: number;
  loadAll: (force?: boolean) => Promise<void>;
  closeConfigDrawer: () => void;
  setConfigSaving: (v: boolean) => void;
};

export function useMetricRuleCrActions({
  cloudId,
  canManageMetricRule,
  editingMetricRule,
  existingRuleCount,
  loadAll,
  closeConfigDrawer,
  setConfigSaving,
}: UseMetricRuleCrActionsOptions) {
  const handleDeleteMetricRule = useCallback(
    (record: MetricRuleTableRow) => {
      const name = metricRuleRowFields.name(record);
      if (!name || name === '-' || !canManageMetricRule) return;
      void confirmHighRiskDelete({
        resourceLabel: '调度规则',
        name,
        description: '删除后集群将不再按该规则触发 DRS 迁移。',
        riskItems: DRS_RULE_RISK_ITEMS,
        onConfirm: async () => {
          try {
            await deleteHarvesterMetricRuleCr(cloudId, name);
            message.success('已删除');
            await runHarvesterSectionRefresh(loadAll, { force: true });
          } catch (e) {
            message.error(apiErrorMessage(e, '删除失败'));
            throw e;
          }
        },
      }).catch(() => {});
    },
    [canManageMetricRule, cloudId, loadAll],
  );

  const handleSubmitMetricRule = useCallback(
    async (payload: { name: string; spec: Record<string, unknown> }) => {
      if (!canManageMetricRule) return;
      setConfigSaving(true);
      try {
        const spec = payload.spec as MetricRuleCrSpec;
        const editName = editingMetricRule ? metricRuleRowFields.name(editingMetricRule) : '';
        if (editName && editName !== '-') {
          await updateHarvesterMetricRuleCr(cloudId, editName, { spec });
          message.success('调度规则已更新');
        } else {
          if (existingRuleCount >= METRIC_RULE_MAX_COUNT) {
            message.error(`集群仅允许配置 ${METRIC_RULE_MAX_COUNT} 条调度规则，请先编辑或删除已有规则`);
            return;
          }
          await createHarvesterMetricRuleCr(cloudId, { name: payload.name, spec });
          message.success('调度规则已创建');
        }
        closeConfigDrawer();
        await runHarvesterSectionRefresh(loadAll, { force: true });
      } catch (e) {
        message.error(apiErrorMessage(e, '保存失败'));
        throw e;
      } finally {
        setConfigSaving(false);
      }
    },
    [
      canManageMetricRule,
      cloudId,
      closeConfigDrawer,
      editingMetricRule,
      existingRuleCount,
      loadAll,
      setConfigSaving,
    ],
  );

  return { handleDeleteMetricRule, handleSubmitMetricRule };
}
