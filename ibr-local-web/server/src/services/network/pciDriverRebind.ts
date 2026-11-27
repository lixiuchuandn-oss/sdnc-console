/**
 * P2：将 PCI 从 vfio-pci 退回内核网卡驱动（真退回 OS）。
 * 须在 vbras 已停止后调用；禁止碰管理口。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePciId, readPciDriver } from './nicIdentity.js';

const VIRTIO_VENDOR = '0x1af4';
const VFIO = 'vfio-pci';
const PCI_BDF_RE = /^[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-7]$/;
const OS_DRIVER_RE = /^[A-Za-z0-9_-]{1,64}$/;

function exists(p: string): boolean {
	try {
		return fs.existsSync(p);
	} catch {
		return false;
	}
}

function readSysText(p: string): string {
	try {
		if (!exists(p)) return '';
		return fs.readFileSync(p, 'utf8').trim();
	} catch {
		return '';
	}
}

/** sysfs 属性需要换行；禁止 0 字节空写。 */
function writeSysText(p: string, value: string): void {
	const body = value.endsWith('\n') ? value : `${value}\n`;
	fs.writeFileSync(p, body, 'utf8');
}

export function isValidPciBdf(pci: string): boolean {
	return PCI_BDF_RE.test(normalizePciId(pci));
}

/** 只允许内核驱动名；拒绝 vfio、路径穿越。 */
export function sanitizeOsDriverName(raw: string | null | undefined): string {
	const s = typeof raw === 'string' ? raw.trim() : '';
	if (!s || s.toLowerCase() === VFIO) return '';
	if (!OS_DRIVER_RE.test(s)) return '';
	return s;
}

export function readPciVendorId(pci: string): string {
	const p = normalizePciId(pci);
	if (!p || !isValidPciBdf(p) || process.platform === 'win32') return '';
	return readSysText(path.posix.join('/sys/bus/pci/devices', p, 'vendor')).toLowerCase();
}

/** 从 nic_roles 行提取非 vfio 的 os.driver 提示。 */
export function preferredOsDriverFromRolesHint(rolesConf: unknown, pci: string): string {
	const target = normalizePciId(pci);
	if (!target || !rolesConf || typeof rolesConf !== 'object') return '';
	const roles = Array.isArray((rolesConf as { roles?: unknown }).roles)
		? ((rolesConf as { roles: unknown[] }).roles as Record<string, unknown>[])
		: [];
	for (const r of roles) {
		if (!r || typeof r !== 'object') continue;
		if (normalizePciId(r.pci) !== target) continue;
		const os = r.os && typeof r.os === 'object' ? (r.os as Record<string, unknown>) : null;
		return sanitizeOsDriverName(typeof os?.driver === 'string' ? os.driver : '');
	}
	return '';
}

/**
 * 选定退回 OS 的目标驱动：
 * 1) 显式 preferred（快照 os.driver，已消毒）
 * 2) virtio 设备 → virtio-pci
 * 3) 空串 = 无法安全 probe（禁止空 override + drivers_probe，否则 vfio 会抢回）
 */
export function resolveOsTargetDriver(params: {
	pci: string;
	preferred?: string | null;
	vendorId?: string | null;
}): string {
	const pref = sanitizeOsDriverName(params.preferred);
	if (pref) return pref;
	const vendor = (params.vendorId ?? readPciVendorId(params.pci)).toLowerCase();
	if (vendor === VIRTIO_VENDOR || vendor === '1af4') return 'virtio-pci';
	return '';
}

export type RebindPlan = {
	pci: string;
	currentDriver: string;
	targetDriver: string;
	alreadyOs: boolean;
	needsUnbindVfio: boolean;
};

export function planPciReturnToOs(params: {
	pci: string;
	preferred?: string | null;
}): RebindPlan {
	const pci = normalizePciId(params.pci);
	const currentDriver = isValidPciBdf(pci) ? readPciDriver(pci) : '';
	const targetDriver = resolveOsTargetDriver({
		pci,
		preferred: params.preferred,
		vendorId: isValidPciBdf(pci) ? readPciVendorId(pci) : '',
	});
	const cur = currentDriver.toLowerCase();
	const alreadyOs = Boolean(cur && cur !== VFIO);
	return {
		pci,
		currentDriver,
		targetDriver,
		alreadyOs,
		needsUnbindVfio: cur === VFIO,
	};
}

function sleepMs(ms: number): void {
	try {
		if (process.platform === 'win32') {
			execFileSync('powershell', ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${ms}`], {
				stdio: 'ignore',
				timeout: ms + 2000,
			});
		} else {
			execFileSync('sleep', [`${Math.max(0.05, ms / 1000)}`], { stdio: 'ignore', timeout: ms + 2000 });
		}
	} catch {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			/* fallback */
		}
	}
}

function sysfsDev(pci: string, ...parts: string[]): string {
	return path.posix.join('/sys/bus/pci/devices', pci, ...parts);
}

/**
 * 将单块 PCI 退回内核驱动。Windows / 非 root 失败写入 logs，不抛致命（由调用方汇总）。
 */
export function rebindPciToOsDriver(params: {
	pci: string;
	preferred?: string | null;
	logs: string[];
}): { ok: boolean; driverAfter: string } {
	const pci = normalizePciId(params.pci);
	const logs = params.logs;
	if (!pci || !isValidPciBdf(pci)) {
		logs.push(`错误: 非法 PCI BDF: ${params.pci || '(空)'}`);
		return { ok: false, driverAfter: '' };
	}
	if (process.platform === 'win32') {
		logs.push(`Windows 跳过 PCI rebind: ${pci}`);
		return { ok: true, driverAfter: readPciDriver(pci) };
	}

	const plan = planPciReturnToOs({ pci, preferred: params.preferred });
	logs.push(
		`退回 OS 计划 ${pci}: current=${plan.currentDriver || '-'} target=${plan.targetDriver || '(none)'} already_os=${plan.alreadyOs}`,
	);
	if (plan.alreadyOs) {
		logs.push(`已在内核驱动 ${plan.currentDriver}，跳过 rebind`);
		return { ok: true, driverAfter: plan.currentDriver };
	}

	if (!plan.targetDriver) {
		logs.push(`错误: ${pci} 无法解析内核目标驱动，拒绝 unbind（空 override + probe 会被 vfio 抢回）`);
		return { ok: false, driverAfter: plan.currentDriver };
	}

	const devDir = sysfsDev(pci);
	if (!exists(devDir)) {
		logs.push(`错误: 无 sysfs 设备 ${devDir}`);
		return { ok: false, driverAfter: '' };
	}

	try {
		const overridePath = sysfsDev(pci, 'driver_override');
		if (exists(overridePath)) {
			writeSysText(overridePath, plan.targetDriver);
			logs.push(`已设 driver_override=${plan.targetDriver}（阻止 vfio 再抢）`);
		}

		if (plan.needsUnbindVfio) {
			const unbind = path.posix.join('/sys/bus/pci/drivers', VFIO, 'unbind');
			if (!exists(unbind)) {
				logs.push(`错误: 无 ${unbind}`);
				return { ok: false, driverAfter: readPciDriver(pci) };
			}
			writeSysText(unbind, pci);
			logs.push(`已从 ${VFIO} unbind: ${pci}`);
			sleepMs(200);
		}

		const bind = path.posix.join('/sys/bus/pci/drivers', plan.targetDriver, 'bind');
		if (exists(bind)) {
			try {
				writeSysText(bind, pci);
				logs.push(`已 bind ${plan.targetDriver}: ${pci}`);
			} catch (e) {
				logs.push(`bind ${plan.targetDriver} 提示: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		const probe = '/sys/bus/pci/drivers_probe';
		if (exists(probe) && readPciDriver(pci).toLowerCase() !== plan.targetDriver.toLowerCase()) {
			try {
				writeSysText(probe, pci);
				logs.push(`已触发 drivers_probe: ${pci}`);
			} catch (e) {
				logs.push(`drivers_probe 提示: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		sleepMs(400);
		const after = readPciDriver(pci);
		const ok = Boolean(after && after.toLowerCase() !== VFIO);
		if (ok && exists(overridePath)) {
			try {
				writeSysText(overridePath, '\n');
				logs.push('已清除 driver_override，便于日后 vfio 再接管');
			} catch (e) {
				logs.push(`清除 driver_override 提示: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		logs.push(ok ? `退回 OS 成功: ${pci} → ${after}` : `警告: ${pci} rebind 后仍为 ${after || '(无驱动)'}`);
		return { ok, driverAfter: after };
	} catch (e) {
		logs.push(`退回 OS 失败 ${pci}: ${e instanceof Error ? e.message : String(e)}`);
		return { ok: false, driverAfter: readPciDriver(pci) };
	}
}

/** 批量退回；跳过 mgmt。返回失败 PCI 列表。 */
export function rebindPcisToOs(params: {
	pcis: string[];
	mgmtPci?: string | null;
	rolesConf?: unknown;
	logs: string[];
}): { failed: string[]; ok: string[] } {
	const mgmt = normalizePciId(params.mgmtPci);
	const ok: string[] = [];
	const failed: string[] = [];
	for (const raw of params.pcis) {
		const pci = normalizePciId(raw);
		if (!pci || pci === mgmt) continue;
		const preferred = preferredOsDriverFromRolesHint(params.rolesConf, pci);
		const res = rebindPciToOsDriver({ pci, preferred, logs: params.logs });
		if (res.ok) ok.push(pci);
		else failed.push(pci);
	}
	return { failed, ok };
}
