import { Modal } from 'antd';
import { apiPost, apiRequest } from '../services/api';

export type VrConfigDeployDomain = 'acl' | 'nat' | 'ipsec' | 'srv6';

export type VrConfigDriftConflict = {
  kind: 'DOMAIN_OVERWRITE' | 'PLATFORM_STALE';
  key: string;
  message: string;
};

export type DeployDriftReport = {
  vrId: string;
  domain: VrConfigDeployDomain;
  conflicts: VrConfigDriftConflict[];
  blocking: boolean;
};

export class DeployDriftCancelledError extends Error {
  constructor() {
    super('已取消下发');
    this.name = 'DeployDriftCancelledError';
  }
}

const formatConflictLines = (conflicts: VrConfigDriftConflict[]): string =>
  conflicts.map((c) => `• ${c.message}`).join('\n');

/** 查询设备与平台意图的漂移（下发前预览） */
export const fetchDeployDrift = async (
  vrId: string,
  domain: VrConfigDeployDomain,
): Promise<DeployDriftReport> => {
  const json = await apiRequest(
    `/api/vr-config/${encodeURIComponent(vrId)}/deploy-drift?domain=${encodeURIComponent(domain)}`,
    { skipCache: true },
  );
  const data = (json as { data?: DeployDriftReport })?.data ?? json;
  return data as DeployDriftReport;
};

const confirmOverwriteDrift = (
  blockers: VrConfigDriftConflict[],
  warnings: VrConfigDriftConflict[],
): Promise<void> =>
  new Promise((resolve, reject) => {
    const lines = [
      '设备现网配置与平台意图不一致，继续下发将覆盖设备侧历史策略：',
      '',
      formatConflictLines(blockers),
    ];
    if (warnings.length > 0) {
      lines.push('', '以下项本次会保留设备现网值，但平台库可能滞后：', '', formatConflictLines(warnings));
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

/**
 * 漂移检测：存在 DOMAIN_OVERWRITE 时弹窗确认；返回是否需 acknowledgeDrift。
 */
export const ensureDeployDriftAcknowledged = async (
  vrId: string,
  domain: VrConfigDeployDomain,
): Promise<{ acknowledgeDrift: boolean; driftWarnings?: VrConfigDriftConflict[] }> => {
  const report = await fetchDeployDrift(vrId, domain);
  const blockers = report.conflicts.filter((c) => c.kind === 'DOMAIN_OVERWRITE');
  const warnings = report.conflicts.filter((c) => c.kind === 'PLATFORM_STALE');

  if (blockers.length > 0) {
    await confirmOverwriteDrift(blockers, warnings);
    return {
      acknowledgeDrift: true,
      driftWarnings: warnings.length ? warnings : undefined,
    };
  }

  return {
    acknowledgeDrift: false,
    driftWarnings: warnings.length ? warnings : undefined,
  };
};

export const postDeployPush = async (
  pushPath: string,
  vrId: string,
  acknowledgeDrift: boolean,
  extraBody?: Record<string, unknown>,
): Promise<unknown> =>
  apiPost(pushPath, {
    vrId,
    acknowledgeDrift,
    ...extraBody,
  });

const isConfigDrift409 = (err: unknown): err is { status: number; conflicts?: VrConfigDriftConflict[] } => {
  const e = err as { status?: number; conflicts?: VrConfigDriftConflict[] };
  return e?.status === 409 && Array.isArray(e.conflicts) && e.conflicts.length > 0;
};

/** 漂移检测 → 下发；409 时二次确认并重试 */
export const runDeployPushWithDriftGuard = async (options: {
  vrId: string;
  domain: VrConfigDeployDomain;
  pushPath: string;
  extraBody?: Record<string, unknown>;
}): Promise<unknown> => {
  const { vrId, domain, pushPath, extraBody } = options;
  let { acknowledgeDrift } = await ensureDeployDriftAcknowledged(vrId, domain);

  try {
    return await postDeployPush(pushPath, vrId, acknowledgeDrift, extraBody);
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
    acknowledgeDrift = true;
    return postDeployPush(pushPath, vrId, acknowledgeDrift, extraBody);
  }
};
