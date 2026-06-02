import type { MessageInstance } from 'antd/es/message/interface';

import {
  createHarvesterContainerResource,
  updateHarvesterContainerResource,
} from '../../../../../../../../services/harvesterApi';
import { parseK8sError } from '../k8sErrors';
import type { WorkloadSubmitPayload } from './types';
import { confirmHighRiskOperation } from '../../../../shared/lib/highRiskConfirm';

export async function executeWorkloadSubmit(params: {
  cloudId: string;
  isEditMode: boolean;
  payload: WorkloadSubmitPayload;
  message: MessageInstance;
  onSuccess: () => void;
}): Promise<void> {
  const { cloudId, isEditMode, payload, message, onSuccess } = params;
  const { resource, apiPath, namespace, name } = payload;

  if (isEditMode) {
    await updateHarvesterContainerResource(cloudId, apiPath, namespace, name, resource);
    message.success('工作负载更新成功');
  } else {
    await createHarvesterContainerResource(cloudId, apiPath, namespace, resource);
    message.success('工作负载创建成功');
  }

  onSuccess();
}

export function handleWorkloadSubmitError(params: {
  error: unknown;
  isEditMode: boolean;
  message: MessageInstance;
  onSuccess: () => void;
}): void {
  const { error, isEditMode, message, onSuccess } = params;
  console.error(isEditMode ? '更新工作负载失败:' : '创建工作负载失败:', error);

  const err = error as {
    response?: { status?: number };
    status?: number;
    message?: string;
  };

  const isConflict =
    err?.response?.status === 409 ||
    err?.status === 409 ||
    /conflict/i.test(err?.message || '') ||
    /resourceVersion/i.test(err?.message || '');

  if (isConflict) {
    void confirmHighRiskOperation({
      title: '版本冲突',
      description: '该资源已被其他用户修改，请刷新后重新编辑。',
      riskItems: [
        '直接覆盖可能丢失他人变更或引发资源版本冲突。',
        '刷新后将关闭当前编辑窗口，未保存的修改会丢失。',
      ],
      requireTypeConfirm: false,
      operationSummary: isEditMode ? '刷新后重新编辑工作负载' : '刷新后重新创建工作负载',
      confirmText: '确认刷新',
      onConfirm: () => {
        onSuccess();
      },
    }).catch(() => {});
    return;
  }

  message.error(parseK8sError(error));
}
