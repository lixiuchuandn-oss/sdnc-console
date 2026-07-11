/**
 * IBR 配置下发统一流程（预览 → 漂移检测 → 确认 → 推送 → [可选回查]）
 *
 * 各特性仅注册 push/preview/verify 路径；页面与向导只调用本模块。
 */
import { Modal } from 'antd';
import { apiRequest } from '../../../../services/api';
import {
  DeployDriftCancelledError,
  ensureDeployDriftAcknowledged,
  fetchDeployDrift,
  postDeployPush,
  type DeployDriftReport,
  type VrConfigDeployDomain,
  type VrConfigDriftConflict,
} from '../../../../utils/vrConfigDeployDrift';

export type IbrDeployFeature = 'acl' | 'ipsec' | 'srv6' | 'nat';

export type IbrDeployStepKind = 'preview' | 'push' | 'verify';

export type IbrDeployWizardStep = {
  title: string;
  desc: string;
  kind: IbrDeployStepKind;
  feature: IbrDeployFeature;
  vrId: string;
  endpointLabel: string;
};

type IbrDeployFeatureConfig = {
  domain: VrConfigDeployDomain;
  label: string;
  pushPath: string;
  previewPath?: (vrId: string) => string;
  verifyPath?: (vrId: string) => string;
};

const REQUEST_OPTS = { skipCache: true, enableDeduplication: false } as const;

export const IBR_DEPLOY_FEATURES: Record<IbrDeployFeature, IbrDeployFeatureConfig> = {
  acl: {
    domain: 'acl',
    label: 'ACL',
    pushPath: '/api/networks/acl/deploy/push',
  },
  ipsec: {
    domain: 'ipsec',
    label: 'IPsec VPN',
    pushPath: '/api/networks/ipsec/deploy/push',
    previewPath: (vrId) =>
      `/api/networks/ipsec/deploy/preview?vrId=${encodeURIComponent(vrId)}`,
    verifyPath: (vrId) =>
      `/api/networks/ipsec/deploy/verify?vrId=${encodeURIComponent(vrId)}`,
  },
  srv6: {
    domain: 'srv6',
    label: 'SRv6',
    pushPath: '/api/networks/srv6/deploy/push',
    previewPath: (vrId) =>
      `/api/networks/srv6/deploy/preview?vrId=${encodeURIComponent(vrId)}`,
  },
  nat: {
    domain: 'nat',
    label: 'NAT',
    pushPath: '/api/networks/nat/deploy/push',
  },
};

const formatDriftSection = (report: DeployDriftReport): string => {
  if (!report.conflicts.length) {
    return '[漂移检测] 设备与本域平台意图一致，无阻塞项。';
  }
  const blockers = report.conflicts.filter((c) => c.kind === 'DOMAIN_OVERWRITE');
  const warnings = report.conflicts.filter((c) => c.kind === 'PLATFORM_STALE');
  const lines: string[] = ['[漂移检测]'];
  if (blockers.length) {
    lines.push('以下项下发时将覆盖设备侧现网配置：');
    blockers.forEach((c) => lines.push(`  • ${c.message}`));
  }
  if (warnings.length) {
    lines.push('以下项本次会保留设备现网值（平台库可能滞后）：');
    warnings.forEach((c) => lines.push(`  • ${c.message}`));
  }
  return lines.join('\n');
};

const confirmOverwriteDrift = (
  blockers: VrConfigDriftConflict[],
  warnings: VrConfigDriftConflict[],
): Promise<void> =>
  new Promise((resolve, reject) => {
    const lines = [
      '设备现网配置与平台意图不一致，继续下发将覆盖设备侧历史策略：',
      '',
      ...blockers.map((c) => `• ${c.message}`),
    ];
    if (warnings.length > 0) {
      lines.push(
        '',
        '以下项本次会保留设备现网值，但平台库可能滞后：',
        '',
        ...warnings.map((c) => `• ${c.message}`),
      );
    }
    Modal.confirm({
      title: '检测到配置漂移',
      content: lines.join('\n'),
      okText: '确认覆盖并下发',
      okButtonProps: { danger: true },
      cancelText: '取消',
      width: 560,
      onOk: () => resolve(),
      onCancel: () => reject(new DeployDriftCancelledError()),
    });
  });

const isConfigDrift409 = (err: unknown): err is { status: number; conflicts?: VrConfigDriftConflict[] } => {
  const e = err as { status?: number; conflicts?: VrConfigDriftConflict[] };
  return e?.status === 409 && Array.isArray(e.conflicts) && e.conflicts.length > 0;
};

const pushWithDriftGuard = async (
  vrId: string,
  feature: IbrDeployFeature,
  extraBody?: Record<string, unknown>,
): Promise<{ response: unknown; driftWarnings?: VrConfigDriftConflict[] }> => {
  const cfg = IBR_DEPLOY_FEATURES[feature];
  let { acknowledgeDrift, driftWarnings } = await ensureDeployDriftAcknowledged(vrId, cfg.domain);

  try {
    const response = await postDeployPush(cfg.pushPath, vrId, acknowledgeDrift, extraBody);
    return { response, driftWarnings };
  } catch (err: unknown) {
    if (!isConfigDrift409(err)) throw err;
    const blockers = (err.conflicts || []).filter(
      (c) => c.kind === 'DOMAIN_OVERWRITE' || !c.kind,
    ) as VrConfigDriftConflict[];
    const warnings = (err.conflicts || []).filter((c) => c.kind === 'PLATFORM_STALE');
    await confirmOverwriteDrift(
      blockers.length ? blockers : (err.conflicts as VrConfigDriftConflict[]),
      warnings,
    );
    const response = await postDeployPush(cfg.pushPath, vrId, true, extraBody);
    return { response, driftWarnings: warnings.length ? warnings : undefined };
  }
};

/** 为每台 VR 生成「预览 → 下发 → [回查]」步骤（IPsec / SRv6 向导共用） */
export const buildIbrDeployWizardSteps = (
  endpoints: Array<{ label: string; vrId?: string | null }>,
  feature: IbrDeployFeature,
  options?: { includeVerify?: boolean },
): IbrDeployWizardStep[] => {
  const cfg = IBR_DEPLOY_FEATURES[feature];
  const includeVerify = options?.includeVerify === true && !!cfg.verifyPath;
  const steps: IbrDeployWizardStep[] = [];

  for (const ep of endpoints) {
    const vrId = String(ep.vrId || '').trim();
    if (!vrId) continue;

    if (cfg.previewPath) {
      steps.push({
        title: `预览 ${ep.label}`,
        desc: '读取平台待下发配置并检测漂移',
        kind: 'preview',
        feature,
        vrId,
        endpointLabel: ep.label,
      });
    }

    steps.push({
      title: `下发 ${ep.label}`,
      desc: '漂移确认后推送到设备',
      kind: 'push',
      feature,
      vrId,
      endpointLabel: ep.label,
    });

    if (includeVerify && cfg.verifyPath) {
      steps.push({
        title: `回查 ${ep.label}`,
        desc: '从设备读取配置并校验',
        kind: 'verify',
        feature,
        vrId,
        endpointLabel: ep.label,
      });
    }
  }

  return steps;
};

/** 执行单步（预览 / 下发 / 回查），返回日志文本 */
export const executeIbrDeployWizardStep = async (step: IbrDeployWizardStep): Promise<string> => {
  const cfg = IBR_DEPLOY_FEATURES[step.feature];
  const tag = step.endpointLabel || cfg.label;

  if (step.kind === 'preview') {
    if (!cfg.previewPath) {
      throw new Error(`${cfg.label} 不支持配置预览`);
    }
    const res = (await apiRequest(cfg.previewPath(step.vrId), REQUEST_OPTS)) as {
      error?: string;
      config?: unknown;
    };
    if (res?.error) throw new Error(res.error);
    const drift = await fetchDeployDrift(step.vrId, cfg.domain);
    return [
      `[${tag}] 平台待下发配置（清洗后）`,
      JSON.stringify(res.config, null, 2),
      '',
      formatDriftSection(drift),
    ].join('\n');
  }

  if (step.kind === 'push') {
    const { response, driftWarnings } = await pushWithDriftGuard(step.vrId, step.feature);
    const row = response as { error?: string; data?: unknown };
    if (row?.error) throw new Error(String(row.error));
    const lines = [`[${tag}] 下发设备响应`, JSON.stringify(row.data ?? response, null, 2)];
    if (driftWarnings?.length) {
      lines.push('', '[平台库滞后提示]', ...driftWarnings.map((w) => `  • ${w.message}`));
    }
    return lines.join('\n');
  }

  if (step.kind === 'verify') {
    if (!cfg.verifyPath) {
      throw new Error(`${cfg.label} 不支持设备回查`);
    }
    const res = (await apiRequest(cfg.verifyPath(step.vrId), REQUEST_OPTS)) as {
      error?: string;
      ipsecCount?: number;
      config?: unknown;
    };
    if (res?.error) throw new Error(res.error);
    if (step.feature === 'ipsec' && (res.ipsecCount ?? 0) === 0) {
      throw new Error('设备上未找到 IPsec 连接，请确认下发是否成功');
    }
    return [
      `[${tag}] 设备回查`,
      `IPsec 条目数: ${res.ipsecCount ?? '—'}`,
      JSON.stringify(res.config, null, 2),
    ].join('\n');
  }

  throw new Error(`未知下发步骤类型：${(step as IbrDeployWizardStep).kind}`);
};

/** 列表页等场景：确认后走统一下发（漂移检测 → 推送） */
export const runIbrDeployPushInteractive = (options: {
  vrId: string;
  feature: IbrDeployFeature;
  confirmTitle?: string;
  confirmContent?: string;
}): Promise<unknown> => {
  const cfg = IBR_DEPLOY_FEATURES[options.feature];
  return new Promise((resolve, reject) => {
    Modal.confirm({
      title: options.confirmTitle ?? `确认下发 ${cfg.label} 配置`,
      content:
        options.confirmContent ??
        `将按平台 ${cfg.label} 配置推送到设备；若存在漂移，系统会在下发前提示确认。`,
      okText: '继续',
      cancelText: '取消',
      onOk: async () => {
        try {
          const { response } = await pushWithDriftGuard(options.vrId, options.feature);
          resolve(response);
        } catch (e) {
          reject(e);
        }
      },
      onCancel: () => reject(new DeployDriftCancelledError()),
    });
  });
};

export { DeployDriftCancelledError };
