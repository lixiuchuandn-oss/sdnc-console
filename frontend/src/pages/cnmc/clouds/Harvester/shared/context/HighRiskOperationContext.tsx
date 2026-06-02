import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import HighRiskOperationModal from '../../../../../../components/HighRiskOperationModal';
import {
  DELETE_RISK_ITEMS,
  HIGH_RISK_ACK_DEFAULT,
} from '../lib/highRiskOperationPresets';

export type HighRiskPrecheckResult = {
  ok: boolean;
  error?: string;
  extra?: React.ReactNode;
};

export type ConfirmHighRiskOperationOptions = {
  title: React.ReactNode;
  /** 用于影响确认文案，如「删除项目「foo」」 */
  operationSummary?: React.ReactNode;
  alert?: {
    type?: 'warning' | 'error' | 'info' | 'success';
    message: React.ReactNode;
    description?: React.ReactNode;
  };
  description?: React.ReactNode;
  riskItems?: readonly string[];
  extra?: React.ReactNode;
  /** 为 true 且提供 targetName 时，须输入 targetName 才能确认 */
  requireTypeConfirm?: boolean;
  targetName?: string;
  typeConfirmLabel?: React.ReactNode;
  impactAckLabel?: React.ReactNode;
  /** 默认 true：须勾选「我已了解影响」 */
  requireImpactAck?: boolean;
  confirmText?: React.ReactNode;
  cancelText?: string;
  width?: number;
  precheck?: () => Promise<HighRiskPrecheckResult | void>;
  onConfirm: () => void | Promise<void>;
};

type ModalSession = ConfirmHighRiskOperationOptions & {
  resolve: () => void;
  reject: (reason?: unknown) => void;
};

type HighRiskOperationContextValue = {
  confirmHighRisk: (options: ConfirmHighRiskOperationOptions) => Promise<void>;
};

const HighRiskOperationContext = createContext<HighRiskOperationContextValue | null>(null);

type ConfirmHighRiskDeleteOptions = {
  title?: React.ReactNode;
  resourceLabel: string;
  name: string;
  description?: React.ReactNode;
  riskItems?: readonly string[];
  requireTypeConfirm?: boolean;
  extra?: React.ReactNode;
  confirmText?: React.ReactNode;
  alert?: ConfirmHighRiskOperationOptions['alert'];
  precheck?: ConfirmHighRiskOperationOptions['precheck'];
  onConfirm: () => void | Promise<void>;
};

/** 模块级 imperative API（须在 Cloudmap 池内 Provider 下使用） */
let imperativeConfirm: ((options: ConfirmHighRiskOperationOptions) => Promise<void>) | null =
  null;

export function confirmHighRiskOperation(
  options: ConfirmHighRiskOperationOptions,
): Promise<void> {
  if (!imperativeConfirm) {
    return Promise.reject(
      new Error(
        'confirmHighRiskOperation: 未找到 HighRiskOperationProvider，请在 Cloudmap 资源池内使用。',
      ),
    );
  }
  return imperativeConfirm(options);
}

/** 删除类高风险操作快捷入口 */
export function confirmHighRiskDelete(options: ConfirmHighRiskDeleteOptions): Promise<void> {
  const {
    title = `确认删除${options.resourceLabel}`,
    resourceLabel,
    name,
    description,
    riskItems = DELETE_RISK_ITEMS,
    requireTypeConfirm = true,
    extra,
    confirmText = '删除',
    alert,
    precheck,
    onConfirm,
  } = options;

  return confirmHighRiskOperation({
    title,
    targetName: requireTypeConfirm ? name : undefined,
    requireTypeConfirm,
    description:
      description ??
      `确定要删除${resourceLabel}「${name}」吗？请仔细核对名称与影响范围。`,
    riskItems,
    extra,
    alert,
    precheck,
    confirmText,
    operationSummary: `确认删除${resourceLabel}「${name}」`,
    onConfirm,
  });
}

export const HighRiskOperationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<ModalSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [precheckError, setPrecheckError] = useState<string | null>(null);
  const [extra, setExtra] = useState<React.ReactNode>(null);
  const [impactAck, setImpactAck] = useState(false);
  const [typeConfirmValue, setTypeConfirmValue] = useState('');
  const sessionRef = useRef<ModalSession | null>(null);

  const resetForm = useCallback(() => {
    setImpactAck(false);
    setTypeConfirmValue('');
    setPrecheckError(null);
    setExtra(null);
  }, []);

  const closeSession = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    setLoading(false);
    setSubmitting(false);
    resetForm();
  }, [resetForm]);

  const confirmHighRisk = useCallback((options: ConfirmHighRiskOperationOptions) => {
    return new Promise<void>((resolve, reject) => {
      if (sessionRef.current) {
        reject(new Error('已有高风险确认弹窗进行中'));
        return;
      }
      const next: ModalSession = { ...options, resolve, reject };
      sessionRef.current = next;
      setSession(next);
      resetForm();
    });
  }, [resetForm]);

  useEffect(() => {
    imperativeConfirm = confirmHighRisk;
    return () => {
      if (imperativeConfirm === confirmHighRisk) {
        imperativeConfirm = null;
      }
    };
  }, [confirmHighRisk]);

  const runPrecheck = useCallback(async (current: ModalSession) => {
    if (!current.precheck) {
      setPrecheckError(null);
      setExtra(current.extra ?? null);
      return;
    }
    setLoading(true);
    setPrecheckError(null);
    setExtra(null);
    try {
      const result = await current.precheck();
      if (result && result.ok === false) {
        setPrecheckError(result.error || '预检未通过');
        setExtra(result.extra ?? null);
        return;
      }
      setPrecheckError(null);
      setExtra(result?.extra ?? current.extra ?? null);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setPrecheckError(err?.message || '预检失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      void runPrecheck(session);
    }
  }, [session, runPrecheck]);

  const requireImpactAck = session?.requireImpactAck !== false;
  const requireTypeConfirm =
    !!session?.requireTypeConfirm && !!session?.targetName?.trim();
  const expectedName = session?.targetName?.trim() ?? '';
  const typeConfirmed =
    !requireTypeConfirm || typeConfirmValue.trim() === expectedName;
  const impactConfirmed = !requireImpactAck || impactAck;

  const canConfirm =
    !!session &&
    !loading &&
    !precheckError &&
    impactConfirmed &&
    typeConfirmed &&
    !submitting;

  const handleCancel = useCallback(() => {
    const current = sessionRef.current;
    if (current) {
      current.reject(new Error('用户取消'));
    }
    closeSession();
  }, [closeSession]);

  const handleConfirm = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || !canConfirm) return;
    setSubmitting(true);
    try {
      await current.onConfirm();
      current.resolve();
      closeSession();
    } catch {
      /* 调用方已提示错误；保持弹窗打开以便重试 */
    } finally {
      setSubmitting(false);
    }
  }, [canConfirm, closeSession]);

  const contextValue = useMemo(() => ({ confirmHighRisk }), [confirmHighRisk]);

  const impactAckLabel =
    session?.impactAckLabel ??
    (session?.operationSummary ? (
      <>
        我已了解影响，确认{session.operationSummary}
      </>
    ) : (
      HIGH_RISK_ACK_DEFAULT
    ));

  return (
    <HighRiskOperationContext.Provider value={contextValue}>
      {children}
      <HighRiskOperationModal
        open={!!session}
        title={session?.title ?? ''}
        width={session?.width}
        loading={loading}
        submitting={submitting}
        precheckError={precheckError}
        alert={session?.alert}
        description={session?.description}
        riskItems={session?.riskItems}
        extra={extra}
        impactAck={
          requireImpactAck
            ? {
                checked: impactAck,
                onChange: setImpactAck,
                label: impactAckLabel,
              }
            : undefined
        }
        typeConfirm={
          requireTypeConfirm
            ? {
                expected: expectedName,
                value: typeConfirmValue,
                onChange: setTypeConfirmValue,
                label: session?.typeConfirmLabel,
              }
            : undefined
        }
        confirmText={session?.confirmText ?? '确认'}
        cancelText={session?.cancelText}
        canConfirm={canConfirm}
        onCancel={handleCancel}
        onConfirm={() => void handleConfirm()}
      />
    </HighRiskOperationContext.Provider>
  );
};

export function useHighRiskOperation(): HighRiskOperationContextValue {
  const ctx = useContext(HighRiskOperationContext);
  if (!ctx) {
    throw new Error('useHighRiskOperation 须在 HighRiskOperationProvider 内使用');
  }
  return ctx;
}
