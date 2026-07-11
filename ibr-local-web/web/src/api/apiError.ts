export type ApiError = Error & { httpStatus?: number };

export function getHttpStatus(e: unknown): number | undefined {
	if (e && typeof e === 'object' && 'httpStatus' in e) {
		const s = (e as ApiError).httpStatus;
		return typeof s === 'number' ? s : undefined;
	}
	return undefined;
}

const AUTH_HINTS = /请先登录|尚未登录|租户信息|访问令牌|未授权|Unauthorized/i;

export function isAuthRequiredError(e: unknown): boolean {
	if (getHttpStatus(e) === 401) return true;
	const msg = e instanceof Error ? e.message : String(e ?? '');
	return AUTH_HINTS.test(msg);
}
