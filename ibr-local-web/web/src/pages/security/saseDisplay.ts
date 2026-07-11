import type { GatewayInfo, SecurityService, SecurityServiceRaw } from './saseTypes';

function nonEmptyStr(v: unknown): string {
	if (v == null) return '';
	const s = String(v).trim();
	return s;
}

function pickRaw(item: SecurityService): SecurityServiceRaw | null {
	const r = item.raw;
	if (r && typeof r === 'object' && !Array.isArray(r)) return r as SecurityServiceRaw;
	return null;
}

function instanceCount(item: SecurityService, raw: SecurityServiceRaw | null): number {
	if (typeof item.neCount === 'number' && item.neCount > 0) return item.neCount;
	if (Array.isArray(item.vmIds) && item.vmIds.length > 0) return item.vmIds.length;
	const c = item.count;
	if (typeof c === 'number' && c > 0) return c;
	const C = item.Count;
	if (typeof C === 'number' && C > 0) return C;
	if (Array.isArray(item.elements) && item.elements.length > 0) return item.elements.length;
	if (raw) {
		if (typeof raw.count === 'number' && raw.count > 0) return raw.count;
		if (typeof raw.Count === 'number' && raw.Count > 0) return raw.Count;
		if (Array.isArray(raw.elements) && raw.elements.length > 0) return raw.elements.length;
		const list = raw.vm_id_list;
		if (typeof list === 'string' && list.trim()) {
			return list
				.split(/[;,\s]+/u)
				.map((s) => s.trim())
				.filter(Boolean).length;
		}
	}
	const list = item.vm_id_list;
	if (typeof list === 'string' && list.trim()) {
		return list
			.split(/[;,\s]+/u)
			.map((s) => s.trim())
			.filter(Boolean).length;
	}
	return 0;
}

/** 人话短说明（可展示；不含 UUID/hex 等内部 id） */
function isLikelyInternalIdString(s: string): boolean {
	const t = s.replace(/-/g, '');
	if (t.length >= 24 && /^[0-9a-fA-F]+$/u.test(t)) return true;
	if (/[0-9a-fA-F]{16,}/u.test(s) && s.includes(',')) return true;
	return false;
}

/**
 * 列表行副标题：与平台主列表展平字段一致（vendor、type、defenseType、neCount、source），`raw` 仅作缺省回退。
 * 不展示 webId、webIds、vm 实例 id。
 */
export function securityServiceDescription(item: SecurityService): string | undefined {
	const raw = pickRaw(item);
	const parts: string[] = [];

	const vendor = nonEmptyStr(item.vendor) || nonEmptyStr(item.vendor_name) || (raw ? nonEmptyStr(raw.vendor_name) : '');
	if (vendor) parts.push(vendor);

	const typeStr =
		(item.type != null && item.type !== '' && nonEmptyStr(item.type)) ||
		nonEmptyStr(item.vm_type) ||
		nonEmptyStr(item.vmType) ||
		(raw ? nonEmptyStr(raw.vm_type) : '');
	if (typeStr) parts.push(typeStr);

	const defStr =
		nonEmptyStr(item.defenseType) ||
		(raw && raw.defend_type != null && !Number.isNaN(Number(raw.defend_type))
			? `防护类型 ${String(raw.defend_type)}`
			: item.defend_type != null && !Number.isNaN(Number(item.defend_type))
				? `防护类型 ${String(item.defend_type)}`
				: '');
	if (defStr) parts.push(defStr);

	const n = instanceCount(item, raw);
	if (n > 0) parts.push(`${n} 个实例`);

	// 来源/状态在列表标题行用 Tag 展示，副标题不重复
	if (parts.length > 0) return parts.join(' · ');

	const d = nonEmptyStr(item.description);
	if (d && !isLikelyInternalIdString(d)) return d;

	return undefined;
}

/** 网际路由域「计算云」展示 */
export function displayCloudLine(info: GatewayInfo | null | undefined): string {
	if (!info) return '—';
	const cn = info.cloudName;
	if (cn != null && String(cn).trim() !== '') return String(cn).trim();
	const cid = info.cloudId;
	if (cid != null && String(cid).trim() !== '' && String(cid) !== '-') return String(cid).trim();
	return '—';
}

export function listSecurityServiceItems(info: GatewayInfo | null | undefined) {
	if (!info) return [];
	return info.securityServices ?? [];
}
