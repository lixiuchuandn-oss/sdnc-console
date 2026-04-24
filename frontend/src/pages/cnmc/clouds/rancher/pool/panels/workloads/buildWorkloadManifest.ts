import type { RancherWorkloadKind } from '../../../../../../../services/rancherClusterApi';

export type WorkloadFormValues = {
  namespace: string;
  name: string;
  containerName: string;
  image: string;
  replicas?: number;
  port?: number | null;
  serviceName?: string;
  schedule?: string;
  command?: string;
};

function appLabels(name: string) {
  const safe = name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'app';
  return { app: safe };
}

/**
 * 由表单值生成与后端 `POST .../workloads/:kind` 约定一致的 K8s 对象
 */
export function buildManifestFromForm(
  kind: RancherWorkloadKind,
  v: WorkloadFormValues,
): Record<string, unknown> {
  const ns = v.namespace.trim();
  const n = v.name.trim();
  const cname = (v.containerName || 'main').trim() || 'main';
  const image = v.image.trim();
  const port = v.port != null && v.port > 0 ? v.port : undefined;
  const labels = appLabels(n);

  const containerPort =
    port != null
      ? {
          name: 'tcp',
          containerPort: port,
          protocol: 'TCP' as const,
        }
      : undefined;

  const baseContainer: Record<string, unknown> = {
    name: cname,
    image,
    imagePullPolicy: 'IfNotPresent',
  };
  if (containerPort) {
    baseContainer.ports = [containerPort];
  }

  if (v.command && v.command.trim()) {
    baseContainer.command = ['/bin/sh', '-c', v.command.trim()];
  }

  const podTemplate = {
    metadata: { labels },
    spec: {
      restartPolicy: 'Always' as const,
      containers: [baseContainer],
    },
  };

  switch (kind) {
    case 'deployment': {
      const reps = v.replicas != null && v.replicas > 0 ? v.replicas : 1;
      return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: n, namespace: ns },
        spec: {
          replicas: reps,
          selector: { matchLabels: labels },
          template: podTemplate,
        },
      };
    }
    case 'statefulset': {
      const reps = v.replicas != null && v.replicas > 0 ? v.replicas : 1;
      const svc = (v.serviceName || n).trim();
      return {
        apiVersion: 'apps/v1',
        kind: 'StatefulSet',
        metadata: { name: n, namespace: ns },
        spec: {
          serviceName: svc,
          replicas: reps,
          selector: { matchLabels: labels },
          template: podTemplate,
        },
      };
    }
    case 'daemonset': {
      return {
        apiVersion: 'apps/v1',
        kind: 'DaemonSet',
        metadata: { name: n, namespace: ns },
        spec: {
          selector: { matchLabels: labels },
          template: podTemplate,
        },
      };
    }
    case 'job': {
      const ctr: Record<string, unknown> = {
        name: cname,
        image,
        imagePullPolicy: 'IfNotPresent',
      };
      if (containerPort) {
        ctr.ports = [containerPort];
      }
      if (v.command && v.command.trim()) {
        ctr.command = ['/bin/sh', '-c', v.command.trim()];
      }
      return {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: n, namespace: ns },
        spec: {
          template: {
            metadata: { labels },
            spec: {
              restartPolicy: 'Never',
              containers: [ctr],
            },
          },
        },
      };
    }
    case 'cronjob': {
      const sched = (v.schedule || '0 * * * *').trim();
      const c: Record<string, unknown> = {
        name: cname,
        image,
        imagePullPolicy: 'IfNotPresent',
      };
      if (v.command && v.command.trim()) {
        c.command = ['/bin/sh', '-c', v.command.trim()];
      }
      if (port) {
        c.ports = [containerPort];
      }
      return {
        apiVersion: 'batch/v1',
        kind: 'CronJob',
        metadata: { name: n, namespace: ns },
        spec: {
          schedule: sched,
          jobTemplate: {
            spec: {
              template: {
                metadata: { labels },
                spec: {
                  restartPolicy: 'OnFailure',
                  containers: [c],
                },
              },
            },
          },
        },
      };
    }
    case 'pod': {
      return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: n, namespace: ns },
        spec: {
          restartPolicy: 'Always',
          containers: [baseContainer],
        },
      };
    }
    default:
      throw new Error('不支持的工作负载类型');
  }
}

export function defaultFormValues(
  kind: RancherWorkloadKind,
  firstNamespace: string,
): WorkloadFormValues {
  const base: WorkloadFormValues = {
    namespace: firstNamespace || 'default',
    name: '',
    containerName: 'main',
    image: 'nginx:alpine',
    replicas: 1,
    port: undefined,
    serviceName: '',
    schedule: '0 * * * *',
    command: '',
  };
  if (kind === 'job' || kind === 'cronjob') {
    return { ...base, image: 'busybox:1.36', command: "echo 'hello'" };
  }
  return base;
}
