import { useCallback, useRef, useState } from 'react';
import { message } from 'antd';
import { getApiErrorMessage } from '../../../../services/api';
import {
  buildIbrDeployWizardSteps,
  executeIbrDeployWizardStep,
  DeployDriftCancelledError,
  type IbrDeployFeature,
  type IbrDeployWizardStep,
} from './vrConfigDeployFlow';

export type IbrDeployWizardStatus = 'wait' | 'process' | 'finish' | 'error';

export type UseIbrDeployWizardOptions = {
  feature: IbrDeployFeature;
  includeVerify?: boolean;
  /** 进入向导时解析当前端点列表 */
  resolveEndpoints: () => Array<{ label: string; vrId?: string | null }>;
  onAllFinished?: () => void;
  stepDelayMs?: number;
};

/**
 * 统一 IBR 下发向导状态机：预览 → 下发 → [回查]，各特性共用。
 */
export function useIbrDeployWizard(options: UseIbrDeployWizardOptions) {
  const { feature, includeVerify, resolveEndpoints, onAllFinished, stepDelayMs = 500 } = options;

  const [steps, setSteps] = useState<IbrDeployWizardStep[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [logs, setLogs] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<Record<number, IbrDeployWizardStatus>>({});
  const sessionRef = useRef(0);
  const runningRef = useRef<{ sessionId: number; stepIndex: number } | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  const resetWizard = useCallback(() => {
    sessionRef.current += 1;
    runningRef.current = null;
    clearTimers();
    const plan = buildIbrDeployWizardSteps(resolveEndpoints(), feature, { includeVerify });
    setSteps(plan);
    setActiveStep(0);
    setLogs({});
    const init: Record<number, IbrDeployWizardStatus> = {};
    plan.forEach((_, i) => {
      init[i] = 'wait';
    });
    setStatus(init);
    return plan;
  }, [clearTimers, feature, includeVerify, resolveEndpoints]);

  const runStep = useCallback(
    async (stepIndex: number) => {
      const sessionId = sessionRef.current;
      const active = runningRef.current;
      if (active?.sessionId === sessionId && active.stepIndex === stepIndex) return;

      const step = steps[stepIndex];
      if (!step) return;

      runningRef.current = { sessionId, stepIndex };
      setStatus((prev) => ({ ...prev, [stepIndex]: 'process' }));
      setLogs((prev) => ({ ...prev, [stepIndex]: '执行中…' }));

      const isStale = () => sessionId !== sessionRef.current;

      try {
        const logMsg = await executeIbrDeployWizardStep(step);
        if (isStale()) return;

        setLogs((prev) => ({ ...prev, [stepIndex]: logMsg }));
        setStatus((prev) => ({ ...prev, [stepIndex]: 'finish' }));
        setActiveStep(stepIndex + 1);

        if (stepIndex < steps.length - 1) {
          const timer = window.setTimeout(() => void runStep(stepIndex + 1), stepDelayMs);
          timersRef.current.push(timer);
        } else {
          onAllFinished?.();
        }
      } catch (e: unknown) {
        if (isStale()) return;
        if (e instanceof DeployDriftCancelledError) {
          setLogs((prev) => ({
            ...prev,
            [stepIndex]: '[已取消] 用户取消覆盖设备侧历史策略',
          }));
        } else {
          const errMsg = getApiErrorMessage(e, '下发步骤失败');
          setLogs((prev) => ({ ...prev, [stepIndex]: `[错误] ${errMsg}` }));
        }
        setStatus((prev) => ({ ...prev, [stepIndex]: 'error' }));
      } finally {
        const cur = runningRef.current;
        if (cur?.sessionId === sessionId && cur.stepIndex === stepIndex) {
          runningRef.current = null;
        }
      }
    },
    [onAllFinished, stepDelayMs, steps],
  );

  const startAuto = useCallback(() => {
    const plan = resetWizard();
    if (plan.length === 0) {
      message.warning('没有可下发的 IBR 端点');
      return;
    }
    const timer = window.setTimeout(() => void runStep(0), 400);
    timersRef.current.push(timer);
  }, [resetWizard, runStep]);

  const cancel = useCallback(() => {
    sessionRef.current += 1;
    runningRef.current = null;
    clearTimers();
  }, [clearTimers]);

  return {
    steps,
    activeStep,
    logs,
    status,
    resetWizard,
    startAuto,
    runStep,
    cancel,
  };
}
