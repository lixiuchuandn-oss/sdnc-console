import {
  parseEditWorkloadFormInit,
  parseK8sContainerToFormValue,
  resolveWorkloadTypeFromEditResource,
} from './parseEditWorkloadFormInit';

describe('resolveWorkloadTypeFromEditResource', () => {
  it('detects deployment from kind', () => {
    expect(resolveWorkloadTypeFromEditResource({ kind: 'Deployment' }, 'statefulset')).toBe(
      'deployment',
    );
  });

  it('falls back to defaultType', () => {
    expect(resolveWorkloadTypeFromEditResource({}, 'daemonset')).toBe('daemonset');
  });
});

describe('parseK8sContainerToFormValue', () => {
  it('maps container ports and resources', () => {
    const result = parseK8sContainerToFormValue({
      name: 'app',
      image: 'nginx:1.25',
      ports: [{ containerPort: 80, protocol: 'TCP' }],
      resources: { requests: { cpu: '100m', memory: '128Mi' } },
    });
    expect(result.containerName).toBe('app');
    expect(result.image).toBe('nginx:1.25');
    expect(result.ports).toEqual([{ containerPort: 80, protocol: 'TCP', name: undefined }]);
    expect(result.resources.requests).toEqual({ cpu: '100m', memory: '128Mi' });
  });
});

describe('parseEditWorkloadFormInit', () => {
  it('builds form values and yaml for a minimal deployment', () => {
    const editData = {
      kind: 'Deployment',
      metadata: {
        name: 'my-app',
        namespace: 'prod',
        labels: { app: 'my-app' },
        annotations: { 'tower.io/alias': 'My App' },
      },
      spec: {
        replicas: 2,
        template: {
          metadata: { annotations: {} },
          spec: {
            containers: [
              {
                name: 'main',
                image: 'busybox:latest',
              },
            ],
          },
        },
      },
    };

    const init = parseEditWorkloadFormInit(editData, 'deployment');
    expect(init).not.toBeNull();
    expect(init!.formValues.workloadType).toBe('deployment');
    expect(init!.formValues.name).toBe('My App');
    expect(init!.formValues.namespace).toBe('prod');
    expect(init!.formValues.replicas).toBe(2);
    expect(init!.formValues.containers).toHaveLength(1);
    expect(init!.formValues.containers![0].image).toBe('busybox:latest');
    expect(init!.yamlContent).toContain('kind: Deployment');
    expect(init!.yamlContent).not.toContain('managedFields');
  });
});
