/**
 * KubeVirt VM Pod 亲和/反亲和：表单模型 ↔ K8s affinity.podAffinity / podAntiAffinity。
 * 与容器 WorkloadForm 语义一致，供云主机变配抽屉复用。
 */
import type { PodAffinityConfig } from '../../containers/components/workloadForm/types';

export function parsePodAffinityFromK8s(podAffinity: any): PodAffinityConfig | undefined {
  if (!podAffinity) return undefined;

  const result: PodAffinityConfig = {};

  if (podAffinity.requiredDuringSchedulingIgnoredDuringExecution?.length) {
    result.required = podAffinity.requiredDuringSchedulingIgnoredDuringExecution.map((term: any) => ({
      labelSelector: term.labelSelector
        ? {
            matchLabels: term.labelSelector.matchLabels || {},
            matchExpressions: (term.labelSelector.matchExpressions || []).map((expr: any) => ({
              key: expr.key,
              operator: expr.operator,
              values: expr.values,
            })),
          }
        : undefined,
      namespaces: term.namespaces,
      topologyKey: term.topologyKey,
    }));
  }

  if (podAffinity.preferredDuringSchedulingIgnoredDuringExecution?.length) {
    result.preferred = podAffinity.preferredDuringSchedulingIgnoredDuringExecution.map((pref: any) => ({
      weight: pref.weight,
      podAffinityTerm: {
        labelSelector: pref.podAffinityTerm?.labelSelector
          ? {
              matchLabels: pref.podAffinityTerm.labelSelector.matchLabels || {},
              matchExpressions: (pref.podAffinityTerm.labelSelector.matchExpressions || []).map(
                (expr: any) => ({
                  key: expr.key,
                  operator: expr.operator,
                  values: expr.values,
                }),
              ),
            }
          : undefined,
        namespaces: pref.podAffinityTerm?.namespaces,
        topologyKey: pref.podAffinityTerm?.topologyKey,
      },
    }));
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/** 将表单 PodAffinityConfig 转为 K8s podAffinity / podAntiAffinity 对象 */
export function buildPodAffinityForK8s(affinityConfig?: PodAffinityConfig): Record<string, unknown> | undefined {
  if (!affinityConfig) return undefined;

  const result: Record<string, unknown> = {};

  if (affinityConfig.required?.length) {
    const requiredTerms = affinityConfig.required
      .map((term) => {
        const termObj: Record<string, unknown> = {};
        const labelSelector: Record<string, unknown> = {};

        const matchLabels = term.labelSelector?.matchLabels || {};
        const validLabels = Object.fromEntries(
          Object.entries(matchLabels).filter(([k, v]) => k && v),
        );
        if (Object.keys(validLabels).length > 0) {
          labelSelector.matchLabels = validLabels;
        }

        if (term.labelSelector?.matchExpressions?.length) {
          const expressions = term.labelSelector.matchExpressions
            .filter((expr) => expr.key)
            .map((expr) => ({
              key: expr.key,
              operator: expr.operator,
              ...(expr.values && expr.values.length > 0 ? { values: expr.values } : {}),
            }));
          if (expressions.length > 0) {
            labelSelector.matchExpressions = expressions;
          }
        }

        if (Object.keys(labelSelector).length > 0) {
          termObj.labelSelector = labelSelector;
        }

        if (term.namespaces?.length) {
          termObj.namespaces = term.namespaces;
        }

        if (!term.topologyKey) {
          return null;
        }
        termObj.topologyKey = term.topologyKey;

        return Object.keys(termObj).length > 1 ? termObj : null;
      })
      .filter(Boolean);

    if (requiredTerms.length > 0) {
      result.requiredDuringSchedulingIgnoredDuringExecution = requiredTerms;
    }
  }

  if (affinityConfig.preferred?.length) {
    const preferences = affinityConfig.preferred
      .map((pref) => {
        const term = pref.podAffinityTerm;
        const termObj: Record<string, unknown> = {};
        const labelSelector: Record<string, unknown> = {};

        const matchLabels = term.labelSelector?.matchLabels || {};
        const validLabels = Object.fromEntries(
          Object.entries(matchLabels).filter(([k, v]) => k && v),
        );
        if (Object.keys(validLabels).length > 0) {
          labelSelector.matchLabels = validLabels;
        }

        if (term.labelSelector?.matchExpressions?.length) {
          const expressions = term.labelSelector.matchExpressions
            .filter((expr) => expr.key)
            .map((expr) => ({
              key: expr.key,
              operator: expr.operator,
              ...(expr.values && expr.values.length > 0 ? { values: expr.values } : {}),
            }));
          if (expressions.length > 0) {
            labelSelector.matchExpressions = expressions;
          }
        }

        if (Object.keys(labelSelector).length > 0) {
          termObj.labelSelector = labelSelector;
        }

        if (term.namespaces?.length) {
          termObj.namespaces = term.namespaces;
        }

        if (!term.topologyKey) {
          return null;
        }
        termObj.topologyKey = term.topologyKey;

        return Object.keys(termObj).length > 1
          ? {
              weight: pref.weight || 50,
              podAffinityTerm: termObj,
            }
          : null;
      })
      .filter(Boolean);

    if (preferences.length > 0) {
      result.preferredDuringSchedulingIgnoredDuringExecution = preferences;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
