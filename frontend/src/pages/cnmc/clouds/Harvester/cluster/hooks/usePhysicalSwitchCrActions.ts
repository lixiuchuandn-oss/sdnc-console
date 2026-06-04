/**
 * 物理交换机 Section · Switch CR 增删改与抽屉动作
 */
import { useCallback } from 'react';
import { message } from 'antd';
import {
  createHmsSwitchCr,
  deleteHmsSwitchCr,
  updateHmsSwitchCr,
  type HmsSwitchCr,
  type HmsSwitchCrSpec,
} from 'services/harvester/cluster';
import { apiErrorMessage } from '../lib/physicalSwitchesSectionUtils';
import { confirmHighRiskDelete } from '../../shared/lib/highRiskConfirm';

export type UsePhysicalSwitchCrActionsOptions = {
  cloudId: string;
  canManageSwitchCr: boolean;
  editingSwitchCr: HmsSwitchCr | null;
  hmsSwitchConfigs: HmsSwitchCr[];
  loadAll: () => Promise<void>;
  closeConfigDrawer: () => void;
  setConfigSaving: (v: boolean) => void;
};

export function usePhysicalSwitchCrActions({
  cloudId,
  canManageSwitchCr,
  editingSwitchCr,
  hmsSwitchConfigs,
  loadAll,
  closeConfigDrawer,
  setConfigSaving,
}: UsePhysicalSwitchCrActionsOptions) {
  const handleDeleteSwitchCr = useCallback(
    (cr: HmsSwitchCr) => {
      const name = String(cr?.metadata?.name || '').trim();
      if (!name || !canManageSwitchCr) return;
      void confirmHighRiskDelete({
        resourceLabel: '交换机',
        name,
        description: '删除后 HSM 将不再管理该交换机。',
        onConfirm: async () => {
          try {
            await deleteHmsSwitchCr(cloudId, name);
            message.success('已删除');
            await loadAll();
          } catch (e) {
            message.error(apiErrorMessage(e, '删除失败'));
          }
        },
      }).catch(() => {});
    },
    [canManageSwitchCr, cloudId, loadAll],
  );

  const handleSubmitSwitchCr = useCallback(
    async (payload: { name: string; spec: Record<string, unknown> }) => {
      if (!canManageSwitchCr) return;
      const name = String(payload.name || '').trim();
      if (!editingSwitchCr?.metadata?.name) {
        const exists = hmsSwitchConfigs.some(
          (c) => String(c?.metadata?.name || '').trim() === name,
        );
        if (exists) {
          message.error(`配置名称「${name}」已存在，请更换名称后重试`);
          return;
        }
      }

      setConfigSaving(true);
      try {
        if (editingSwitchCr?.metadata?.name) {
          await updateHmsSwitchCr(cloudId, editingSwitchCr.metadata.name, {
            spec: payload.spec as HmsSwitchCrSpec,
          });
          message.success('配置已更新');
        } else {
          await createHmsSwitchCr(cloudId, {
            name,
            spec: payload.spec as HmsSwitchCrSpec,
          });
          message.success('配置已创建');
        }
        closeConfigDrawer();
        await loadAll();
      } catch (e) {
        message.error(apiErrorMessage(e, '保存失败'));
      } finally {
        setConfigSaving(false);
      }
    },
    [
      canManageSwitchCr,
      cloudId,
      closeConfigDrawer,
      editingSwitchCr,
      hmsSwitchConfigs,
      loadAll,
      setConfigSaving,
    ],
  );

  return { handleDeleteSwitchCr, handleSubmitSwitchCr };
}
