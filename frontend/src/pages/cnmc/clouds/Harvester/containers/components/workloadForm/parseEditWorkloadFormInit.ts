import yaml from 'js-yaml';

import { createEmptyContainer, toContainerEditorFields } from './containerDefaults';
import type {
  NodeAffinityConfig,
  NodeSelectorOperator,
  NodeSelectorRequirement,
  NodeSelectorTerm,
  PodAffinityConfig,
  PodAffinityTerm,
  PodLabelSelectorRequirement,
  PreferredSchedulingTerm,
  VolumeConfig,
  WeightedPodAffinityTerm,
  WorkloadContainerFormValue,
  WorkloadFormValues,
  WorkloadType,
} from './types';

const DNS_POLICY_VALUES = ['Default', 'ClusterFirst', 'ClusterFirstWithHostNet', 'None'] as const;

function toNodeSelectorRequirement(raw: Record<string, unknown>): NodeSelectorRequirement {
  return {
    key: String(raw.key ?? ''),
    operator: raw.operator as NodeSelectorOperator,
    values: raw.values as string[] | undefined,
  };
}

function toPodLabelSelectorRequirement(raw: Record<string, unknown>): PodLabelSelectorRequirement {
  return {
    key: String(raw.key ?? ''),
    operator: raw.operator as PodLabelSelectorRequirement['operator'],
    values: raw.values as string[] | undefined,
  };
}

function parseDnsPolicy(raw: unknown): WorkloadFormValues['dnsPolicy'] | undefined {
  if (typeof raw !== 'string') return undefined;
  return (DNS_POLICY_VALUES as readonly string[]).includes(raw)
    ? (raw as WorkloadFormValues['dnsPolicy'])
    : undefined;
}

export interface EditWorkloadFormInitResult {
  formValues: Partial<WorkloadFormValues>;
  yamlContent: string;
}

function parseProbe(probe: unknown) {
  if (!probe || typeof probe !== 'object') return undefined;
  const p = probe as Record<string, unknown>;
  const probeType: 'httpGet' | 'tcpSocket' | 'exec' = p.httpGet
    ? 'httpGet'
    : p.tcpSocket
      ? 'tcpSocket'
      : 'exec';
  const httpGet = p.httpGet as { path?: string; port?: number } | undefined;
  const tcpSocket = p.tcpSocket as { port?: number } | undefined;
  const exec = p.exec as { command?: string[] } | undefined;
  return {
    enabled: true,
    type: probeType,
    httpGet: httpGet ? { path: httpGet.path || '', port: httpGet.port ?? 80 } : undefined,
    tcpSocket: tcpSocket ? { port: tcpSocket.port ?? 80 } : undefined,
    exec: exec ? { command: exec.command || [] } : undefined,
    initialDelaySeconds: (p.initialDelaySeconds as number) || 0,
    periodSeconds: (p.periodSeconds as number) || 10,
  };
}

export function parseK8sContainerToFormValue(container: unknown): WorkloadContainerFormValue {
  const c = (container || {}) as Record<string, unknown>;
  const ports = (c.ports as unknown[]) || [];
  const env = (c.env as unknown[]) || [];
  const resources = (c.resources as Record<string, Record<string, string>>) || {};
  const volumeMounts = (c.volumeMounts as unknown[]) || [];

  return {
    containerName: (c.name as string) || '',
    image: (c.image as string) || '',
    imagePullPolicy:
      (c.imagePullPolicy as WorkloadContainerFormValue['imagePullPolicy']) || 'IfNotPresent',
    ports: ports.map((p) => {
      const port = p as Record<string, unknown>;
      return {
        containerPort: port.containerPort as number,
        protocol: (port.protocol as 'TCP' | 'UDP') || 'TCP',
        name: port.name as string | undefined,
      };
    }),
    env: env.map((e) => {
      const entry = e as Record<string, unknown>;
      const valueFrom = entry.valueFrom as Record<string, Record<string, string>> | undefined;
      return {
        type: valueFrom?.configMapKeyRef
          ? 'configMapKeyRef'
          : valueFrom?.secretKeyRef
            ? 'secretKeyRef'
            : 'keyValue',
        name: entry.name,
        value: entry.value,
        configMapName: valueFrom?.configMapKeyRef?.name,
        configMapKey: valueFrom?.configMapKeyRef?.key,
        secretName: valueFrom?.secretKeyRef?.name,
        secretKey: valueFrom?.secretKeyRef?.key,
      };
    }),
    resources: {
      requests: {
        cpu: resources?.requests?.cpu,
        memory: resources?.requests?.memory,
      },
      limits: {
        cpu: resources?.limits?.cpu,
        memory: resources?.limits?.memory,
      },
    },
    command: c.command as string[] | undefined,
    args: c.args as string[] | undefined,
    livenessProbe: parseProbe(c.livenessProbe),
    readinessProbe: parseProbe(c.readinessProbe),
    volumeMounts: volumeMounts.map((mount) => {
      const m = mount as Record<string, unknown>;
      return {
        name: m.name as string,
        mountPath: m.mountPath as string,
        subPath: m.subPath as string | undefined,
        readOnly: m.readOnly as boolean | undefined,
      };
    }),
  };
}

export function parseNodeAffinityFromK8s(affinity: unknown): NodeAffinityConfig | undefined {
  if (!affinity || typeof affinity !== 'object') return undefined;
  const a = affinity as Record<string, unknown>;
  const result: NodeAffinityConfig = {};

  const required = a.requiredDuringSchedulingIgnoredDuringExecution as
    | { nodeSelectorTerms?: unknown[] }
    | undefined;
  if (required?.nodeSelectorTerms) {
    result.required = {
      nodeSelectorTerms: required.nodeSelectorTerms.map((term) => {
        const t = term as Record<string, unknown>;
        const nodeTerm: NodeSelectorTerm = {
          matchExpressions: ((t.matchExpressions as unknown[]) || []).map((expr) =>
            toNodeSelectorRequirement(expr as Record<string, unknown>),
          ),
          matchFields: ((t.matchFields as unknown[]) || []).map((field) =>
            toNodeSelectorRequirement(field as Record<string, unknown>),
          ),
        };
        return nodeTerm;
      }),
    };
  }

  const preferred = a.preferredDuringSchedulingIgnoredDuringExecution as unknown[] | undefined;
  if (preferred?.length) {
    result.preferred = preferred.map((pref) => {
      const p = pref as Record<string, unknown>;
      const preference = p.preference as Record<string, unknown>;
      const term: PreferredSchedulingTerm = {
        weight: p.weight as number,
        preference: {
          matchExpressions: ((preference.matchExpressions as unknown[]) || []).map((expr) =>
            toNodeSelectorRequirement(expr as Record<string, unknown>),
          ),
          matchFields: ((preference.matchFields as unknown[]) || []).map((field) =>
            toNodeSelectorRequirement(field as Record<string, unknown>),
          ),
        },
      };
      return term;
    });
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function parsePodAffinityFromK8s(podAffinity: unknown): PodAffinityConfig | undefined {
  if (!podAffinity || typeof podAffinity !== 'object') return undefined;
  const pa = podAffinity as Record<string, unknown>;
  const result: PodAffinityConfig = {};

  const required = pa.requiredDuringSchedulingIgnoredDuringExecution as unknown[] | undefined;
  if (required?.length) {
    result.required = required.map((term) => {
      const t = term as Record<string, unknown>;
      const labelSelector = t.labelSelector as Record<string, unknown> | undefined;
      const podTerm: PodAffinityTerm = {
        labelSelector: labelSelector
          ? {
              matchLabels: (labelSelector.matchLabels as Record<string, string>) || {},
              matchExpressions: ((labelSelector.matchExpressions as unknown[]) || []).map((expr) =>
                toPodLabelSelectorRequirement(expr as Record<string, unknown>),
              ),
            }
          : undefined,
        namespaces: t.namespaces as string[] | undefined,
        topologyKey: t.topologyKey as string,
      };
      return podTerm;
    });
  }

  const preferred = pa.preferredDuringSchedulingIgnoredDuringExecution as unknown[] | undefined;
  if (preferred?.length) {
    result.preferred = preferred.map((pref) => {
      const p = pref as Record<string, unknown>;
      const podAffinityTerm = p.podAffinityTerm as Record<string, unknown>;
      const labelSelector = podAffinityTerm?.labelSelector as Record<string, unknown> | undefined;
      const weighted: WeightedPodAffinityTerm = {
        weight: p.weight as number,
        podAffinityTerm: {
          labelSelector: labelSelector
            ? {
                matchLabels: (labelSelector.matchLabels as Record<string, string>) || {},
                matchExpressions: ((labelSelector.matchExpressions as unknown[]) || []).map(
                  (expr) => toPodLabelSelectorRequirement(expr as Record<string, unknown>),
                ),
              }
            : undefined,
          namespaces: podAffinityTerm?.namespaces as string[] | undefined,
          topologyKey: podAffinityTerm?.topologyKey as string,
        },
      };
      return weighted;
    });
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseVolumesFromK8s(rawVolumes: unknown[]): VolumeConfig[] {
  return rawVolumes.map((vol) => {
    const v = vol as Record<string, unknown>;
    const result: VolumeConfig = {
      name: v.name as string,
      type: 'emptyDir',
    };

    const configMap = v.configMap as Record<string, unknown> | undefined;
    const secret = v.secret as Record<string, unknown> | undefined;
    const pvc = v.persistentVolumeClaim as Record<string, unknown> | undefined;
    const emptyDir = v.emptyDir as Record<string, unknown> | undefined;
    const hostPath = v.hostPath as Record<string, unknown> | undefined;

    if (configMap) {
      result.type = 'configMap';
      result.configMapName = configMap.name as string;
      result.configMapOptional = configMap.optional as boolean | undefined;
    } else if (secret) {
      result.type = 'secret';
      result.secretName = secret.secretName as string;
      result.secretOptional = secret.optional as boolean | undefined;
    } else if (pvc) {
      result.type = 'persistentVolumeClaim';
      result.claimName = pvc.claimName as string;
    } else if (emptyDir) {
      result.type = 'emptyDir';
      result.emptyDirMedium = emptyDir.medium === 'Memory' ? 'Memory' : 'default';
      result.emptyDirSizeLimit = emptyDir.sizeLimit as string | undefined;
    } else if (hostPath) {
      result.type = 'hostPath';
      result.hostPath = hostPath.path as string;
      result.hostPathType = hostPath.type as VolumeConfig['hostPathType'];
    }

    return result;
  });
}

export function resolveWorkloadTypeFromEditResource(
  editData: Record<string, unknown>,
  defaultType: WorkloadType,
): WorkloadType {
  const kind = String(editData?.kind || '').toLowerCase();
  const type = String(editData?.type || '').toLowerCase();
  if (kind === 'daemonset' || type === 'daemonset') return 'daemonset';
  if (kind === 'statefulset' || type === 'statefulset') return 'statefulset';
  if (kind === 'deployment' || type === 'deployment') return 'deployment';
  return defaultType;
}

/**
 * 将 K8s 工作负载 CR 解析为 WorkloadForm 初始表单值与 YAML 文本（编辑模式）
 */
export function parseEditWorkloadFormInit(
  editData: unknown,
  defaultType: WorkloadType = 'deployment',
): EditWorkloadFormInitResult | null {
  if (!editData || typeof editData !== 'object') return null;

  const resource = editData as Record<string, unknown>;
  const spec = (resource.spec || {}) as Record<string, unknown>;
  const metadata = (resource.metadata || {}) as Record<string, unknown>;
  const template = (spec.template || {}) as Record<string, unknown>;
  const templateSpec = (template.spec || {}) as Record<string, unknown>;
  const templateMetadata = (template.metadata || {}) as Record<string, unknown>;
  const rawContainers = (templateSpec.containers as unknown[]) || [];
  const firstContainer = rawContainers[0] || {};

  const labels = Object.entries((metadata.labels as Record<string, string>) || {}).map(
    ([key, value]) => ({ key, value }),
  );

  const containers =
    rawContainers.length > 0
      ? rawContainers.map(parseK8sContainerToFormValue)
      : [createEmptyContainer((metadata.name as string) || 'container')];

  const imagePullSecrets = ((templateSpec.imagePullSecrets as Array<{ name?: string }>) || []).map(
    (s) => s.name as string,
  );

  const nodeSelector = Object.entries(
    (templateSpec.nodeSelector as Record<string, string>) || {},
  ).map(([key, value]) => ({ key, value }));

  const affinity = templateSpec.affinity as Record<string, unknown> | undefined;

  const tolerations = ((templateSpec.tolerations as unknown[]) || []).map((t) => {
    const tol = t as Record<string, unknown>;
    return {
      key: tol.key as string | undefined,
      operator: (tol.operator as 'Equal' | 'Exists') || 'Equal',
      value: tol.value as string | undefined,
      effect: tol.effect as 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute' | 'All' | undefined,
      tolerationSeconds: tol.tolerationSeconds as number | undefined,
    };
  });

  const hostAliases = ((templateSpec.hostAliases as unknown[]) || []).map((ha) => {
    const h = ha as Record<string, unknown>;
    return {
      ip: (h.ip as string) || '',
      hostnames: (h.hostnames as string[]) || [],
    };
  });

  const dnsPolicy = parseDnsPolicy(templateSpec.dnsPolicy);
  const dnsConfigRaw = templateSpec.dnsConfig as Record<string, unknown> | undefined;
  const dnsConfig = dnsConfigRaw
    ? {
        nameservers: (dnsConfigRaw.nameservers as string[]) || [],
        searches: (dnsConfigRaw.searches as string[]) || [],
        options: ((dnsConfigRaw.options as unknown[]) || []).map((opt) => {
          const o = opt as Record<string, unknown>;
          return { name: o.name as string, value: o.value as string | undefined };
        }),
      }
    : undefined;

  const volumes = parseVolumesFromK8s((templateSpec.volumes as unknown[]) || []);

  const templateAnnotations = (templateMetadata.annotations as Record<string, string>) || {};
  const networksAnnotation = templateAnnotations['k8s.v1.cni.cncf.io/networks'];
  const logicalSwitch = templateAnnotations['ovn.kubernetes.io/logical_switch'];
  const staticIPAnnotation = templateAnnotations['ovn.kubernetes.io/ip_address'];

  let networkType: NonNullable<WorkloadFormValues['networkType']> = 'default';
  let flatSubnet: string | undefined;
  let vpcSubnet: string | undefined;
  let customNad: string | undefined;
  const vpcName: string | undefined = undefined;

  if (networksAnnotation) {
    if (logicalSwitch) {
      networkType = 'vpc';
      vpcSubnet = networksAnnotation;
    } else {
      networkType = 'flat_subnet';
      flatSubnet = networksAnnotation;
    }
  }

  const enableStaticIP = !!staticIPAnnotation;
  const staticIP = staticIPAnnotation || undefined;
  const workloadTypeValue = resolveWorkloadTypeFromEditResource(resource, defaultType);

  const formValues: Partial<WorkloadFormValues> = {
    workloadType: workloadTypeValue,
    name:
      ((metadata.annotations as Record<string, string>)?.['tower.io/alias'] as string) ||
      (metadata.name as string) ||
      '',
    namespace: (metadata.namespace as string) || 'default',
    labels,
    containers,
    ...toContainerEditorFields(containers[0] || parseK8sContainerToFormValue(firstContainer)),
    replicas: (spec.replicas as number) || 1,
    imagePullSecrets,
    nodeSelector,
    nodeAffinity: parseNodeAffinityFromK8s(affinity?.nodeAffinity),
    nodeAntiAffinity: undefined,
    podAffinity: parsePodAffinityFromK8s(affinity?.podAffinity),
    podAntiAffinity: parsePodAffinityFromK8s(affinity?.podAntiAffinity),
    tolerations: tolerations.length > 0 ? tolerations : undefined,
    hostAliases: hostAliases.length > 0 ? hostAliases : undefined,
    dnsPolicy,
    dnsConfig,
    volumes,
    networkType,
    flatSubnet,
    vpcSubnet,
    vpcName,
    customNad,
    enableStaticIP,
    staticIP,
  };

  const cleanData = {
    ...resource,
    metadata: {
      ...(metadata as object),
      managedFields: undefined,
    },
  };
  const yamlContent = yaml.dump(cleanData, { indent: 2 });

  return { formValues, yamlContent };
}
