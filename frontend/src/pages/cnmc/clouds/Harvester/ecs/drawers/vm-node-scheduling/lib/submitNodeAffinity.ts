/**
 * 节点亲和性变配提交。
 */
import { message } from 'antd';
import { updateHarvesterVmSpec } from '../../../../../../../../services/harvesterApi';
import type { VmReconfigureSubmitCtx } from '../../../lib/vmMutation/vmReconfigureSubmitContext';

export async function submitVmReconfigureChangeNodeAffinity(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, openRestartConfirm } = ctx;
  const mode = values.nodeAffinityMode;
  const terms = values.nodeAffinityTerms || [];

  let nodeAffinity: any = null;
  if (mode === 'required' && terms.length > 0) {
    const nodeSelectorTerms = terms
      .map((term: any) => {
        const expressions = (term.expressions || []).filter((expr: any) => expr?.key && expr?.operator);
        if (expressions.length === 0) return null;

        return {
          matchExpressions: expressions
            .map((expr: any) => {
              const matchExpr: any = {
                key: String(expr.key || '').trim(),
                operator: String(expr.operator || 'In'),
              };

              if (!['Exists', 'DoesNotExist'].includes(matchExpr.operator)) {
                const valuesArr = Array.isArray(expr.values) ? expr.values : [];
                const filteredValues = valuesArr
                  .filter((v: any) => v && String(v).trim())
                  .map((v: any) => String(v).trim());
                if (filteredValues.length > 0) {
                  matchExpr.values = filteredValues;
                } else {
                  return null;
                }
              }

              return matchExpr;
            })
            .filter((expr: any) => expr !== null && expr.key),
        };
      })
      .filter((term: any) => term !== null && term.matchExpressions && term.matchExpressions.length > 0);

    if (nodeSelectorTerms.length > 0) {
      nodeAffinity = {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms,
          },
        },
      };
    }
  }

  await updateHarvesterVmSpec(cloudId, namespace, vmName, { affinity: nodeAffinity });
  message.success('节点亲和性配置已更新');
  openRestartConfirm(namespace, vmName, false);
}
