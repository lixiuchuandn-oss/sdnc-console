/** Cloudmap 池内高风险操作确认 — 统一导出入口 */
export {
  confirmHighRiskOperation,
  confirmHighRiskDelete,
  useHighRiskOperation,
  HighRiskOperationProvider,
  type ConfirmHighRiskOperationOptions,
  type HighRiskConfirmContext,
  type HighRiskPrecheckResult,
} from '../context/HighRiskOperationContext';

export * from './highRiskOperationPresets';
