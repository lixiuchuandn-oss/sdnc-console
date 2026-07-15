/**
 * Portal 下发的 Bearer JWT 校验（JWKS 或 PEM）；生产缺 token 时 401。
 * 非生产可无 token 注入开发用 `req.auth`；`SSO_DEV_BYPASS=true` 时跳过验签。
 */
import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTPayload } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import { getPaths, loadState } from '../vrwizard.js';

const JWT_VERIFY_CLOCK_TOLERANCE_SEC = 60;

export type AuthedRequest = Request & {
	auth?: {
		sub: string;
		name?: string;
		raw: JWTPayload;
	};
};

function getBearer(req: Request): string | null {
	const h = req.headers.authorization;
	if (!h?.startsWith('Bearer ')) return null;
	const t = h.slice(7).trim();
	return t || null;
}

/**
 * v1 风格：本机 `state.json` 中平台登录返回的 `access_token` 与当前 Bearer 一致则视为已登录（与 Portal JWT 二选一）。
 */
function tryResolveTowerAccountSession(req: AuthedRequest, token: string): boolean {
	try {
		const state = loadState(getPaths());
		const acc = state.account;
		if (!acc || typeof acc !== 'object') return false;
		const a = acc as Record<string, unknown>;
		const stored =
			typeof a.access_token === 'string' ? a.access_token.trim() : '';
		if (!stored || stored !== token.trim()) return false;
		const exp = a.expires_at;
		if (typeof exp === 'number' && Date.now() / 1000 > exp) return false;
		const sub = String(a.username ?? 'user');
		const name = (typeof a.display_name === 'string' && a.display_name) || sub;
		req.auth = { sub, name, raw: {} as JWTPayload };
		return true;
	} catch {
		return false;
	}
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function ssoAuthMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
	if (process.env.SSO_DEV_BYPASS === 'true') {
		const token = getBearer(req);
		if (token && tryResolveTowerAccountSession(req, token)) {
			return next();
		}
		req.auth = {
			sub: process.env.SSO_DEV_USER_ID ?? 'dev',
			name: process.env.SSO_DEV_USER_NAME ?? 'Dev',
			raw: {},
		};
		return next();
	}

	const token = getBearer(req);
	const issuer = process.env.SSO_ISSUER;
	const audience = process.env.SSO_AUDIENCE;
	const jwksUri = process.env.SSO_JWKS_URI;
	const publicKeyPem = process.env.SSO_PUBLIC_KEY_PEM?.replace(/\\n/g, '\n');

	if (!token) {
		if (process.env.NODE_ENV !== 'production') {
			req.auth = {
				sub: process.env.SSO_DEV_USER_ID ?? 'dev-local',
				name: process.env.SSO_DEV_USER_NAME ?? '本地开发',
				raw: {},
			};
			return next();
		}
		return res.status(401).json({ error: '未提供 Authorization: Bearer token' });
	}

	if (tryResolveTowerAccountSession(req, token)) {
		return next();
	}

	try {
		const verifyOpts = {
			issuer: issuer || undefined,
			audience: audience || undefined,
			clockTolerance: JWT_VERIFY_CLOCK_TOLERANCE_SEC,
		};

		let payload: JWTPayload;

		if (jwksUri) {
			if (!jwks) jwks = createRemoteJWKSet(new URL(jwksUri));
			({ payload } = await jwtVerify(token, jwks, verifyOpts));
		} else if (publicKeyPem) {
			const key = await importSPKI(publicKeyPem, 'RS256');
			({ payload } = await jwtVerify(token, key, verifyOpts));
		} else {
			if (process.env.NODE_ENV !== 'production') {
				req.auth = {
					sub: process.env.SSO_DEV_USER_ID ?? 'dev-local',
					name: process.env.SSO_DEV_USER_NAME ?? '本地开发',
					raw: {},
				};
				return next();
			}
			return res.status(401).json({
				error:
					'本环境未配置 Portal 验签（SSO_JWKS_URI / SSO_PUBLIC_KEY_PEM），且当前 Bearer 与本地平台会话不一致。请配置 SSO 或使用本机「平台账号」登录完成 state 绑定。',
			});
		}

		const sub = String(payload.sub ?? '');
		if (!sub) {
			return res.status(401).json({ error: 'Token 缺少 sub' });
		}

		const name =
			(typeof payload.name === 'string' && payload.name) ||
			(typeof payload.preferred_username === 'string' && payload.preferred_username) ||
			undefined;

		req.auth = { sub, name, raw: payload };
		next();
	} catch (e) {
		if (tryResolveTowerAccountSession(req, token)) {
			return next();
		}
		const msg = e instanceof Error ? e.message : 'Token 无效';
		return res.status(401).json({ error: msg });
	}
}
