import type { RancherClusterWorkloadsSubKey } from '../../../../../../../layouts/admin/rancher/rancherClusterSidebar';

/** 各工作负载类型的默认可编辑 YAML（用户可按集群情况修改后创建） */
export function getDefaultWorkloadYaml(kind: RancherClusterWorkloadsSubKey): string {
  switch (kind) {
    case 'deployment':
      return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-deploy
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: example-deploy
  template:
    metadata:
      labels:
        app: example-deploy
    spec:
      containers:
        - name: main
          image: nginx:alpine
`;
    case 'statefulset':
      return `# 若创建失败：请先在同一命名空间创建名为 web 的 Headless Service，或修改 spec.serviceName
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
  namespace: default
spec:
  serviceName: web
  replicas: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: main
          image: nginx:alpine
`;
    case 'daemonset':
      return `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: example-ds
  namespace: default
spec:
  selector:
    matchLabels:
      name: example-ds
  template:
    metadata:
      labels:
        name: example-ds
    spec:
      containers:
        - name: main
          image: busybox:1.36
          command: ["/bin/sh", "-c", "sleep 3600"]
`;
    case 'cronjob':
      return `apiVersion: batch/v1
kind: CronJob
metadata:
  name: hello
  namespace: default
spec:
  schedule: "*/30 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: main
              image: busybox:1.36
              command: ["/bin/sh", "-c", "date; echo done"]
`;
    case 'job':
      return `apiVersion: batch/v1
kind: Job
metadata:
  name: example-job
  namespace: default
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: main
          image: busybox:1.36
          command: ["/bin/sh", "-c", "echo hello && sleep 5"]
`;
    case 'pod':
      return `apiVersion: v1
kind: Pod
metadata:
  name: test-pod
  namespace: default
spec:
  containers:
    - name: main
      image: nginx:alpine
`;
    default:
      return '';
  }
}
