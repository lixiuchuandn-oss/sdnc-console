/**
 * Harbor 项目路径解析
 *
 * Harbor API 将 URL 路径中的纯数字视为 project_id 而非项目名，
 * 需通过 ?projectId= 或按名称回退解析真实项目 ID。
 */
import { AuthRequest } from '../../middleware/auth';
import {
  HarborProxyService,
  isNumericHarborProjectName,
} from '../../services/harbor/HarborProxyService';

export { isNumericHarborProjectName };

/** 从请求中解析项目路径名与 Harbor API 引用 */
export function resolveHarborProjectRef(req: AuthRequest): {
  projectRef: string;
  harborProjectRef: string;
} {
  const projectRef = String(req.params.name ?? req.params.project ?? '');
  const projectIdQuery = req.query.projectId;
  const hasProjectIdQuery =
    projectIdQuery != null && String(projectIdQuery).trim() !== '';

  // 仅纯数字项目名需要改用 projectId；普通名称（如 library）必须继续用名称调 Harbor
  const harborProjectRef =
    hasProjectIdQuery && isNumericHarborProjectName(projectRef)
      ? String(projectIdQuery).trim()
      : projectRef;
  return { projectRef, harborProjectRef };
}

/** 纯数字项目名且未带 projectId 时，按名称解析 Harbor 项目 ID */
export async function resolveHarborProjectRefAsync(
  req: AuthRequest,
  service: HarborProxyService,
): Promise<{ projectRef: string; harborProjectRef: string }> {
  const { projectRef, harborProjectRef } = resolveHarborProjectRef(req);
  const hasProjectIdQuery =
    req.query.projectId != null && String(req.query.projectId).trim() !== '';

  if (hasProjectIdQuery || !isNumericHarborProjectName(projectRef)) {
    return { projectRef, harborProjectRef };
  }

  try {
    const project = await service.getProject(projectRef, projectRef);
    const resolvedId = project?.project_id;
    if (resolvedId != null) {
      return { projectRef, harborProjectRef: String(resolvedId) };
    }
  } catch {
    // 回退失败时沿用路径中的项目名
  }

  return { projectRef, harborProjectRef };
}

/** 数字项目名场景下传给 HarborProxyService 的上下文 */
export function buildHarborProjectContext(
  projectRef: string,
  harborProjectRef: string,
): { projectName: string; projectId?: number } {
  return {
    projectName: projectRef,
    projectId:
      isNumericHarborProjectName(projectRef) && /^\d+$/.test(harborProjectRef)
        ? Number(harborProjectRef)
        : undefined,
  };
}
