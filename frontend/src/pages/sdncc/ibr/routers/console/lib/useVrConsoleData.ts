import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { apiPost } from '../../../../../../services/api';
import {
	fetchIbrDeviceStatus,
	type IbrDeviceStatusResp,
} from '../../../../../../services/ibrDeviceOpsApi';
import {
	fetchVrCacheMerged,
	fetchVrTowerLocalConfigCache,
} from '../../../../../../services/virtualRouterApi';
import type { VrConsolePanelId } from './consolePanels';
import type { VrConsoleDeviceInfoTabId } from './deviceInfoTabs';

export type VrConsoleMetadata = {
	csmctl: Record<string, unknown>;
	vr2: unknown;
	vr3: unknown;
	mergedFull: Record<string, unknown> | null;
};

export type TowerLocalConfigCache = {
	config: unknown;
	meta: { updatedAt?: string; role?: string } | null;
};

function normalizeHealth(raw: unknown): 'online' | 'offline' | 'warn' | 'unknown' {
	const s = String(raw || '').toLowerCase();
	if (['online', 'healthy', 'running', 'ok', 'active', 'up'].includes(s)) return 'online';
	if (['offline', 'down', 'stopped', 'error', 'failed', 'unhealthy'].includes(s)) return 'offline';
	if (['warning', 'degraded'].includes(s)) return 'warn';
	return 'unknown';
}

export function useVrConsoleData(
	vrUuid: string,
	activePanel: VrConsolePanelId,
	deviceInfoTab?: VrConsoleDeviceInfoTabId,
) {
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [metadata, setMetadata] = useState<VrConsoleMetadata | null>(null);
	const [towerCache, setTowerCache] = useState<TowerLocalConfigCache | null>(null);
	const [towerCacheError, setTowerCacheError] = useState<string | null>(null);
	const [towerCacheLoading, setTowerCacheLoading] = useState(false);
	const [deviceStatus, setDeviceStatus] = useState<IbrDeviceStatusResp | null>(null);
	const [deviceStatusLoading, setDeviceStatusLoading] = useState(false);

	const managementIp = useMemo(() => {
		const m = metadata?.mergedFull;
		if (!m) return '';
		return String(m.management_ip ?? m.managementIp ?? '').trim();
	}, [metadata]);

	const loadMerged = useCallback(async () => {
		if (!vrUuid) {
			setMetadata(null);
			return;
		}
		setLoading(true);
		try {
			const merged = await fetchVrCacheMerged(vrUuid);
			if (merged && typeof merged === 'object') {
				const m = merged as Record<string, unknown>;
				setMetadata({
					mergedFull: m,
					csmctl: (m._raw_csmctl_info as Record<string, unknown>) ?? {},
					vr2: m.vr2_info ?? null,
					vr3: m.vr3_info ?? null,
				});
			} else {
				setMetadata(null);
			}
		} catch (e) {
			console.warn('[VrConsole] fetch merged failed', e);
			message.error('加载 IBR 详情失败');
			setMetadata(null);
		} finally {
			setLoading(false);
		}
	}, [vrUuid]);

	const loadDeviceStatus = useCallback(
		async (silent = false) => {
			if (!vrUuid || !managementIp) {
				setDeviceStatus(null);
				setDeviceStatusLoading(false);
				return;
			}
			if (!silent) setDeviceStatusLoading(true);
			try {
				const res = await fetchIbrDeviceStatus(vrUuid, { skipCache: true });
				setDeviceStatus(res);
			} catch (e) {
				console.warn('[VrConsole] fetch device status failed', e);
				if (!silent) setDeviceStatus(null);
			} finally {
				if (!silent) setDeviceStatusLoading(false);
			}
		},
		[vrUuid, managementIp],
	);

	const loadDeviceStatusRef = useRef(loadDeviceStatus);
	loadDeviceStatusRef.current = loadDeviceStatus;

	useEffect(() => {
		if (!managementIp) {
			setDeviceStatus(null);
			setDeviceStatusLoading(false);
			return;
		}
		void loadDeviceStatusRef.current(false);
		const tick = () => {
			if (document.visibilityState !== 'visible') return;
			void loadDeviceStatusRef.current(true);
		};
		const timer = window.setInterval(tick, 5000);
		const onVisibility = () => {
			if (document.visibilityState === 'visible') {
				void loadDeviceStatusRef.current(true);
			}
		};
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			window.clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}, [managementIp]);

	const loadTowerCache = useCallback(async () => {
		if (!vrUuid) return;
		setTowerCacheLoading(true);
		setTowerCacheError(null);
		try {
			const cached = await fetchVrTowerLocalConfigCache(vrUuid, { skipCache: true });
			setTowerCache(cached);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			setTowerCacheError(msg);
			setTowerCache(null);
		} finally {
			setTowerCacheLoading(false);
		}
	}, [vrUuid]);

	useEffect(() => {
		void loadMerged();
	}, [loadMerged]);

	useEffect(() => {
		if (activePanel === 'ops-device-info' && deviceInfoTab === 'cache') {
			void loadTowerCache();
		}
	}, [activePanel, deviceInfoTab, loadTowerCache]);

	const refresh = useCallback(async () => {
		setRefreshing(true);
		try {
			try {
				await apiPost('/api/vr-instances/refresh', {});
			} catch {
				message.warning('从 CSMCTL 同步缓存失败，仍将拉取当前合并数据');
			}
			await loadMerged();
			if (managementIp) {
				await loadDeviceStatus(true);
			}
			if (activePanel === 'ops-device-info' && deviceInfoTab === 'cache') {
				await loadTowerCache();
			}
			message.success('已刷新');
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			message.error(`刷新失败：${msg}`);
		} finally {
			setRefreshing(false);
		}
	}, [loadMerged, loadDeviceStatus, loadTowerCache, activePanel, deviceInfoTab, managementIp]);

	const summary = useMemo(() => {
		const m = metadata?.mergedFull;
		if (!m) {
			return {
				name: '—',
				uuid: vrUuid,
				statusKey: 'unknown' as const,
				statusLabel: '未知',
				role: '',
				management_ip: '',
				mac: '',
				version: '',
			};
		}
		const healthRaw = m.health_status ?? m.healthStatus ?? m.status ?? '';
		const statusKey = normalizeHealth(healthRaw);
		const statusLabel =
			statusKey === 'online'
				? '运行中'
				: statusKey === 'offline'
					? '已停止'
					: statusKey === 'warn'
						? '警告'
						: '未知';
		return {
			name: String(m.name ?? '—'),
			uuid: String(m.uuid || vrUuid),
			statusKey,
			statusLabel,
			role: String(
				(metadata?.vr2 && typeof metadata.vr2 === 'object'
					? (metadata.vr2 as Record<string, unknown>).role
					: '') ??
					m.role ??
					'',
			),
			management_ip: String(m.management_ip ?? m.managementIp ?? ''),
			mac: String(m.mac ?? ''),
			version: String(m.version ?? ''),
		};
	}, [metadata, vrUuid]);

	const getJsonText = useCallback(
		(tab: VrConsoleDeviceInfoTabId): string => {
			if (tab === 'vr1') {
				return JSON.stringify(metadata?.csmctl ?? {}, null, 2);
			}
			if (tab === 'vr2') {
				return metadata?.vr2
					? JSON.stringify(metadata.vr2, null, 2)
					: '暂无 VR2 实时数据（CSMCTL 不可用或未返回 vr2_info）';
			}
			if (tab === 'vr3') {
				return metadata?.vr3
					? JSON.stringify(metadata.vr3, null, 2)
					: '暂无 VR3 扩展信息或获取失败';
			}
			if (tab === 'cache') {
				if (towerCacheLoading) return '正在从 Tower 数据库加载本地已保存配置…';
				if (towerCacheError) return `加载失败：${towerCacheError}`;
				if (!towerCache) {
					return 'Tower 本地尚未保存该 IBR 的配置（数据库无 vr_config 记录）';
				}
				return JSON.stringify(
					{ _towerLocalMeta: towerCache.meta ?? null, config: towerCache.config },
					null,
					2,
				);
			}
			if (tab === 'sase') {
				const vrctl = metadata?.mergedFull?.vr_tower_vrctl;
				if (vrctl && typeof vrctl === 'object') {
					return JSON.stringify(vrctl, null, 2);
				}
				return '暂无租户侧 vrctl 数据。可尝试刷新或完成租户绑定后再查看。';
			}
			return '';
		},
		[metadata, towerCache, towerCacheError, towerCacheLoading],
	);

	const jsonLoading = useMemo(() => {
		if (loading) return true;
		if (activePanel === 'ops-device-info' && deviceInfoTab === 'cache') {
			return towerCacheLoading;
		}
		return false;
	}, [loading, activePanel, deviceInfoTab, towerCacheLoading]);

	return {
		loading,
		refreshing,
		metadata,
		summary,
		deviceStatus,
		deviceStatusLoading,
		getJsonText,
		jsonLoading,
		refresh,
	};
}
