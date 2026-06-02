import { Modal } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';

import {
  createHarvesterContainerResource,
  updateHarvesterContainerResource,
} from '../../../../../../../../services/harvesterApi';
import { parseK8sError } from '../k8sErrors';
import type { WorkloadSubmitPayload } from './types';

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
    Modal.confirm({
      title: '版本冲突',
      content: '该资源已被其他用户修改，请刷新后重新编辑。',
      okText: '确认刷新',
      cancelText: '取消',
      onOk: () => {
        onSuccess();
      },
    });
    return;
  }

  message.error(parseK8sError(error));
}
