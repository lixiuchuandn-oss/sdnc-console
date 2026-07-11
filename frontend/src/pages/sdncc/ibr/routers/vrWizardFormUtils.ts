import { message } from 'antd';
import type { FormInstance } from 'antd';

export type WizardFieldName = string | (string | number)[];

/** 表单校验失败时给出首条字段错误提示（避免空 catch 无反馈） */
export function warnFormValidationFailure(err: unknown, fallback = '请先完善当前步骤必填项') {
  const e = err as { errorFields?: { name: (string | number)[]; errors: string[] }[] };
  const first = e?.errorFields?.[0];
  message.warning(first?.errors?.[0] || fallback);
}

/** 从 fromStep 到 toStep（不含）逐步校验；返回 false 表示 beforeAdvance 中断 */
export async function validateWizardStepsThrough(
  form: FormInstance,
  fromStep: number,
  toStep: number,
  fieldsForStep: (step: number) => WizardFieldName[],
  options?: { beforeAdvance?: (step: number) => boolean | Promise<boolean> },
): Promise<boolean> {
  for (let s = fromStep; s < toStep; s++) {
    const fields = fieldsForStep(s);
    if (fields.length > 0) {
      await form.validateFields(fields);
    }
    if (options?.beforeAdvance) {
      const ok = await options.beforeAdvance(s);
      if (!ok) return false;
    }
  }
  return true;
}

/** 侧栏步骤切换：后退直接跳；前进须通过中间各步校验 */
export async function handleWizardStepsChange(
  idx: number,
  current: number,
  setCurrent: (n: number) => void,
  validateThrough: (from: number, to: number) => Promise<boolean>,
) {
  if (idx === current) return;
  if (idx < current) {
    setCurrent(idx);
    return;
  }
  try {
    const ok = await validateThrough(current, idx);
    if (ok) setCurrent(idx);
  } catch (err) {
    warnFormValidationFailure(err);
  }
}
