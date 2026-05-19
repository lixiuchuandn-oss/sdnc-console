/** DELETE /api/tenants/:id 失败时的解析结果（与后端 409 响应体对齐） */

export type TenantBlockingResourceRow = { name?: string; count?: number };

export type ParsedTenantDeleteError = {
  status?: number;
  message: string;
  resources: TenantBlockingResourceRow[];
  blockingReason?: string;
  userCount?: number;
};

function coerceResources(raw: unknown): TenantBlockingResourceRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    const row = x as Record<string, unknown>;
    return {
      name: typeof row.name === 'string' ? row.name : undefined,
      count: typeof row.count === 'number' ? row.count : undefined,
    };
  });
}

/** 将 apiDelete/allSettled 的 rejection reason 解析为结构化字段 */
export function parseTenantDeleteError(reason: unknown): ParsedTenantDeleteError {
  const r = reason as {
    response?: { status?: number; data?: Record<string, unknown> };
    message?: string;
  };
  const status = r?.response?.status;
  const data = r?.response?.data;
  const message =
    (typeof data?.message === 'string' && data.message) ||
    (typeof r?.message === 'string' && r.message) ||
    '删除租户失败';

  return {
    status,
    message,
    resources: coerceResources(data?.resources),
    blockingReason: typeof data?.blockingReason === 'string' ? data.blockingReason : undefined,
    userCount: typeof data?.userCount === 'number' ? data.userCount : undefined,
  };
}
