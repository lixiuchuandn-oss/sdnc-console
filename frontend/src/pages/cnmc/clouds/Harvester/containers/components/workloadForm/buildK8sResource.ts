import { generateHarvesterCrMetadataName } from '../../../../../../../utils/harvesterUtils';
import { createEmptyContainer } from './containerDefaults';
import type {
  WorkloadFormValues,
  WorkloadContainerFormValue,
  NodeAffinityConfig,
  PodAffinityConfig,
} from './types';
import type { WorkloadFormNadOption } from './hooks/useWorkloadFormNetworkOptions';

export function buildK8sResource(
  values: WorkloadFormValues,
  allNadOptions: WorkloadFormNadOption[],
): any {
  const {
    name,
    namespace,
    workloadType,
    labels,
    containers,
    replicas,
    nodeSelector,
    nodeAffinity,
    nodeAntiAffinity,
    podAffinity,
    podAntiAffinity,
    tolerations,
    hostAliases,
    dnsPolicy,
    dnsConfig,
    volumes,
    // 网络配置
    networkType,
    flatSubnet,
    vpcName: _vpcName,
    vpcSubnet,
    customNad,
    enableStaticIP,
    staticIP,
  } = values;
  
  // 构建标签
  const labelsMap: Record<string, string> = { app: name };
  (labels || []).forEach((item) => {
    if (item.key && item.value) {
      labelsMap[item.key] = item.value;
    }
  });
  
  // 构建探针
  const buildProbe = (probe?: WorkloadContainerFormValue['livenessProbe']) => {
    if (!probe?.enabled) return undefined;
    
    let probeConfig: any = {
      initialDelaySeconds: probe.initialDelaySeconds || 30,
      periodSeconds: probe.periodSeconds || 10,
    };
    
    if (probe.type === 'httpGet' && probe.httpGet) {
      probeConfig.httpGet = {
        path: probe.httpGet.path || '/health',
        port: probe.httpGet.port,
      };
    } else if (probe.type === 'tcpSocket' && probe.tcpSocket) {
      probeConfig.tcpSocket = {
        port: probe.tcpSocket.port,
      };
    } else if (probe.type === 'exec' && probe.exec?.command) {
      probeConfig.exec = {
        command: probe.exec.command,
      };
    }
    
    return probeConfig;
  };
  
  const buildEnvList = (env: any[] = []) => env.map((item: any) => {
    const envVar: any = {};

    if (item.type === 'configMapKeyRef') {
      envVar.name = item.name || item.configMapKey;
      envVar.valueFrom = {
        configMapKeyRef: {
          name: item.configMapName,
          key: item.configMapKey,
        },
      };
    } else if (item.type === 'secretKeyRef') {
      envVar.name = item.name || item.secretKey;
      envVar.valueFrom = {
        secretKeyRef: {
          name: item.secretName,
          key: item.secretKey,
        },
      };
    } else {
      envVar.name = item.name;
      envVar.value = item.value;
    }

    return envVar;
  }).filter((item: any) => item.name);

  const buildPortsList = (ports: any[] = []) => ports.map((item) => ({
    name: item.name || `port-${item.containerPort}`,
    containerPort: item.containerPort,
    protocol: item.protocol,
  }));

  const buildResourceRequirements = (resources: WorkloadContainerFormValue['resources']) => {
    const resourceRequirements: any = {};
    if (resources?.requests?.cpu || resources?.requests?.memory) {
      resourceRequirements.requests = {};
      if (resources.requests.cpu) resourceRequirements.requests.cpu = resources.requests.cpu;
      if (resources.requests.memory) resourceRequirements.requests.memory = resources.requests.memory;
    }
    if (resources?.limits?.cpu || resources?.limits?.memory) {
      resourceRequirements.limits = {};
      if (resources.limits.cpu) resourceRequirements.limits.cpu = resources.limits.cpu;
      if (resources.limits.memory) resourceRequirements.limits.memory = resources.limits.memory;
    }
    return resourceRequirements;
  };

  const containerList = (containers && containers.length > 0 ? containers : [createEmptyContainer(name)]).map((container, index) => {
    const envList = buildEnvList(container.env || []);
    const portsList = buildPortsList(container.ports || []);
    const resourceRequirements = buildResourceRequirements(container.resources);

    return {
      name: container.containerName || (index === 0 ? name : `${name}-${index + 1}`),
      image: container.image,
      imagePullPolicy: container.imagePullPolicy,
      ports: portsList.length > 0 ? portsList : undefined,
      env: envList.length > 0 ? envList : undefined,
      resources: Object.keys(resourceRequirements).length > 0 ? resourceRequirements : undefined,
      command: container.command?.length ? container.command : undefined,
      args: container.args?.length ? container.args : undefined,
      livenessProbe: buildProbe(container.livenessProbe),
      readinessProbe: buildProbe(container.readinessProbe),
      volumeMounts: (container.volumeMounts || []).length > 0 ? (container.volumeMounts || []).map((m) => ({
        name: m.name,
        mountPath: m.mountPath,
        subPath: m.subPath,
        readOnly: m.readOnly,
      })) : undefined,
    };
  }).filter((container) => container.image || container.name);
  
  // 构建存储卷定义
  const buildVolumes = () => {
    return (volumes || []).map((vol) => {
      const volume: any = { name: vol.name };
      
      switch (vol.type) {
        case 'configMap':
          volume.configMap = {
            name: vol.configMapName,
            optional: vol.configMapOptional,
          };
          break;
        case 'secret':
          volume.secret = {
            secretName: vol.secretName,
            optional: vol.secretOptional,
          };
          break;
        case 'persistentVolumeClaim':
          volume.persistentVolumeClaim = {
            claimName: vol.claimName,
          };
          break;
        case 'emptyDir':
          volume.emptyDir = {
            medium: vol.emptyDirMedium === 'Memory' ? 'Memory' : undefined,
            sizeLimit: vol.emptyDirSizeLimit,
          };
          break;
        case 'hostPath':
          volume.hostPath = {
            path: vol.hostPath,
            type: vol.hostPathType,
          };
          break;
      }
      
      return volume;
    });
  };
  
  const volumesList = buildVolumes();
  
  // 构建节点选择器
  const nodeSelectorMap: Record<string, string> = {};
  (nodeSelector || []).forEach((item) => {
    if (item.key && item.value) {
      nodeSelectorMap[item.key] = item.value;
    }
  });
  
  // 构建镜像拉取凭证（从所有容器收集并去重）
  const allContainerSecrets = new Set<string>();
  (containers || []).forEach((container) => {
    (container.imagePullSecrets || []).forEach((secretName) => {
      allContainerSecrets.add(secretName);
    });
  });
  const imagePullSecretsList = Array.from(allContainerSecrets).map((secretName) => ({
    name: secretName,
  }));
  
  // 构建亲和性配置
  const buildNodeAffinity = (affinityConfig?: NodeAffinityConfig) => {
    if (!affinityConfig) return undefined;
    
    const result: any = {};
    
    // 构建 required 规则
    if (affinityConfig.required?.nodeSelectorTerms?.length) {
      const terms = affinityConfig.required.nodeSelectorTerms
        .map((term) => {
          const termObj: any = {};
          
          if (term.matchExpressions?.length) {
            termObj.matchExpressions = term.matchExpressions
              .filter((expr) => expr.key)
              .map((expr) => ({
                key: expr.key,
                operator: expr.operator,
                ...(expr.values && expr.values.length > 0 && { values: expr.values }),
              }));
          }
          
          if (term.matchFields?.length) {
            termObj.matchFields = term.matchFields
              .filter((field) => field.key)
              .map((field) => ({
                key: field.key,
                operator: field.operator,
                ...(field.values && field.values.length > 0 && { values: field.values }),
              }));
          }
          
          return Object.keys(termObj).length > 0 ? termObj : null;
        })
        .filter(Boolean);
      
      if (terms.length > 0) {
        result.requiredDuringSchedulingIgnoredDuringExecution = {
          nodeSelectorTerms: terms,
        };
      }
    }
    
    // 构建 preferred 规则
    if (affinityConfig.preferred?.length) {
      const preferences = affinityConfig.preferred
        .map((pref) => {
          const prefObj: any = {
            weight: pref.weight || 50,
            preference: {},
          };
          
          if (pref.preference.matchExpressions?.length) {
            prefObj.preference.matchExpressions = pref.preference.matchExpressions
              .filter((expr) => expr.key)
              .map((expr) => ({
                key: expr.key,
                operator: expr.operator,
                ...(expr.values && expr.values.length > 0 && { values: expr.values }),
              }));
          }
          
          if (pref.preference.matchFields?.length) {
            prefObj.preference.matchFields = pref.preference.matchFields
              .filter((field) => field.key)
              .map((field) => ({
                key: field.key,
                operator: field.operator,
                ...(field.values && field.values.length > 0 && { values: field.values }),
              }));
          }
          
          return Object.keys(prefObj.preference).length > 0 ? prefObj : null;
        })
        .filter(Boolean);
      
      if (preferences.length > 0) {
        result.preferredDuringSchedulingIgnoredDuringExecution = preferences;
      }
    }
    
    return Object.keys(result).length > 0 ? result : undefined;
  };
  
  // 构建 Pod 亲和性配置
  const buildPodAffinity = (affinityConfig?: PodAffinityConfig) => {
    if (!affinityConfig) return undefined;
    
    const result: any = {};
    
    // 构建 required 规则
    if (affinityConfig.required?.length) {
      const requiredTerms = affinityConfig.required
        .map((term) => {
          const termObj: any = {};
          
          // 构建标签选择器
          const labelSelector: any = {};
          
          // matchLabels
          const matchLabels = term.labelSelector?.matchLabels || {};
          const validLabels = Object.fromEntries(
            Object.entries(matchLabels).filter(([k, v]) => k && v)
          );
          if (Object.keys(validLabels).length > 0) {
            labelSelector.matchLabels = validLabels;
          }
          
          // matchExpressions
          if (term.labelSelector?.matchExpressions?.length) {
            const expressions = term.labelSelector.matchExpressions
              .filter((expr) => expr.key)
              .map((expr) => ({
                key: expr.key,
                operator: expr.operator,
                ...(expr.values && expr.values.length > 0 && { values: expr.values }),
              }));
            if (expressions.length > 0) {
              labelSelector.matchExpressions = expressions;
            }
          }
          
          if (Object.keys(labelSelector).length > 0) {
            termObj.labelSelector = labelSelector;
          }
          
          // namespaces
          if (term.namespaces?.length) {
            termObj.namespaces = term.namespaces;
          }
          
          // topologyKey (必填)
          if (term.topologyKey) {
            termObj.topologyKey = term.topologyKey;
          } else {
            return null; // topologyKey 是必填字段
          }
          
          return Object.keys(termObj).length > 1 ? termObj : null; // 至少需要 topologyKey
        })
        .filter(Boolean);
      
      if (requiredTerms.length > 0) {
        result.requiredDuringSchedulingIgnoredDuringExecution = requiredTerms;
      }
    }
    
    // 构建 preferred 规则
    if (affinityConfig.preferred?.length) {
      const preferences = affinityConfig.preferred
        .map((pref) => {
          const term = pref.podAffinityTerm;
          const termObj: any = {};
          
          // 构建标签选择器
          const labelSelector: any = {};
          
          // matchLabels
          const matchLabels = term.labelSelector?.matchLabels || {};
          const validLabels = Object.fromEntries(
            Object.entries(matchLabels).filter(([k, v]) => k && v)
          );
          if (Object.keys(validLabels).length > 0) {
            labelSelector.matchLabels = validLabels;
          }
          
          // matchExpressions
          if (term.labelSelector?.matchExpressions?.length) {
            const expressions = term.labelSelector.matchExpressions
              .filter((expr) => expr.key)
              .map((expr) => ({
                key: expr.key,
                operator: expr.operator,
                ...(expr.values && expr.values.length > 0 && { values: expr.values }),
              }));
            if (expressions.length > 0) {
              labelSelector.matchExpressions = expressions;
            }
          }
          
          if (Object.keys(labelSelector).length > 0) {
            termObj.labelSelector = labelSelector;
          }
          
          // namespaces
          if (term.namespaces?.length) {
            termObj.namespaces = term.namespaces;
          }
          
          // topologyKey (必填)
          if (term.topologyKey) {
            termObj.topologyKey = term.topologyKey;
          } else {
            return null;
          }
          
          return Object.keys(termObj).length > 1 ? {
            weight: pref.weight || 50,
            podAffinityTerm: termObj,
          } : null;
        })
        .filter(Boolean);
      
      if (preferences.length > 0) {
        result.preferredDuringSchedulingIgnoredDuringExecution = preferences;
      }
    }
    
    return Object.keys(result).length > 0 ? result : undefined;
  };
  
  // 构建完整亲和性对象
  const affinity: any = {};
  
  // 节点亲和性
  const nodeAffinityResult = buildNodeAffinity(nodeAffinity);
  if (nodeAffinityResult) {
    affinity.nodeAffinity = nodeAffinityResult;
  }
  
  // 节点反亲和性 (使用相同的结构，但在K8s中反亲和性需要特殊处理)
  // 注意：Kubernetes 本身没有直接的 nodeAntiAffinity，需要通过 nodeAffinity 的 NotIn/DoesNotExist 操作符实现
  // 这里我们将其转换为对应的 nodeAffinity 规则
  if (nodeAntiAffinity) {
    const antiAffinityResult = buildNodeAffinity(nodeAntiAffinity);
    if (antiAffinityResult) {
      // 如果已有 nodeAffinity，需要合并规则
      if (affinity.nodeAffinity) {
        // 合并 required 规则
        if (antiAffinityResult.requiredDuringSchedulingIgnoredDuringExecution) {
          if (!affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution) {
            affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution = 
              antiAffinityResult.requiredDuringSchedulingIgnoredDuringExecution;
          } else {
            // 合并 nodeSelectorTerms
            affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms.push(
              ...antiAffinityResult.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms
            );
          }
        }
        // 合并 preferred 规则
        if (antiAffinityResult.preferredDuringSchedulingIgnoredDuringExecution) {
          if (!affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution) {
            affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution = 
              antiAffinityResult.preferredDuringSchedulingIgnoredDuringExecution;
          } else {
            affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution.push(
              ...antiAffinityResult.preferredDuringSchedulingIgnoredDuringExecution
            );
          }
        }
      } else {
        affinity.nodeAffinity = antiAffinityResult;
      }
    }
  }
  
  // Pod 亲和性
  const podAffinityResult = buildPodAffinity(podAffinity);
  if (podAffinityResult) {
    affinity.podAffinity = podAffinityResult;
  }
  
  // Pod 反亲和性
  const podAntiAffinityResult = buildPodAffinity(podAntiAffinity);
  if (podAntiAffinityResult) {
    affinity.podAntiAffinity = podAntiAffinityResult;
  }
  
  // 构建污点容忍
  const tolerationsList = (tolerations || [])
    .filter((t) => t.key || t.operator === 'Exists')
    .map((t) => {
      const toleration: any = {};
      if (t.key) toleration.key = t.key;
      if (t.operator) toleration.operator = t.operator;
      if (t.operator === 'Equal' && t.value) toleration.value = t.value;
      if (t.effect) toleration.effect = t.effect;
      if (t.effect === 'NoExecute' && t.tolerationSeconds !== undefined) {
        toleration.tolerationSeconds = t.tolerationSeconds;
      }
      return toleration;
    });
  
  // 构建域名映射
  const hostAliasesList = (hostAliases || [])
    .filter((ha) => ha.ip && ha.hostnames && ha.hostnames.length > 0)
    .map((ha) => ({
      ip: ha.ip,
      hostnames: ha.hostnames,
    }));
  
  // 构建 DNS 配置
  const dnsConfigObj: any = {};
  if (dnsConfig?.nameservers && dnsConfig.nameservers.length > 0) {
    dnsConfigObj.nameservers = dnsConfig.nameservers.filter((ns) => ns);
  }
  if (dnsConfig?.searches && dnsConfig.searches.length > 0) {
    dnsConfigObj.searches = dnsConfig.searches.filter((s) => s);
  }
  if (dnsConfig?.options && dnsConfig.options.length > 0) {
    dnsConfigObj.options = dnsConfig.options
      .filter((opt) => opt.name)
      .map((opt) => ({
        name: opt.name,
        ...(opt.value !== undefined && opt.value !== '' && { value: opt.value }),
      }));
  }
  const hasDnsConfig = Object.keys(dnsConfigObj).length > 0;
  
  // ============================================================
  // 构建网络相关注解
  // 注解将添加到 spec.template.metadata.annotations
  // ============================================================
  const buildNetworkAnnotations = (): Record<string, string> => {
    const annotations: Record<string, string> = {};
    
    // 默认网络不需要任何注解
    if (!networkType || networkType === 'default') {
      return annotations;
    }
    
    // 根据网络类型设置注解
    switch (networkType) {
      case 'flat_subnet':
        // 扁平子网：设置 networks 注解和 logical_switch 注解
        if (flatSubnet) {
          annotations['k8s.v1.cni.cncf.io/networks'] = flatSubnet;
          // 扁平子网需要 logical_switch 注解，格式为 <namespace>/<subnet-name>
          const flatParts = flatSubnet.split('/');
          const subnetName = flatParts.length === 2 ? flatParts[1] : flatSubnet;
          if (flatParts.length === 2) {
            annotations['ovn.kubernetes.io/logical_switch'] = flatParts[1];
          } else if (flatParts.length === 1) {
            annotations['ovn.kubernetes.io/logical_switch'] = flatSubnet;
          }
          // 扁平子网静态IP需要用网络名称前缀的注解格式
          // 格式: <subnet-name>.default.ovn.kubernetes.io/ip_address
          if (enableStaticIP && staticIP) {
            // 同时设置两种格式的静态IP注解，确保兼容性
            annotations['ovn.kubernetes.io/ip_address'] = staticIP;
            // 使用网络名称前缀格式（这是Kube-OVN多网络模式识别的格式）
            annotations[`${subnetName}.default.ovn.kubernetes.io/ip_address`] = staticIP;
          }
        }
        break;
        
      case 'vpc':
        // VPC 子网：设置 networks 注解
        if (vpcSubnet) {
          annotations['k8s.v1.cni.cncf.io/networks'] = vpcSubnet;
          // Kube-OVN VPC 子网需要 logical_switch 注解
          const subnetParts = vpcSubnet.split('/');
          const vpcSubnetName = subnetParts.length === 2 ? subnetParts[1] : vpcSubnet;
          if (subnetParts.length === 2) {
            annotations['ovn.kubernetes.io/logical_switch'] = subnetParts[1];
          }
          // VPC 子网静态IP需要用网络名称前缀的注解格式
          if (enableStaticIP && staticIP) {
            annotations['ovn.kubernetes.io/ip_address'] = staticIP;
            const vpcSubnetNs = subnetParts.length === 2 ? subnetParts[0] : 'default';
            annotations[`${vpcSubnetName}.${vpcSubnetNs}.ovn.kubernetes.io/ip_address`] = staticIP;
          }
        }
        break;
        
      case 'custom_nad':
        if (customNad) {
          annotations['k8s.v1.cni.cncf.io/networks'] = customNad;
          const selectedNadOption = allNadOptions.find((o: any) => o.value === customNad);
          if (selectedNadOption?._type === 'kube-ovn') {
            const nadParts = customNad.split('/');
            if (nadParts.length === 2) {
              annotations['ovn.kubernetes.io/logical_switch'] = nadParts[1];
            }
          }
        }
        break;
    }
    
    return annotations;
  };
  
  // 构建网络注解
  const networkAnnotations = buildNetworkAnnotations();
  
  // 构建完整资源
  const resource: any = {
    apiVersion: 'apps/v1',
    kind: workloadType === 'deployment' ? 'Deployment' 
        : workloadType === 'statefulset' ? 'StatefulSet' 
        : 'DaemonSet',
    metadata: {
      name: generateHarvesterCrMetadataName(workloadType),
      namespace,
      labels: labelsMap,
      annotations: {
        'tower.io/alias': name,
      },
    },
    spec: {
      selector: {
        matchLabels: { app: name },
      },
      template: {
        metadata: {
          labels: labelsMap,
          // 网络注解：合并到 spec.template.metadata.annotations
          ...(Object.keys(networkAnnotations).length > 0 && { annotations: networkAnnotations }),
        },
        spec: {
          containers: containerList,
          imagePullSecrets: imagePullSecretsList.length > 0 ? imagePullSecretsList : undefined,
          nodeSelector: Object.keys(nodeSelectorMap).length > 0 ? nodeSelectorMap : undefined,
          affinity: Object.keys(affinity).length > 0 ? affinity : undefined,
          tolerations: tolerationsList.length > 0 ? tolerationsList : undefined,
          hostAliases: hostAliasesList.length > 0 ? hostAliasesList : undefined,
          dnsPolicy: dnsPolicy && dnsPolicy !== 'ClusterFirst' ? dnsPolicy : undefined,
          dnsConfig: hasDnsConfig ? dnsConfigObj : undefined,
          volumes: volumesList.length > 0 ? volumesList : undefined,
        },
      },
    },
  };
  
  // 根据类型添加特定配置
  if (workloadType !== 'daemonset') {
    resource.spec.replicas = replicas || 1;
  }
  
  return resource;
}
