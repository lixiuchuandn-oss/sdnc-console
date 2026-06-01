/**
 * WorkloadForm 常量与默认 YAML 模板
 */
import React from 'react';
import {
  ProfileOutlined,
  AppstoreOutlined,
  FolderOutlined,
  SettingOutlined,
} from '@ant-design/icons';

export const CPU_UNITS = [
  { label: 'm', value: 'm' },
  { label: '核', value: '' },
];

export const MEMORY_UNITS = [
  { label: 'MiB', value: 'Mi' },
  { label: 'GiB', value: 'Gi' },
];

export const EMPTY_DIR_SIZE_UNITS = [
  { label: 'Mi', value: 'Mi' },
  { label: 'Gi', value: 'Gi' },
  { label: 'G', value: 'G' },
  { label: 'Ti', value: 'Ti' },
  { label: 'T', value: 'T' },
  { label: 'Pi', value: 'Pi' },
];

export const WORKLOAD_TYPE_OPTIONS = [
  { value: 'deployment', label: 'Deployment', desc: '无状态应用，支持弹性伸缩' },
  { value: 'statefulset', label: 'StatefulSet', desc: '有状态应用，稳定网络标识' },
  { value: 'daemonset', label: 'DaemonSet', desc: '守护进程，每个节点运行' },
];

export const IMAGE_PULL_POLICY_OPTIONS = [
  { value: 'IfNotPresent', label: 'IfNotPresent (本地优先)' },
  { value: 'Always', label: 'Always (始终拉取)' },
  { value: 'Never', label: 'Never (从不拉取)' },
];

export const PROTOCOL_OPTIONS = [
  { value: 'TCP', label: 'TCP' },
  { value: 'UDP', label: 'UDP' },
];

export const PROBE_TYPE_OPTIONS = [
  { value: 'httpGet', label: 'HTTP 请求' },
  { value: 'tcpSocket', label: 'TCP 端口' },
  { value: 'exec', label: '执行命令' },
];

// 节点选择器操作符选项
export const NODE_SELECTOR_OPERATOR_OPTIONS = [
  { value: 'In', label: 'In (值在列表中)' },
  { value: 'NotIn', label: 'NotIn (值不在列表中)' },
  { value: 'Exists', label: 'Exists (标签存在)' },
  { value: 'DoesNotExist', label: 'DoesNotExist (标签不存在)' },
  { value: 'Gt', label: 'Gt (大于)' },
  { value: 'Lt', label: 'Lt (小于)' },
];

// Pod 选择器操作符选项 (用于 Pod 亲和性)
export const POD_SELECTOR_OPERATOR_OPTIONS = [
  { value: 'In', label: 'In (值在列表中)' },
  { value: 'NotIn', label: 'NotIn (值不在列表中)' },
  { value: 'Exists', label: 'Exists (标签存在)' },
  { value: 'DoesNotExist', label: 'DoesNotExist (标签不存在)' },
];

// 常用拓扑域键选项
export const TOPOLOGY_KEY_OPTIONS = [
  { value: 'kubernetes.io/hostname', label: 'kubernetes.io/hostname (同一节点)' },
  { value: 'topology.kubernetes.io/zone', label: 'topology.kubernetes.io/zone (同一可用区)' },
  { value: 'topology.kubernetes.io/region', label: 'topology.kubernetes.io/region (同一区域)' },
];

// 污点容忍操作符选项
export const TOLERATION_OPERATOR_OPTIONS = [
  { value: 'Equal', label: 'Equal (匹配键值)' },
  { value: 'Exists', label: 'Exists (键存在)' },
];

// 污点效果选项
export const TOLERATION_EFFECT_OPTIONS = [
  { value: 'NoSchedule', label: 'NoSchedule (不调度新 Pod)' },
  { value: 'PreferNoSchedule', label: 'PreferNoSchedule (尽量不调度)' },
  { value: 'NoExecute', label: 'NoExecute (不调度且驱逐现有 Pod)' },
  { value: 'All', label: 'All (匹配所有效果)' },
];

// 常用污点预设
export const COMMON_TOLERATION_PRESETS = [
  { key: 'node-role.kubernetes.io/master', label: 'Master 节点' },
  { key: 'node-role.kubernetes.io/control-plane', label: '控制平面节点' },
  { key: 'node.kubernetes.io/not-ready', label: '节点未就绪' },
  { key: 'node.kubernetes.io/unreachable', label: '节点不可达' },
  { key: 'node.kubernetes.io/disk-pressure', label: '磁盘压力' },
  { key: 'node.kubernetes.io/memory-pressure', label: '内存压力' },
  { key: 'node.kubernetes.io/pid-pressure', label: 'PID 压力' },
  { key: 'node.kubernetes.io/network-unavailable', label: '网络不可用' },
];

export const VOLUME_TYPE_OPTIONS = [
  { value: 'configMap', label: 'ConfigMap', desc: '挂载配置数据' },
  { value: 'secret', label: 'Secret', desc: '挂载敏感数据' },
  { value: 'persistentVolumeClaim', label: 'PVC', desc: '持久化存储卷' },
  { value: 'emptyDir', label: 'EmptyDir', desc: '临时存储' },
  { value: 'hostPath', label: 'HostPath', desc: '节点路径' },
];

// HostPath 类型选项
export const HOST_PATH_TYPE_OPTIONS = [
  { value: 'Directory', label: 'Directory (目录)' },
  { value: 'DirectoryOrCreate', label: 'DirectoryOrCreate (目录，不存在则创建)' },
  { value: 'File', label: 'File (文件)' },
  { value: 'FileOrCreate', label: 'FileOrCreate (文件，不存在则创建)' },
  { value: 'Socket', label: 'Socket (套接字)' },
  { value: 'CharDevice', label: 'CharDevice (字符设备)' },
  { value: 'BlockDevice', label: 'BlockDevice (块设备)' },
];

// EmptyDir 存储介质选项
export const EMPTY_DIR_MEDIUM_OPTIONS = [
  { value: 'default', label: '默认 (节点磁盘)' },
  { value: 'Memory', label: 'Memory (内存临时存储)' },
];

export const WORKLOAD_STEPS = [
  { key: 'basic', title: '基本信息', icon: <ProfileOutlined /> },
  { key: 'containers', title: '容器配置', icon: <AppstoreOutlined /> },
  { key: 'network', title: '网络配置', icon: <AppstoreOutlined /> },
  { key: 'storage', title: '存储配置', icon: <FolderOutlined /> },
  { key: 'advanced', title: '高级配置', icon: <SettingOutlined /> },
];

export const DEFAULT_DEPLOYMENT_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: default
  labels:
    app: my-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 80
              protocol: TCP
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
`;

export const DEFAULT_STATEFULSET_YAML = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-app
  namespace: default
  labels:
    app: my-app
spec:
  replicas: 1
  serviceName: my-app
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 80
              protocol: TCP
`;

export const DEFAULT_DAEMONSET_YAML = `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: my-app
  namespace: default
  labels:
    app: my-app
spec:
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 80
              protocol: TCP
`;
