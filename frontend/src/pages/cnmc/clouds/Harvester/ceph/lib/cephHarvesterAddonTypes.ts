/** Harvester rook-ceph Addon 类型与默认镜像常量 */

export type CephHarvesterAddonPhase =
  | 'not_installed'
  | 'success'
  | 'progress'
  | 'failed'
  | 'disabled'
  | 'unknown';

export type CephHarvesterAddonNodeDevice = {
  nodeName: string;
  deviceName: string;
  metadataDevice?: string;
  /** 每盘 BlueStore DB 容量（MB）；与 hms-ceph values `databaseSizeMB` 对齐 */
  databaseSizeMB?: number;
};

/** 向导表单：每行一个节点，数据盘多选 */
export type CephHarvesterAddonNodeFormRow = {
  nodeName: string;
  deviceNames: string[];
  metadataDevice?: string;
  databaseSizeMB?: number;
};

export type CephHarvesterAddonValuesConfig = {
  replicaSize: number;
  requireSafeReplicaSize: boolean;
  compressionMode: string;
  storageClass: {
    jobImage: string;
    reclaimPolicy: 'Delete' | 'Retain';
    allowVolumeExpansion: boolean;
    volumeBindingMode: 'Immediate' | 'WaitForFirstConsumer';
  };
  cephtools: {
    replicas: number;
    image: string;
  };
  cephCluster: {
    cephVersionImage: string;
    allowUnsupported: boolean;
    monCount: number;
    allowMultipleMonPerNode: boolean;
    mgrCount: number;
    dashboardEnabled: boolean;
    useAllNodes: boolean;
    useAllDevices: boolean;
    nodes: CephHarvesterAddonNodeDevice[];
    osdsPerDevice: string;
    osdObjectstore: string;
    metadataDevice: string;
  };
  operator: {
    replicas: number;
    image: string;
  };
};

/** 向导 Form 值（节点行含 deviceNames 多选） */
export type CephHarvesterAddonFormValues = Omit<CephHarvesterAddonValuesConfig, 'cephCluster'> & {
  cephCluster: Omit<CephHarvesterAddonValuesConfig['cephCluster'], 'nodes'> & {
    nodes: CephHarvesterAddonNodeFormRow[];
  };
};

export type CephHarvesterAddonFormValuesWithOverride = CephHarvesterAddonFormValues & {
  valuesContentOverride?: string;
};

export type CephHarvesterAddonStatus = {
  exists: boolean;
  enabled: boolean;
  deployStatus: string;
  phase: CephHarvesterAddonPhase;
  message: string;
  valuesContent?: string | null;
  config?: CephHarvesterAddonValuesConfig | null;
};

export type CephHarvesterAddonApplyPayload = {
  config?: CephHarvesterAddonValuesConfig;
  replicaSize?: number;
  nodes?: CephHarvesterAddonNodeDevice[];
  valuesContent?: string;
};

export const CEPH_HARVESTER_DEFAULT_CEPH_IMAGE = 'quay.io/ceph/ceph:v19.2.3';
export const CEPH_HARVESTER_DEFAULT_ROOK_OPERATOR_IMAGE = 'docker.io/rook/ceph:v1.19.3';
