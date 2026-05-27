/**
 * 物理交换机 Section · Switch CR 增删改与抽屉动作
 */
import { useCallback } from 'react';
import { message, Modal } from 'antd';
import {
  createHmsSwitchCr,
  deleteHmsSwitchCr,
  updateHmsSwitchCr,
  type HmsSwitchCr,
  type HmsSwitchCrSpec,
} from 'services/harvester/cluster';
import { apiErrorMessage } from '../lib/physicalSwitchesSectionUtils';

export type UsePhysicalSwitchCrActionsOptions = {
  cloudId: string;
  canManageSwitchCr: boolean;
  editingSwitchCr: HmsSwitchCr | null;
  loadAll: () => Promise<void>;
  closeConfigDrawer: () => void;
  setConfigSaving: (v: boolean) => void;
};

export function usePhysicalSwitchCrActions({
  cloudId,
  canManageSwitchCr,
  editingSwitchCr,
  loadAll,
  closeConfigDrawer,
  setConfigSaving,
}: UsePhysicalSwitchCrActionsOptions) {
  const handleDeleteSwitchCr = useCallback(
    (cr: HmsSwitchCr) => {
      const name = String(cr?.metadata?.name || '').trim();
      if (!name || !canManageSwitchCr) return;
      Modal.confirm({
        title: `删除交换机「${name}」？`,
        content: '删除后 HSM 将不再管理该交换机。',
        okText: '删除',
        okButtonProps: { danger: true },
        onOk: async () => {
          await deleteHmsSwitchCr(cloudId, name);
          message.success('已删除');
          await loadAll();
        },
      });
    },
    [canManageSwitchCr, cloudId, loadAll],
  );

  const handleSubmitSwitchCr = useCallback(
    async (payload: { name: string; spec: Record<string, unknown> }) => {
      if (!canManageSwitchCr) return;
      setConfigSaving(true);
      try {
        if (editingSwitchCr?.metadata?.name) {
          await updateHmsSwitchCr(cloudId, editingSwitchCr.metadata.name, {
            spec: payload.spec as HmsSwitchCrSpec,
          });
          message.success('配置已更新');
        } else {
          await createHmsSwitchCr(cloudId, {
            name: payload.name,
            spec: payload.spec as HmsSwitchCrSpec,
          });
          message.success('配置已创建');
        }
        closeConfigDrawer();
        await loadAll();
      } catch (e) {
        message.error(apiErrorMessage(e, '保存失败'));
        throw e;
      } finally {
        setConfigSaving(false);
      }
    },
    [canManageSwitchCr, cloudId, closeConfigDrawer, editingSwitchCr, loadAll, setConfigSaving],
  );

  return { handleDeleteSwitchCr, handleSubmitSwitchCr };
}
