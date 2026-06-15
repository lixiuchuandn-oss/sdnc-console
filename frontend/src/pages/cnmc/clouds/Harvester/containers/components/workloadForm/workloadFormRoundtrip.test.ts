import { buildK8sResource } from './buildK8sResource';
import { createEmptyContainer } from './containerDefaults';
import { parseEditWorkloadFormInit } from './parseEditWorkloadFormInit';
import type { WorkloadContainerFormValue, WorkloadFormValues } from './types';

jest.mock('../../../../../../../utils/harvesterUtils', () => ({
  generateHarvesterCrMetadataName: () => 'wl-roundtrip-cr',
  generateVmWizardStyleDisplayName: (name: string) => name,
}));

function minimalFormValues(
  container: Partial<WorkloadContainerFormValue>,
  rest: Partial<WorkloadFormValues>,
): WorkloadFormValues {
  const main = { ...createEmptyContainer('main'), ...container };
  return {
    name: 'app',
    namespace: 'default',
    workloadType: 'deployment',
    labels: [],
    containers: [main],
    containerName: main.containerName,
    image: main.image,
    imagePullPolicy: main.imagePullPolicy,
    ports: main.ports,
    env: main.env,
    resources: main.resources,
    replicas: 1,
    imagePullSecrets: [],
    nodeSelector: [],
    networkType: 'default',
    ...rest,
  };
}

describe('workloadForm build → parse roundtrip', () => {
  it('preserves deployment basics after build and parseEditWorkloadFormInit', () => {
    const values = minimalFormValues(
      { image: 'nginx:1.27', containerName: 'web' },
      { name: 'edge-app', namespace: 'staging', replicas: 3 },
    );

    const resource = buildK8sResource(values, []);
    const init = parseEditWorkloadFormInit(resource, 'deployment');

    expect(init).not.toBeNull();
    expect(init!.formValues.workloadType).toBe('deployment');
    expect(init!.formValues.namespace).toBe('staging');
    expect(init!.formValues.replicas).toBe(3);
    expect(init!.formValues.containers).toHaveLength(1);
    expect(init!.formValues.containers![0].image).toBe('nginx:1.27');
    expect(init!.formValues.containers![0].containerName).toBe('web');
    expect(init!.formValues.networkType).toBe('default');
  });

  it('roundtrips flat_subnet network fields (parse maps logical_switch to vpc)', () => {
    const values = minimalFormValues(
      { image: 'busybox' },
      {
        name: 'net-app',
        networkType: 'flat_subnet',
        flatSubnet: 'default/flat-net',
        enableStaticIP: true,
        staticIP: '10.0.0.42',
      },
    );

    const resource = buildK8sResource(values, []);
    const init = parseEditWorkloadFormInit(resource, 'deployment');

    expect(init).not.toBeNull();
    // 存量行为：build 写 logical_switch，parse 识别为 vpc 网络类型
    expect(init!.formValues.networkType).toBe('vpc');
    expect(init!.formValues.enableStaticIP).toBe(true);
    expect(init!.formValues.staticIP).toBe('10.0.0.42');
  });
});
