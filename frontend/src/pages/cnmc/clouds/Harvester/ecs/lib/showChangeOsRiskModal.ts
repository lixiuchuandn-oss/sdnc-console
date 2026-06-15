import type { FormInstance } from 'antd/es/form';
import { confirmHighRiskOperation } from '../../shared/lib/highRiskConfirm';
import { CHANGE_OS_RISK_ITEMS } from '../../shared/lib/highRiskOperationPresets';

/** 与资源变配「更换系统镜像」一致：弹窗说明风险并在确认后勾选表单 `changeOsConfirmed`。 */
export function showChangeOsRiskModal(form: FormInstance<any>): void {
  void confirmHighRiskOperation({
    title: '更换系统盘风险说明',
    width: 520,
    description: '更换操作系统前，请仔细阅读以下影响：',
    riskItems: CHANGE_OS_RISK_ITEMS,
    requireTypeConfirm: false,
    confirmText: '我已知晓',
    operationSummary: '确认已了解更换系统盘风险',
    onConfirm: () => {
      try {
        form.setFieldsValue({ changeOsConfirmed: true });
      } catch {
        /* ignore */
      }
    },
  }).catch(() => undefined);
}
