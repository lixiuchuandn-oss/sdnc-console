import {
  applyImagePullSecretsToK8sResource,
  extractImagePullSecretNamesFromK8sResource,
  extractImagesFromK8sResource,
} from './k8sResourceImages';

describe('k8sResourceImages', () => {
  it('extracts images from Deployment pod template', () => {
    const resource = {
      kind: 'Deployment',
      metadata: { name: 'app', namespace: 'prod' },
      spec: {
        template: {
          spec: {
            containers: [{ image: 'harbor.local/proj/app:1.0' }],
            initContainers: [{ image: 'harbor.local/proj/init:1.0' }],
          },
        },
      },
    };

    expect(extractImagesFromK8sResource(resource)).toEqual([
      'harbor.local/proj/app:1.0',
      'harbor.local/proj/init:1.0',
    ]);
  });

  it('extracts images from CronJob job template', () => {
    const resource = {
      kind: 'CronJob',
      metadata: { namespace: 'batch' },
      spec: {
        jobTemplate: {
          spec: {
            template: {
              spec: {
                containers: [{ image: 'harbor.local/proj/job:latest' }],
              },
            },
          },
        },
      },
    };

    expect(extractImagesFromK8sResource(resource)).toEqual(['harbor.local/proj/job:latest']);
  });

  it('applies imagePullSecrets to Job pod template', () => {
    const resource = {
      kind: 'Job',
      metadata: { namespace: 'default' },
      spec: {
        template: {
          spec: {
            containers: [{ image: 'harbor.local/proj/job:latest' }],
          },
        },
      },
    };

    const updated = applyImagePullSecretsToK8sResource(resource, [
      'harbor-abc-pull-secret',
      'harbor-abc-pull-secret',
    ]);

    expect(extractImagePullSecretNamesFromK8sResource(updated)).toEqual(['harbor-abc-pull-secret']);
  });
});
