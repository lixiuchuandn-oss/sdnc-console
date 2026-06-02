import React from 'react';

import WorkloadFormStepAdvanced from './WorkloadFormStepAdvanced';
import type { WorkloadFormStepAdvancedProps } from './WorkloadFormStepAdvanced';
import WorkloadFormStepBasic from './WorkloadFormStepBasic';
import type { WorkloadFormStepBasicProps } from './WorkloadFormStepBasic';
import WorkloadFormStepContainers from './WorkloadFormStepContainers';
import type { WorkloadFormStepContainersProps } from './WorkloadFormStepContainers';
import WorkloadFormStepNetwork from './WorkloadFormStepNetwork';
import type { WorkloadFormStepNetworkProps } from './WorkloadFormStepNetwork';
import WorkloadFormStepStorage from './WorkloadFormStepStorage';
import type { WorkloadFormStepStorageProps } from './WorkloadFormStepStorage';

export interface WorkloadFormStepContentProps {
  currentStep: number;
  basic: WorkloadFormStepBasicProps;
  containers: WorkloadFormStepContainersProps;
  network: WorkloadFormStepNetworkProps;
  storage: WorkloadFormStepStorageProps;
  advanced: WorkloadFormStepAdvancedProps;
}

const WorkloadFormStepContent: React.FC<WorkloadFormStepContentProps> = ({
  currentStep,
  basic,
  containers,
  network,
  storage,
  advanced,
}) => {
  switch (currentStep) {
    case 0:
      return <WorkloadFormStepBasic {...basic} />;
    case 1:
      return <WorkloadFormStepContainers {...containers} />;
    case 2:
      return <WorkloadFormStepNetwork {...network} />;
    case 3:
      return <WorkloadFormStepStorage {...storage} />;
    case 4:
      return <WorkloadFormStepAdvanced {...advanced} />;
    default:
      return null;
  }
};

export default WorkloadFormStepContent;
