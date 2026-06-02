import type { MessageInstance } from 'antd/es/message/interface';

import type { WorkloadContainerFormValue } from '../types';
import type { WorkloadSubmitFailure } from './types';

export function applyWorkloadSubmitFailure(
  failure: WorkloadSubmitFailure,
  callbacks: {
    message: MessageInstance;
    setCurrentStep: (step: number) => void;
    setActiveContainerIndex: (index: number) => void;
    syncContainerEditorToForm: (container: WorkloadContainerFormValue) => void;
  },
): void {
  if (failure.message) {
    if (failure.severity === 'warning') {
      callbacks.message.warning(failure.message);
    } else {
      callbacks.message.error(failure.message);
    }
  }

  const action = failure.action;
  if (!action) return;

  if (action.type === 'set_step') {
    callbacks.setCurrentStep(action.step);
    return;
  }

  callbacks.setCurrentStep(action.step);
  callbacks.setActiveContainerIndex(action.containerIndex);
  callbacks.syncContainerEditorToForm(action.container);
}
