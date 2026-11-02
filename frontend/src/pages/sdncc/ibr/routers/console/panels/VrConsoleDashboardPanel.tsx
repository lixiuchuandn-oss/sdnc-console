import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Grid, Progress, Space, Spin, Tag, Typography } from 'antd';
import { getApiErrorMessage } from '../../../../../../services/api';
import {
	fetchIbrDeviceAgentStatus,
	fetchIbrDeviceStatus,
	runIbrDeviceVbrasOp,
	type IbrDeviceAgentStatus,
	type IbrDeviceNetEntry,
	type IbrDeviceStatusResp,
} from '../../../../../../services/ibrDeviceOpsApi';
import { useIbrConsoleWritePermission } from '../lib/useIbrConsoleWritePermission';
import type { VrConsoleDeviceInfoTabId } from '../lib/deviceInfoTabs';
import type { VrConsolePanelId } from '../lib/consolePanels';
import { formatNicSnapshotLine } from '../lib/nicRoleResolve';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

const CHART_COLOR = '#388bfd';
const CHART_TRAIL = 'rgba(56, 139, 253, 0.15)';

type Props = {
	vrUuid: string;
	managementIp: string;
	onGoPanel: (panel: VrConsolePanelId) => void;
	onGoDeviceInfoTab: (tab: VrConsoleDeviceInfoTabId) => void;
};

function clampPercent(n: unknown) {
	const v = Number(n);
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, Math.min(100, v));
}

function fmtMaybe(s: unknown) {
	const v = String(s ?? '').trim();
	return v ? v : '—';
}

function fmtTime(ts: number | null) {
	if (!ts) return '—';
	try {
		return new Date(ts).toLocaleString();
	} catch {
		return '—';
	}
}

function linkGradeTagColor(grade: string) {
	const g = (grade || '').trim();
	if (!g || g === 'unknown') return 'default';
	const n = parseFloat(g.replace(/[^\d.]+/g, ''));
	const isG = g.includes('G');
	if (isG && Number.isFinite(n) && n >= 10) return 'purple';
	if (isG) return 'blue';
	if (g.includes('M')) return 'cyan';
	return 'default';
}

function linkDriverOnly(link: IbrDeviceNetEntry['link']): string {
	const d = link?.driver != null ? String(link.driver).trim() : '';
	return d;
}

function formatServiceAddress(raw: string | null | undefined): string {
	const v = String(raw ?? '').trim();
	if (!v) return '未配置';
	if (v.includes('://')) {
		try {
			const u = new URL(v);
			return u.host || v;
		} catch {
			return v.split('://')[1]?.split('/')[0]?.trim() || v;
		}
	}
	return v.split('/')[0]?.trim() || v;
}

function MetricGauge({
	title,
	percent,
	format,
	size,
}: {
	title: string;
	percent: number;
	format: () => string;
	size: number;
}) {
	return (
		<div className="ibr-console-dash-metric-item ibr-console-dash-gauge-item">
			<Progress
				type="dashboard"
				percent={percent}
				size={size}
				strokeColor={CHART_COLOR}
				strokeLinecap="round"
				trailColor={CHART_TRAIL}
				format={() => (
					<div className="ibr-console-dash-gauge-format">
						<div className="ibr-console-dash-muted">{title}</div>
						<div className="ibr-console-dash-strong ibr-console-dash-mono">{format()}</div>
					</div>
				)}
			/>
		</div>
	);
}

export const VrConsoleDashboardPanel: React.FC<Props> = ({
	vrUuid,
	managementIp,
	onGoPanel,
	onGoDeviceInfoTab,
}) => {
	const canWrite = useIbrConsoleWritePermission('networks.vr-config:write');

	const screens = Grid.useBreakpoint();
	const desktop = Boolean(screens.md);
	const nicCols = screens.sm ? (desktop ? 3 : 2) : 1;
	const metricCols = desktop ? 4 : 2;
	const gaugeSize = desktop ? 120 : 88;

	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<IbrDeviceStatusResp | null>(null);
	const [agentSummary, setAgentSummary] = useState<IbrDeviceAgentStatus | null>(null);
	const [lastUpdated, setLastUpdated] = useState<number | null>(null);
	const [op, setOp] = useState<null | 'start' | 'stop' | 'restart'>(null);
	const [opError, setOpError] = useState<string | null>(null);
	const mountedRef = useRef(true);

	const refresh = useCallback(
		async (opts?: { silent?: boolean }) => {
			const silent = Boolean(opts?.silent);
			if (!silent) setLoading(true);
			else setRefreshing(true);
			setError(null);
			try {
				const [statusRes, agentRes] = await Promise.allSettled([
					fetchIbrDeviceStatus(vrUuid, { skipCache: true }),
					fetchIbrDeviceAgentStatus(vrUuid, { skipCache: true }),
				]);
				if (!mountedRef.current) return;
				if (statusRes.status === 'fulfilled') {
					setStatus(statusRes.value);
					setLastUpdated(Date.now());
				} else {
					setError(getApiErrorMessage(statusRes.reason, '状态获取失败'));
				}
				if (agentRes.status === 'fulfilled') setAgentSummary(agentRes.value);
			} catch (e) {
				if (!mountedRef.current) return;
				setError(getApiErrorMessage(e, '状态获取失败'));
			} finally {
				if (!mountedRef.current) return;
				if (!silent) setLoading(false);
				setRefreshing(false);
			}
		},
		[vrUuid],
	);

	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;

	const runOp = useCallback(
		async (kind: 'start' | 'stop' | 'restart') => {
			setOp(kind);
			setOpError(null);
			try {
				const data = await runIbrDeviceVbrasOp(vrUuid, kind);
				if (data?.ok === false) {
					setOpError(String(data.error || data.message || '操作失败'));
				}
				await refresh({ silent: true });
			} catch (e) {
				setOpError(getApiErrorMessage(e, '操作失败'));
			} finally {
				setOp(null);
			}
		},
		[refresh, vrUuid],
	);

	useEffect(() => {
		mountedRef.current = true;
		void refresh({ silent: false });
		const tick = () => {
			if (document.visibilityState !== 'visible') return;
			void refreshRef.current({ silent: true });
		};
		const t = window.setInterval(tick, 5000);
		const onVis = () => {
			if (document.visibilityState === 'visible') void refreshRef.current({ silent: true });
		};
		document.addEventListener('visibilitychange', onVis);
		return () => {
			mountedRef.current = false;
			window.clearInterval(t);
			document.removeEventListener('visibilitychange', onVis);
		};
	}, [refresh]);

	const stats = status?.stats;
	const cpu = clampPercent(stats?.cpu ?? 0);
	const mem = clampPercent(stats?.mem ?? 0);
	const disk = clampPercent(stats?.disk ?? 0);
	const running = Boolean(status?.vbras_running);

	const cpuCount = Math.max(1, Number(stats?.cpu_count ?? 1));
	const loadToPercent = (n: unknown) => {
		if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
		return Math.max(0, Math.min(100, Math.round((n / cpuCount) * 1000) / 10));
	};
	const fmtLoad = (n: unknown) => {
		if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
		return n.toFixed(2);
	};

	const netItems = useMemo(() => {
		const ov = status?.net_overview ?? {};
		return [
			{ key: 'mgmt', title: '管理口', v: ov.mgmt },
			{ key: 'wan', title: 'WAN口', v: ov.wan },
			{ key: 'lan', title: 'LAN口', v: ov.lan },
		];
	}, [status?.net_overview]);

	const healthItems = useMemo(() => {
		const r = status?.service_reachability;
		const pending = Boolean(r?.pending);
		const line = (v: boolean | null, configured: boolean): { ok: boolean; neutral: boolean; value: string } => {
			if (!configured) return { ok: false, neutral: true, value: '未配置' };
			if (pending) return { ok: false, neutral: true, value: '检测中…' };
			if (v === null) return { ok: false, neutral: true, value: '—' };
			return { ok: v, neutral: false, value: v ? '可达' : '不可达' };
		};
		const rows = [
			{
				key: 'sdnc-console',
				label: 'SDN Console',
				address: status?.sdnc_console_base,
				reach: r?.sdnc_console ?? null,
			},
			{
				key: 'sdnc-csmctl',
				label: 'SDN CSMCTL',
				address: status?.sdnc_csmctl_address ?? status?.sdwan_manageip,
				reach: r?.sdnc_csmctl ?? r?.sdwan ?? null,
			},
			{
				key: 'compute-tower',
				label: 'Compute Tower',
				address: status?.compute_tower_base ?? status?.tower_base,
				reach: r?.compute_tower ?? r?.tower ?? null,
			},
			{
				key: 'aisoc',
				label: 'AI SOC',
				address: status?.ai_soc_base,
				reach: r?.aisoc ?? null,
			},
		];
		return rows.map((row) => {
			const addr = formatServiceAddress(row.address);
			const configured = addr !== '未配置';
			return {
				key: row.key,
				label: row.label,
				address: addr,
				...line(row.reach, configured),
			};
		});
	}, [status]);

	if (!managementIp) {
		return <VrConsoleNoDevicePanel />;
	}

	return (
		<div className="ibr-console-ops-panel ibr-console-ops-panel--dashboard">
			{error ? (
				<Alert
					type="error"
					showIcon
					message="状态获取失败"
					description={error}
					action={
						<Button size="small" onClick={() => void refresh({ silent: false })}>
							重试
						</Button>
					}
				/>
			) : null}

			{!error && status?.degraded && status.degraded.length > 0 ? (
				<Alert
					type="warning"
					showIcon
					message="部分状态来源不可用"
					description={
						<span>
							子系统：{status.degraded.join('、')}
							{status.trace_id ? (
								<>
									{' '}
									<Typography.Text type="secondary" copyable>
										trace_id：{status.trace_id}
									</Typography.Text>
								</>
							) : null}
						</span>
					}
				/>
			) : null}

			<div className="ibr-console-ops-section">
				<div className="ibr-console-ops-section-head">
					<Typography.Text className="ibr-console-ops-section-title">运行控制</Typography.Text>
					<Space wrap align="center">
						<span className="ibr-console-dash-updated">
							最后更新：{fmtTime(lastUpdated)}
							{refreshing ? '（更新中…）' : ''}
						</span>
						<Button
							type="text"
							className="ibr-console-ops-text-btn"
							icon={<ReloadOutlined spin={refreshing} />}
							onClick={() => void refresh({ silent: false })}
							disabled={loading || refreshing}
						>
							刷新
						</Button>
					</Space>
				</div>
				{loading && !status ? (
					<div className="ibr-console-ops-card">
						<div className="ibr-console-ops-loading">
							<Spin tip="加载设备状态…" />
						</div>
					</div>
				) : (
					<div className="ibr-console-ops-card">
						<div className="ibr-console-dash-run-row">
							<div className="ibr-console-dash-run-main">
								<div className={`ibr-console-dash-run-icon${running ? ' is-on' : ''}`}>
									{running ? (
										<PlayCircleOutlined style={{ fontSize: 20 }} />
									) : (
										<StopOutlined style={{ fontSize: 18 }} />
									)}
								</div>
								<div>
									<div className={`ibr-console-dash-strong${running ? ' is-on' : ' is-off'}`}>
										{running ? '运行中' : '未运行'}
									</div>
									<div className="ibr-console-dash-muted">
										运行时长 <span className="ibr-console-dash-strong ibr-console-dash-mono">{fmtMaybe(stats?.uptime)}</span>
									</div>
								</div>
							</div>
							{canWrite ? (
								<Space wrap>
									<Button
										type="primary"
										icon={<PlayCircleOutlined />}
										loading={op === 'start'}
										disabled={running || op !== null}
										onClick={() => void runOp('start')}
									>
										启动
									</Button>
									<Button
										icon={<ReloadOutlined />}
										loading={op === 'restart'}
										disabled={op !== null}
										onClick={() => void runOp('restart')}
									>
										重启
									</Button>
									<Button
										danger
										icon={<StopOutlined />}
										loading={op === 'stop'}
										disabled={!running || op !== null}
										onClick={() => void runOp('stop')}
									>
										停止
									</Button>
								</Space>
							) : null}
						</div>

						<div className="ibr-console-dash-divider" />

						<Typography.Text type="secondary" className="ibr-console-dash-health-caption">
							服务地址
						</Typography.Text>
						<div className="ibr-console-dash-health-list">
							{healthItems.map((it) => (
								<div key={it.key} className="ibr-console-dash-health-row">
									<div className="ibr-console-dash-health-left">
										<span
											className={`ibr-console-dash-health-dot${
												it.neutral ? ' is-neutral' : it.ok ? ' is-ok' : ' is-warn'
											}`}
										/>
										<div className="ibr-console-dash-health-text">
											<span className="ibr-console-dash-strong">{it.label}</span>
											<span className="ibr-console-dash-muted ibr-console-dash-mono ibr-console-dash-health-addr">
												{it.address}
											</span>
										</div>
									</div>
									<span className="ibr-console-dash-muted ibr-console-dash-mono">{it.value}</span>
								</div>
							))}
						</div>

						{opError ? (
							<Typography.Paragraph type="danger" className="ibr-console-ops-error">
								{opError}
							</Typography.Paragraph>
						) : null}
						{status?.cli_ok || !status?.cli_error ? null : (
							<Typography.Paragraph type="secondary" className="ibr-console-ops-hint">
								{status.cli_error}
							</Typography.Paragraph>
						)}
					</div>
				)}
			</div>

			{loading && !status ? null : (
				<>
					<div className="ibr-console-ops-section">
						<div className="ibr-console-ops-section-head">
							<Typography.Text className="ibr-console-ops-section-title">网卡监控</Typography.Text>
							<Space size={6}>
								<Tag color={status?.nics_initialized ? 'green' : 'orange'}>
									{status?.nics_initialized ? '初始化已完成' : '初始化未完成'}
								</Tag>
								<Tag color={status?.net_init_ok ? 'green' : 'default'}>
									{status?.net_init_ok ? '接管正常' : '接管未就绪'}
								</Tag>
							</Space>
						</div>
						<div className="ibr-console-ops-card">
							<div
								className="ibr-console-dash-nic-grid"
								style={{ gridTemplateColumns: `repeat(${nicCols}, minmax(0, 1fr))` }}
							>
								{netItems.map((it) => {
									const v = it.v;
									const isVpp = v?.source === 'vpp';
									const ip = v?.ip || '—';
									const rate = v?.rate || '—';
									const name = v?.name || '—';
									const gw = v?.gateway || '';
									const link = v?.link;
									const gradeShow =
										(link?.speed_grade && link.speed_grade !== 'unknown' ? link.speed_grade : '') ||
										(rate && rate !== '—' ? rate : '') ||
										'unknown';
									const driverLine = linkDriverOnly(link);
									const snapText = formatNicSnapshotLine({
										pci: v?.pci,
										isVpp: Boolean(isVpp),
										roles: status?.nic_roles?.roles,
										link,
										rate,
									});
									return (
										<div key={it.key} className="ibr-console-dash-nic-item">
											<div className="ibr-console-dash-nic-head">
												<span className="ibr-console-dash-strong">{it.title}</span>
												<Space size={6} wrap>
													<Tag color={isVpp ? 'green' : 'default'}>{isVpp ? 'vBras' : 'OS'}</Tag>
													<Tag color={linkGradeTagColor(gradeShow)}>
														{gradeShow === 'unknown' ? '未知' : gradeShow}
													</Tag>
												</Space>
											</div>
											<div className="ibr-console-dash-nic-row">
												<span className="ibr-console-dash-mono">{ip}</span>
												<span className="ibr-console-dash-mono">
													{typeof link?.speed_mbps === 'number' && link.speed_mbps > 0
														? `${link.speed_mbps} Mb/s`
														: rate !== '—'
															? rate
															: ''}
												</span>
											</div>
											<div className="ibr-console-dash-nic-row">
												<span className="ibr-console-dash-mono">{name}</span>
												{gw ? <span className="ibr-console-dash-mono">GW {gw}</span> : <span />}
											</div>
											{snapText ? <p className="ibr-console-dash-mono ibr-console-dash-nic-meta">{snapText}</p> : null}
											{driverLine ? (
												<p className="ibr-console-dash-mono ibr-console-dash-nic-meta">{driverLine}</p>
											) : null}
										</div>
									);
								})}
							</div>
							{status?.nics_initialized ? null : (
								<Button type="link" size="small" style={{ padding: 0, marginTop: 12 }} onClick={() => onGoPanel('ops-nic-init')}>
									去初始化网卡
								</Button>
							)}
						</div>
					</div>

					<div className="ibr-console-ops-section">
						<div className="ibr-console-ops-section-head">
							<Typography.Text className="ibr-console-ops-section-title">系统信息</Typography.Text>
						</div>
						<div className="ibr-console-ops-card ibr-console-dash-desc-card">
							<Descriptions size="small" column={desktop ? 4 : 2} className="ibr-console-dash-desc">
								<Descriptions.Item label="操作系统">{fmtMaybe(status?.os_name)}</Descriptions.Item>
								<Descriptions.Item label="Kernel">{fmtMaybe(status?.system_info?.kernel)}</Descriptions.Item>
								<Descriptions.Item label="Node">{fmtMaybe(status?.system_info?.node)}</Descriptions.Item>
								<Descriptions.Item label="平台">
									{status?.system_info
										? `${status.system_info.platform} / ${status.system_info.arch}`
										: '—'}
								</Descriptions.Item>
							</Descriptions>
						</div>
					</div>

					<div className="ibr-console-ops-section">
						<div className="ibr-console-ops-section-head">
							<Typography.Text className="ibr-console-ops-section-title">资源使用</Typography.Text>
						</div>
						<div className="ibr-console-ops-card">
							<div
								className="ibr-console-dash-metric-grid"
								style={{ gridTemplateColumns: `repeat(${metricCols}, minmax(0, 1fr))` }}
							>
								<MetricGauge title="CPU" percent={cpu} format={() => `${cpu}%`} size={gaugeSize} />
								<MetricGauge title="内存" percent={mem} format={() => `${mem}%`} size={gaugeSize} />
								<MetricGauge title="磁盘" percent={disk} format={() => `${disk}%`} size={gaugeSize} />
								<div className="ibr-console-dash-metric-item ibr-console-dash-load-item">
									<div className="ibr-console-dash-load-block">
										<div className="ibr-console-dash-muted">Load Average</div>
										<div className="ibr-console-dash-load-list">
											{(
												[
													['1m', stats?.load_1],
													['5m', stats?.load_5],
													['15m', stats?.load_15],
												] as const
											).map(([label, raw]) => (
												<div key={label} className="ibr-console-dash-load-row">
													<div className="ibr-console-dash-load-row-head">
														<span className="ibr-console-dash-muted">{label}</span>
														<span className="ibr-console-dash-strong ibr-console-dash-mono">{fmtLoad(raw)}</span>
													</div>
													<Progress
														percent={loadToPercent(raw)}
														showInfo={false}
														strokeColor={CHART_COLOR}
														strokeLinecap="round"
														trailColor={CHART_TRAIL}
														size="small"
													/>
												</div>
											))}
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>

					<div className="ibr-console-ops-section">
						<div className="ibr-console-ops-section-head">
							<Typography.Text className="ibr-console-ops-section-title">VBRAS 进程</Typography.Text>
						</div>
						<div className="ibr-console-ops-card ibr-console-dash-desc-card">
							{status?.vbras_process ? (
								<Descriptions size="small" column={1} className="ibr-console-dash-desc">
									<Descriptions.Item label="Service">{fmtMaybe(status.vbras_process.service)}</Descriptions.Item>
									<Descriptions.Item label="Active">{fmtMaybe(status.vbras_process.active_state)}</Descriptions.Item>
									<Descriptions.Item label="PID">{fmtMaybe(status.vbras_process.main_pid)}</Descriptions.Item>
									<Descriptions.Item label="Tasks">{fmtMaybe(status.vbras_process.tasks)}</Descriptions.Item>
									<Descriptions.Item label="Memory">{fmtMaybe(status.vbras_process.memory)}</Descriptions.Item>
								</Descriptions>
							) : (
								<span className="ibr-console-dash-muted">暂无进程信息</span>
							)}
						</div>
					</div>

					<div className="ibr-console-ops-section">
						<div className="ibr-console-ops-section-head">
							<Typography.Text className="ibr-console-ops-section-title">Agent / 云下发</Typography.Text>
							<Button type="link" size="small" onClick={() => onGoDeviceInfoTab('agent')}>
								查看详情
							</Button>
						</div>
						<div className="ibr-console-ops-card ibr-console-dash-desc-card">
							<Descriptions size="small" column={1} className="ibr-console-dash-desc">
								<Descriptions.Item label="注册完成">
									{agentSummary?.registration_finish ? <Tag color="green">是</Tag> : <Tag>否 / 未知</Tag>}
								</Descriptions.Item>
								<Descriptions.Item label="Download 包">
									{(agentSummary?.download_files?.length ?? 0) > 0
										? `${agentSummary!.download_files!.length} 个`
										: '无'}
								</Descriptions.Item>
								<Descriptions.Item label="NetJSON 模块">
									{(() => {
										const keys =
											agentSummary?.netjson && typeof agentSummary.netjson === 'object'
												? Object.keys(agentSummary.netjson as object)
												: agentSummary?.netjson_keys;
										return keys?.length ? keys.join(', ') : '—';
									})()}
								</Descriptions.Item>
							</Descriptions>
						</div>
					</div>
				</>
			)}
		</div>
	);
};
