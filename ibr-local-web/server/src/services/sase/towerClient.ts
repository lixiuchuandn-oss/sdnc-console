import { httpRequestJson, sleepMs } from '../../lib/httpsInsecure.js';

/** HTML 错误页（如 Express「Cannot GET …」）转成人话，避免把整页 HTML 塞进异常信息 */
function summarizeTowerHttpError(status: number, body: string, requestUrl: string): string {
	const raw = body.replace(/\r\n/g, '\n').trim();
	const looksHtml =
		/^\s*<!DOCTYPE/i.test(raw) || /^\s*<html/i.test(raw) || (raw.includes('<body') && raw.includes('</html>'));
	if (looksHtml) {
		const preM = raw.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
		const oneLine = preM
			? preM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
			: raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
		const tip404 =
			status === 404
				? ' 常见两类原因：① compute_tower_base 指错（应指向真正提供该接口的 Tower 根地址，不是本控制台）。② 根地址对但**路径过旧**——现网若已不用 `/api/sase/gateways/info`，而改用如 `/api/security-domains` 等，请在 vrcontrol 设置 `tower_sase_gateways_info_path` 或环境变量 TOWER_SASE_GATEWAYS_INFO_PATH。'
				: '';
		return `对方返回了 HTML 错误页（不是 JSON 接口响应）。页内提示：${oneLine || '（空）'}.${tip404} 实际请求：${requestUrl}`;
	}
	const t = raw.replace(/\s+/g, ' ').trim();
	const snip = t.length > 600 ? `${t.slice(0, 600)}…` : t;
	return snip ? `响应体: ${snip}` : '无响应体';
}

/**
 * 将新接口如 `GET /api/security-domains?vr_uuid=` 的列表/包层结构，压成与旧 `gateways/info` 单域对象可比的形态。
 */
function coerceSecurityDomainJsonToRecord(json: unknown, vrUuid: string): Record<string, unknown> {
	const id = String(vrUuid ?? '').trim();
	const isMatch = (x: unknown): boolean => {
		if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
		const o = x as Record<string, unknown>;
		if (!id) return false;
		return ['vr_uuid', 'vrUuid', 'uuid', 'vrUniqueId', 'vm_id', 'id'].some(
			(k) => String(o[k] ?? '').trim() === id,
		);
	};
	if (Array.isArray(json)) {
		const found = json.find((x) => isMatch(x)) ?? (json[0] && typeof json[0] === 'object' ? json[0] : null);
		return found && typeof found === 'object' && !Array.isArray(found) ? { ...(found as Record<string, unknown>) } : {};
	}
	if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
	const o = json as Record<string, unknown>;
	for (const key of ['data', 'items', 'list', 'records', 'content', 'rows', 'domains'] as const) {
		const a = o[key];
		if (Array.isArray(a)) {
			return coerceSecurityDomainJsonToRecord(a, vrUuid);
		}
	}
	return { ...o };
}

/**
 * 将 Compute.Tower 网际路由域（IRD）/ gateways/info 响应归一为前端与 SSO 使用的一份对象。
 * Breaking Change 2026-06：安全服务仅来自 CSM 投影字段，不再使用 otherSecurityServices / securityServiceIds。
 */
export function normalizeSaseGatewayPayload(raw: Record<string, unknown>): Record<string, unknown> {
	let o: Record<string, unknown> = { ...raw };
	for (let i = 0; i < 3; i++) {
		const d = o.data;
		if (!d || typeof d !== 'object' || Array.isArray(d)) break;
		o = { ...o, ...(d as Record<string, unknown>) };
	}

	const pick = (camel: string, snake: string) => {
		if (o[camel] == null || o[camel] === '') {
			const v = o[snake];
			if (v != null && v !== '') o[camel] = v;
		}
	};

	pick('securityServices', 'security_services');
	pick('serviceChains', 'service_chains');
	pick('csmProtectionObjects', 'csm_protection_objects');
	pick('linkedCsmSecurityDomainId', 'linked_csm_security_domain_id');
	pick('linkedCsmSecurityDomain', 'linked_csm_security_domain');
	pick('csmCloudId', 'csm_cloud_id');
	pick('ssoEndpoint', 'sso_endpoint');
	pick('csmProjectionReady', 'csm_projection_ready');
	pick('csmProjectionError', 'csm_projection_error');
	pick('vrUuid', 'vr_uuid');

	if (!Array.isArray(o.securityServices)) {
		o.securityServices = [];
	}

	// 已废弃：不再向下游暴露
	delete o.otherSecurityServices;
	delete o.other_security_services;
	delete o.securityServiceIds;
	delete o.security_service_ids;

	if (o.csmInfo == null && o.csm_info != null && typeof o.csm_info === 'object') {
		o.csmInfo = o.csm_info;
	}
	if (o.cloudId == null || o.cloudId === '') {
		const c = o.cloud_id;
		if (c != null && c !== '') o.cloudId = c;
	}
	if (o.name == null) {
		for (const k of ['domain_name', 'display_name'] as const) {
			const v = o[k];
			if (typeof v === 'string' && v.trim()) {
				o.name = v.trim();
				break;
			}
		}
	}
	if (o.cloudName == null) {
		const c = o.cloud_name ?? o.csmCloudName ?? o.csm_cloud_name;
		if (typeof c === 'string' && c.trim()) o.cloudName = c;
	}
	return o;
}

export async function callSaseGatewayInfo(
	base: string,
	token: string,
	vrUuid: string,
	/** 默认 `/api/sase/gateways/info`；新平台可配置为如 `/api/security-domains` */
	infoPath = '/api/sase/gateways/info',
): Promise<Record<string, unknown>> {
	const path = infoPath.replace(/\/+$/, '') || '/api/sase/gateways/info';
	const qs = new URLSearchParams({ vr_uuid: vrUuid }).toString();
	const url = `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}?${qs}`;
	let lastErr: unknown;
	for (let i = 0; i < 3; i++) {
		try {
			const r = await httpRequestJson(url, 'GET', {
				Authorization: `Bearer ${token}`,
				'User-Agent': 'VRWizard/1.0',
				Connection: 'close',
			});
			if (r.status === 404) {
				let msg = '本 VR 尚未绑定网际路由域';
				if (r.json && typeof r.json === 'object') {
					const o = r.json as Record<string, unknown>;
					const zh = o.message_zh ?? o.message;
					if (typeof zh === 'string' && zh.trim()) msg = zh.trim();
				}
				const e = new Error(msg) as Error & { status?: number };
				e.status = 404;
				throw e;
			}
			if (r.status !== 200) {
				const detail = summarizeTowerHttpError(r.status, r.body, url);
				const e = new Error(`网际路由域查询失败: HTTP ${r.status}。${detail}`) as Error & { status?: number };
				e.status = r.status;
				throw e;
			}
			if (r.json == null) {
				throw new Error('网际路由域查询响应体为空');
			}
			const asRecord = coerceSecurityDomainJsonToRecord(r.json, vrUuid);
			if (Object.keys(asRecord).length === 0 && r.json && typeof r.json === 'object' && !Array.isArray(r.json)) {
				return normalizeSaseGatewayPayload(r.json as Record<string, unknown>);
			}
			if (Object.keys(asRecord).length === 0) {
				throw new Error('网际路由域查询：无法在响应中解析出与当前 VR 相关的记录（请检查 vr_uuid 或平台返回结构）');
			}
			return normalizeSaseGatewayPayload(asRecord);
		} catch (e) {
			lastErr = e;
			await sleepMs(500 * (i + 1));
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function callTowerReportAssets(
	base: string,
	token: string,
	vrUniqueId: string,
	assets: unknown[],
): Promise<Record<string, unknown>> {
	const url = `${base.replace(/\/+$/, '')}/api/sase/gateways/report-assets`;
	const payload = JSON.stringify({ vr_unique_id: vrUniqueId, assets });
	const r = await httpRequestJson(url, 'POST', {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${token}`,
		'User-Agent': 'VRWizard/1.0',
	}, payload);
	if (r.status === 404) {
		const e = new Error(
			'资产同步失败: Tower 平台未提供该接口 (404 Not Found)，请联系平台管理员',
		) as Error & { status?: number };
		e.status = 404;
		throw e;
	}
	if (r.status !== 200) {
		const e = new Error(`资产同步失败: HTTP ${r.status}`) as Error & { status?: number };
		e.status = r.status;
		throw e;
	}
	const j = r.json;
	if (j && typeof j === 'object' && (j as Record<string, unknown>).success === false) {
		throw new Error(
			`资产同步后端报错: ${String((j as Record<string, unknown>).message ?? '')}`,
		);
	}
	if (j && typeof j === 'object') return j as Record<string, unknown>;
	return { raw_body: r.body };
}
