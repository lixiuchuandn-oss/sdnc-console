import type { Router } from 'express';
import { getAuthorizationBearer } from '../../lib/towerAuth.js';
import type { AuthedRequest } from '../../middleware/sso.js';
import { getPaths, loadState } from '../../vrwizard.js';
import { tracePayload } from './helpers.js';

function pickOidcDisplayName(raw: unknown): string | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
	const p = raw as Record<string, unknown>;
	for (const k of ['name', 'preferred_username', 'email', 'upn', 'unique_name', 'nickname']) {
		const v = p[k];
		if (typeof v === 'string' && v.trim()) return v.trim();
	}
	return undefined;
}

export function registerMetaRoutes(r: Router): void {
	r.get('/me', (req: AuthedRequest, res) => {
		const out: {
			sub?: string;
			name?: string;
			tenant_id?: string;
			org_id?: string;
			tenant_name?: string;
			org_name?: string;
			trace_id?: string;
		} = { ...tracePayload(res) };

		out.sub = req.auth?.sub;
		out.name = req.auth?.name;
		if (!out.name) {
			const n = pickOidcDisplayName(req.auth?.raw);
			if (n) out.name = n;
		}

		const authBearer = getAuthorizationBearer(req);
		if (authBearer) {
			const state = loadState(getPaths());
			const acc = state.account;
			if (acc && typeof acc === 'object') {
				const a = acc as Record<string, unknown>;
				const stok = typeof a.access_token === 'string' ? a.access_token.trim() : '';
				if (stok && stok === authBearer) {
					if (typeof a.display_name === 'string' && a.display_name.trim()) {
						out.name = a.display_name.trim();
					} else if (typeof a.username === 'string' && a.username.trim()) {
						out.name = a.username.trim();
					}
					if (typeof a.username === 'string' && a.username.trim()) {
						out.sub = a.username.trim();
					}
					if (a.tenant_id != null) out.tenant_id = String(a.tenant_id);
					if (a.org_id != null) out.org_id = String(a.org_id);
					if (typeof a.tenant_name === 'string' && a.tenant_name.trim()) {
						out.tenant_name = a.tenant_name.trim();
					}
					if (typeof a.org_name === 'string' && a.org_name.trim()) {
						out.org_name = a.org_name.trim();
					}
				}
			}
		}

		res.json(out);
	});

	r.get('/version', (_req, res) => {
		res.json({ ...tracePayload(res), version: '2.0.0' });
	});
}
