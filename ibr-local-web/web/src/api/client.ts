import axios from 'axios';
import type { ApiError } from './apiError';

const TOKEN_KEY = 'paas_vr_console_token';

function rejectApiError(err: unknown, fallback: string): Promise<never> {
	const ax = axios.isAxiosError(err) ? err : null;
	const data = ax?.response?.data as { error?: string; trace_id?: string } | undefined;
	const msg = data?.error ?? (err instanceof Error ? err.message : fallback);
	const wrapped = new Error(msg) as ApiError;
	if (ax?.response?.status != null) wrapped.httpStatus = ax.response.status;
	return Promise.reject(wrapped);
}

/** 无需携带登录态，仅用于 `/api/public/*`（如 v1 风格平台账号登录） */
export const publicApi = axios.create({
	baseURL: '/api/public',
	headers: { 'Content-Type': 'application/json' },
});

publicApi.interceptors.response.use(
	(r) => r,
	(err) => rejectApiError(err, '请求失败'),
);

export function getToken(): string | null {
	return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
	if (token) localStorage.setItem(TOKEN_KEY, token);
	else localStorage.removeItem(TOKEN_KEY);
}

export const api = axios.create({
	baseURL: '/api',
	headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
	const t = getToken();
	if (t) {
		config.headers.Authorization = `Bearer ${t}`;
	}
	return config;
});

api.interceptors.response.use(
	(r) => r,
	(err) => rejectApiError(err, '请求失败'),
);
