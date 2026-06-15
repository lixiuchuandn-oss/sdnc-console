/** 云盘列表 Section 视图模型（由 K8s PVC / 包装对象归一化） */
export interface VolumeView {
  key: string;
  name: string;
  alias?: string;
  namespace: string;
  pvName: string;
  phase: string;
  capacityRaw: string;
  capacityBytes: number;
  storageClass: string;
  accessModes: string[];
  volumeMode: string;
  creationTimestamp: string;
  attachedTo: string[];
  workloadConsumers?: Array<{ kind: string; name: string }>;
  links?: { view?: string };
  raw: unknown;
}

export type VolumeSectionOnRefresh = (
  force?: boolean,
  silent?: boolean,
) => void | Promise<void>;
