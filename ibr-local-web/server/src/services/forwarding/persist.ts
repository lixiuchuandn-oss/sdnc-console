import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from '../../vrwizard.js';

export function forwardingDataDir(paths: Paths): string {
	return path.dirname(paths.stateFile);
}

export function managedAclsPath(paths: Paths): string {
	return path.join(forwardingDataDir(paths), 'managed_acls.json');
}

export function ipsecMonitorConfigPath(paths: Paths): string {
	return path.join(forwardingDataDir(paths), 'ipsec_monitor.json');
}

export function ipsecMonitorLogPath(paths: Paths): string {
	return path.join(forwardingDataDir(paths), 'ipsec_monitor.log');
}

export function loadJsonArrayFile(file: string): string[] {
	if (!fs.existsSync(file)) return [];
	try {
		const raw = fs.readFileSync(file, 'utf-8');
		const j = JSON.parse(raw) as unknown;
		if (!Array.isArray(j)) return [];
		return j.filter((x): x is string => typeof x === 'string');
	} catch {
		return [];
	}
}

export function saveJsonArrayFile(file: string, ids: string[]): void {
	const dir = path.dirname(file);
	fs.mkdirSync(dir, { recursive: true });
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(ids, null, 2) + '\n', 'utf-8');
	fs.renameSync(tmp, file);
}
