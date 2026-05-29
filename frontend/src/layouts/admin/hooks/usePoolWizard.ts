/**
 * 资源池接入向导（建池/编辑）状态中枢（L7）：
 * - 拥有 poolWizardOpen / poolWizardEditing / poolWizardForceRequired 与开合/提交动作。
 * - 自动绑定副作用：列表已 hydrate 且存在 CNMC 池时，关闭由「自动弹出」打开的强制向导。
 * 从 AdminLayout 原样抽出为 hook；耦合 L6 的 summary 状态，行为与原内联实现一致。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Cloud, isCsmCloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import { resolveDefaultPool } from '../lib/adminLayoutNav';

/** 无资源池时强弹向导：本会话用户点「稍后接入」后不再自动弹出 */
const MUST_BIND_POOL_DISMISS_KEY = 'adminLayout.mustBindPoolPromptDismissed';

type MaybeUser = { id?: string | number } | null | undefined;

type UsePoolWizardArgs = {
  user: MaybeUser;
  summaryClouds: Cloud[];
  summaryListHydrated: boolean;
  summaryLoading: boolean;
  canWritePools: boolean;
  loadSummaryClouds: () => void | Promise<void>;
};

export function usePoolWizard({
  user,
  summaryClouds,
  summaryListHydrated,
  summaryLoading,
  canWritePools,
  loadSummaryClouds,
}: UsePoolWizardArgs) {
  const [poolWizardOpen, setPoolWizardOpen] = useState(false);
  const [poolWizardEditing, setPoolWizardEditing] = useState<Cloud | null>(null);
  const [poolWizardForceRequired, setPoolWizardForceRequired] = useState(false);
  const poolWizardOpenedByAutoRef = useRef(false);
  const autoBindPoolPromptShownRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (!summaryListHydrated) return;
    if (summaryClouds.filter((c) => !isCsmCloud(c)).length > 0) {
      autoBindPoolPromptShownRef.current = false;
      if (poolWizardOpenedByAutoRef.current) {
        setPoolWizardOpen(false);
        setPoolWizardForceRequired(false);
        poolWizardOpenedByAutoRef.current = false;
      }
      return;
    }
    // 注释掉自动弹出接入边缘云弹窗的逻辑
    // if (summaryLoading) return;
    // if (!canWritePools) return;
    // try {
    //   if (window.sessionStorage.getItem(MUST_BIND_POOL_DISMISS_KEY) === '1') return;
    // } catch {
    //   /* ignore */
    // }
    // if (autoBindPoolPromptShownRef.current) return;
    // autoBindPoolPromptShownRef.current = true;
    // poolWizardOpenedByAutoRef.current = true;
    // setPoolWizardForceRequired(true);
    // setPoolWizardEditing(null);
    // setPoolWizardOpen(true);
  }, [user, summaryLoading, summaryClouds, canWritePools, summaryListHydrated]);

  const handlePoolWizardCancel = useCallback(() => {
    setPoolWizardOpen(false);
    setPoolWizardEditing(null);
    setPoolWizardForceRequired(false);
    if (poolWizardOpenedByAutoRef.current) {
      try {
        window.sessionStorage.setItem(MUST_BIND_POOL_DISMISS_KEY, '1');
      } catch {
        /* ignore */
      }
      poolWizardOpenedByAutoRef.current = false;
    }
  }, []);

  const handlePoolWizardSuccess = useCallback(() => {
    setPoolWizardOpen(false);
    setPoolWizardEditing(null);
    setPoolWizardForceRequired(false);
    poolWizardOpenedByAutoRef.current = false;
    void loadSummaryClouds();
  }, [loadSummaryClouds]);

  /** 设定默认资源池：无池=添加；有池=编辑当前默认池（显式 default 或最早创建） */
  const openDefaultPoolWizardAction = useCallback(() => {
    poolWizardOpenedByAutoRef.current = false;
    setPoolWizardForceRequired(false);
    if (!summaryClouds.length) {
      setPoolWizardEditing(null);
    } else {
      const def = resolveDefaultPool(summaryClouds.filter((c) => !isCsmCloud(c)));
      setPoolWizardEditing(def ?? null);
    }
    setPoolWizardOpen(true);
  }, [summaryClouds]);

  return {
    poolWizardOpen,
    poolWizardEditing,
    poolWizardForceRequired,
    handlePoolWizardCancel,
    handlePoolWizardSuccess,
    openDefaultPoolWizardAction,
  };
}
