import { CloudUploadOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, App as AntApp, Button, Descriptions, Grid, Progress, Space, Spin, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';
import { formatNicSnapshotLine } from '../config/nicRoleResolve';

type NetLink = {
	speed_mbps?: number | null;
	speed_grade?: string;
	duplex?: string;
	mtu?: number | null;
	carrier?: boolean | null;
	driver?: string;
};

type NetEntry = {
	role: 'mgmt' | 'wan' | 'lan';
	attached: boolean;
	source: 'os' | 'vpp';
	name: string;
	ip: string;
	gateway?: string | null;
	rate?: string;
	display?: string;
	link?: NetLink;
	/** 与 nic_roles 快照一致 */
	pci?: string;
	os_ifname?: string | null;
};

type StatusResp = {
	init_mode?: 'static' | 'dhcp';
	vr_name?: string;
	vbras_running?: boolean;
	vbras_process?: { service?: string; active_state?: string; main_pid?: string; tasks?: string; memory?: string } | null;
	system_info?: { hostname: string; platform: string; arch: string; kernel: string; node: string };
	os_name?: string;
	stats?: { cpu: number; cpu_count?: number; mem: number; disk: number; uptime: string; load_1: number; load_5: number; load_15: number };
	net_overview?: { mgmt?: NetEntry; wan?: NetEntry; lan?: NetEntry };
	net_init_ok?: boolean;
	init_mode?: 'static' | 'dhcp';
	nics_initialized?: boolean;
	nic_roles?: { roles?: Array<{ pci?: string; os?: { speed_grade?: string; speed_mbps?: number | null }; vbras?: { speed_grade?: string; speed_mbps?: number | null } }> } | null;
	version?: string;
	cli_ok?: boolean;
	cli_error?: string | null;
	/** 与请求一致的链路 ID（响应头 `x-request-id` 同步） */
	trace_id?: string;
	/** 部分子系统失败时列出代号，如 `vbras_cli`、`system_stats` */
	degraded?: string[];
	sdnc_console_base?: string | null;
	sdnc_csmctl_address?: string | null;
	compute_tower_base?: string | null;
	ai_soc_base?: string | null;
	/** @deprecated 与 compute_tower_base 相同 */
	tower_base?: string | null;
	/** @deprecated 与 sdnc_csmctl_address 相同 */
	sdwan_manageip?: string | null;
	/** 与「配置服务」中各上游地址对应的 HTTP 可达性 */
	service_reachability?: {
		pending?: boolean;
		sdnc_console?: boolean | null;
		sdnc_csmctl?: boolean | null;
		compute_tower?: boolean | null;
		aisoc?: boolean | null;
		/** @deprecated */
		tower?: boolean | null;
		/** @deprecated */
		sdwan?: boolean | null;
		checked_at?: number;
	};
};

type AgentSummary = {
	registration_finish?: boolean;
	download_files?: string[];
	netjson?: Record<string, unknown> | null;
};

function clampPercent(n: unknown) {
	const v = Number(n);
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, Math.min(100, v));
}

function fmtMaybe(s: unknown) {
	const v = String(s ?? '').trim();
	return v ? v : '-';
}

function fmtTime(ts: number | null) {
	if (!ts) return '-';
	try {
		return new Date(ts).toLocaleString();
	} catch {
		return '-';
	}
}

/** 资源使用：统一纯色蓝 + 圆头 */
const CHART_COLOR = '#1677ff';
const CHART_TRAIL = '#e6f4ff';

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

function linkDriverOnly(link: NetLink | undefined): string {
	const d = link?.driver != null ? String(link.driver).trim() : '';
	return d;
}

/** 仪表板展示用：host:port，与「配置服务」表单一致 */
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

export function HomePage() {
	const navigate = useNavigate();
	const { message } = AntApp.useApp();
	const screens = Grid.useBreakpoint();
	const desktop = Boolean(screens.md);
	const nicCols = screens.sm ? (desktop ? 3 : 2) : 1;
	const metricCols = desktop ? 4 : 2;

	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<StatusResp | null>(null);
	const [agentSummary, setAgentSummary] = useState<AgentSummary | null>(null);
	const [lastUpdated, setLastUpdated] = useState<number | null>(null);
	const [op, setOp] = useState<null | 'start' | 'stop' | 'restart'>(null);
	const [opError, setOpError] = useState<string | null>(null);
	const [reporting, setReporting] = useState(false);
	const mountedRef = useRef(true);

	const reportManagementIp = useCallback(async () => {
		setReporting(true);
		try {
			const { data } = await api.post<{ ok?: boolean; management_ip?: string; error?: string }>(
				'/sys/sdnc/report-management-ip',
				{},
			);
			if (!data?.ok) {
				message.error(data?.error || '上报失败');
				return;
			}
			message.success(`管理口地址已上报到 SDN Console：${data.management_ip ?? ''}`);
		} catch (e) {
			const err = e as { response?: { data?: { error?: string } }; message?: string };
			message.error(err?.response?.data?.error || err?.message || '上报失败');
		} finally {
			if (mountedRef.current) setReporting(false);
		}
	}, [message]);

	const refresh = useCallback(
		async (opts?: { silent?: boolean }) => {
			const silent = Boolean(opts?.silent);
			if (!silent) setLoading(true);
			else setRefreshing(true);
			setError(null);
			try {
				const [statusRes, agentRes] = await Promise.allSettled([
					api.get<StatusResp>('/status'),
					api.get<AgentSummary>('/forwarding/agent/status'),
				]);
				if (mountedRef.current) {
					if (statusRes.status === 'fulfilled') {
						setStatus(statusRes.value.data);
						setLastUpdated(Date.now());
					} else {
						setError(statusRes.reason instanceof Error ? statusRes.reason.message : '请求失败');
					}
					if (agentRes.status === 'fulfilled') setAgentSummary(agentRes.value.data);
				}
			} catch (e) {
				if (mountedRef.current) {
					setError(e instanceof Error ? e.message : '请求失败');
				}
			} finally {
				if (mountedRef.current) {
					if (!silent) setLoading(false);
					setRefreshing(false);
				}
			}
		},
		[],
	);

	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	useEffect(() => {
		refreshRef.current = refresh;
	}, [refresh]);

	const runOp = useCallback(
		async (kind: 'start' | 'stop' | 'restart') => {
			setOp(kind);
			setOpError(null);
			try {
				await api.post(`/${kind}`);
				await refresh({ silent: true });
			} catch (e) {
				setOpError(e instanceof Error ? e.message : '操作失败');
			} finally {
				setOp(null);
			}
		},
		[refresh],
	);

	useEffect(() => {
		mountedRef.current = true;
		refresh({ silent: false }).catch(() => {});
		const tick = () => {
			if (document.visibilityState !== 'visible') return;
			refreshRef.current({ silent: true }).catch(() => {});
		};
		const t = window.setInterval(tick, 5000);
		const onVis = () => {
			if (document.visibilityState === 'visible') refreshRef.current({ silent: true }).catch(() => {});
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
		if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
		return n.toFixed(2);
	};

	const gaugeSize = useMemo(() => (desktop ? 128 : 96), [desktop]);

	const MetricGauge = ({
		title,
		percent,
		format,
	}: {
		title: string;
		percent: number;
		format: () => string;
	}) => {
		return (
			<div className="app-dash-metric-item app-dash-gauge-item app-dash-chart">
				<Progress
					type="dashboard"
					percent={percent}
					size={gaugeSize}
					strokeColor={CHART_COLOR}
					strokeLinecap="round"
					trailColor={CHART_TRAIL}
					format={() => (
						<div className="app-dash-gauge-format">
							<div className="app-ui-muted">{title}</div>
							<div className="app-ui-strong app-ui-mono">{format()}</div>
						</div>
					)}
				/>
			</div>
		);
	};

	const netItems = useMemo(() => {
		const ov = status?.net_overview ?? {};
		const dhcp = status?.init_mode === 'dhcp';
		const rows: { key: string; title: string; v?: NetEntry }[] = [
			{ key: 'mgmt', title: dhcp ? '管理口（同WAN）' : '管理口', v: ov.mgmt },
			{ key: 'wan', title: 'WAN口', v: ov.wan },
			{ key: 'lan', title: 'LAN口', v: ov.lan },
		];
		return rows;
	}, [status?.net_overview, status?.init_mode]);

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

	return (
		<PageStack className="app-dashboard">
			<div className="app-dashboard-header">
				<PageHeader title="仪表板" description="查看设备运行状态、网卡与服务健康状况。" />
				<div className="app-dashboard-header-actions">
					<span className="app-ui-muted app-dashboard-updated">
						最后更新：{fmtTime(lastUpdated)}
						{refreshing ? '（更新中…）' : ''}
					</span>
					<Space wrap>
						{status?.nics_initialized ? null : (
							<Button type="primary" onClick={() => navigate('/init')}>
								去初始化向导
							</Button>
						)}
						<Button icon={<CloudUploadOutlined />} onClick={() => void reportManagementIp()} loading={reporting}>
							上报管理地址
						</Button>
						<Button onClick={() => refresh({ silent: false })} loading={loading || refreshing}>
							刷新
						</Button>
					</Space>
				</div>
			</div>

			{error ? (
				<Alert
					type="error"
					showIcon
					message="状态获取失败"
					description={<Typography.Text type="danger">{error}</Typography.Text>}
					action={
						<Button size="small" onClick={() => refresh({ silent: false })}>
							重试
						</Button>
					}
					style={{ marginBottom: 16 }}
				/>
			) : null}

			{!error && status?.degraded && status.degraded.length > 0 ? (
				<Alert
					type="warning"
					showIcon
					message="部分状态来源不可用"
					description={
						<span>
							<Typography.Text type="secondary">子系统：{status.degraded.join('、')}</Typography.Text>
							{status.trace_id ? (
								<>
									<br />
									<Typography.Text type="secondary" copyable>
										trace_id：{status.trace_id}
									</Typography.Text>
								</>
							) : null}
						</span>
					}
					style={{ marginBottom: 0 }}
				/>
			) : null}

			{loading && !status ? (
				<ContentBlock>
					<Card variant="padded">
						<div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
							<Spin tip="加载中…" />
						</div>
					</Card>
				</ContentBlock>
			) : (
				<>
					<ContentBlock>
							<BlockHeader title="运行控制" />
							<Card variant="padded">
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
								<div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 260 }}>
									<div className={`app-dash-run-icon${running ? ' app-dash-run-icon--on' : ''}`}>
										{running ? <PlayCircleOutlined style={{ fontSize: 20 }} /> : <StopOutlined style={{ fontSize: 18 }} />}
									</div>
									<div style={{ minWidth: 0 }}>
										<div className={`app-ui-strong${running ? ' app-dash-run-title--on' : ' app-dash-run-title--off'}`}>
											{running ? '运行中' : '未运行'}
										</div>
										<div className="app-ui-muted" style={{ marginTop: 4 }}>
											运行时长 <span className="app-ui-strong app-ui-mono">{fmtMaybe(stats?.uptime)}</span>
										</div>
									</div>
								</div>

								<div style={{ display: 'flex', gap: 8 }}>
									<Button
										type="primary"
										icon={<PlayCircleOutlined />}
										loading={op === 'start'}
										disabled={running || op !== null}
										onClick={() => runOp('start')}
									>
										启动
									</Button>
									<Button
										icon={<ReloadOutlined />}
										loading={op === 'restart'}
										disabled={op !== null}
										onClick={() => runOp('restart')}
									>
										重启
									</Button>
									<Button
										danger
										icon={<StopOutlined />}
										loading={op === 'stop'}
										disabled={!running || op !== null}
										onClick={() => runOp('stop')}
									>
										停止
									</Button>
								</div>
							</div>

							<div className="app-dash-divider" />

							<div className="app-ui-muted" style={{ marginBottom: 8, fontSize: 13 }}>
								服务地址
							</div>
							<div style={{ display: 'grid', gap: 10 }}>
								{healthItems.map((it) => (
									<div key={it.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
										<div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, flex: 1 }}>
											<div
												className={`app-dash-health-dot${
													it.neutral ? ' app-dash-health-dot--neutral' : it.ok ? ' app-dash-health-dot--ok' : ' app-dash-health-dot--warn'
												}`}
												style={{ marginTop: 6 }}
											/>
											<div style={{ minWidth: 0 }}>
												<div className="app-ui-strong">{it.label}</div>
												<div className="app-ui-muted app-ui-mono" style={{ marginTop: 2, wordBreak: 'break-all' }}>
													{it.address}
												</div>
											</div>
										</div>
										<span className="app-ui-muted app-ui-mono" style={{ flexShrink: 0 }}>
											{it.value}
										</span>
									</div>
								))}
							</div>

							{opError ? (
								<Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
									{opError}
								</Typography.Paragraph>
							) : null}

							{status?.cli_ok || !status?.cli_error ? null : (
								<Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
									{status.cli_error}
								</Typography.Paragraph>
							)}
							</Card>
						</ContentBlock>

						<ContentBlock>
							<BlockHeader title="网卡监控" />
							<Card
								variant="padded"
								footer={
									<div className="app-dash-init-status">
										<div>
											<span className="app-ui-muted">初始化状态</span>
											{status?.nics_initialized ? null : (
												<div style={{ marginTop: 6 }}>
													<Button size="small" type="link" style={{ padding: 0 }} onClick={() => navigate('/init')}>
														去初始化
													</Button>
												</div>
											)}
										</div>
										<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
											<Tag color={status?.nics_initialized ? 'green' : 'orange'} style={{ marginInlineEnd: 0 }}>
												{status?.nics_initialized ? '已完成' : '未完成'}
											</Tag>
											<Tag color={status?.net_init_ok ? 'green' : 'default'} style={{ marginInlineEnd: 0 }}>
												{status?.net_init_ok ? '接管正常' : '接管未就绪'}
											</Tag>
										</div>
									</div>
								}
							>
							<div
								className="app-dash-nic-grid"
								style={{ gridTemplateColumns: `repeat(${nicCols}, minmax(0, 1fr))` }}
							>
									{netItems.map((it) => {
										const v = it.v;
										const isVpp = v?.source === 'vpp';
										const title = it.title;
										const ip = v?.ip || '-';
										const rate = v?.rate || '-';
										const name = v?.name || '-';
										const gw = v?.gateway || '';
										const link = v?.link;
										const gradeShow =
											(link?.speed_grade && link.speed_grade !== 'unknown' ? link.speed_grade : '') ||
											(rate && rate !== '-' ? rate : '') ||
											'unknown';
										const driverLine = linkDriverOnly(link);
										const snapText = formatNicSnapshotLine({
											pci: v?.pci,
											isVpp,
											roles: status?.nic_roles?.roles,
											link,
											rate,
										});
										return (
											<div key={it.key} className="app-dash-nic-item">
												<div className="app-dash-nic-head">
													<span className="app-ui-strong">{title}</span>
													<Space size={6} wrap>
														<Tag color={isVpp ? 'green' : 'default'} style={{ marginInlineEnd: 0 }}>
															{isVpp ? 'vBras' : 'OS'}
														</Tag>
														<Tag color={linkGradeTagColor(gradeShow)} style={{ marginInlineEnd: 0 }}>
															{gradeShow === 'unknown' ? '未知' : gradeShow}
														</Tag>
													</Space>
												</div>

												<div className="app-dash-nic-row">
													<span className="app-ui-sm-strong app-ui-mono">{ip}</span>
													<span className="app-ui-sm app-ui-mono">
														{typeof link?.speed_mbps === 'number' && link.speed_mbps > 0
															? `${link.speed_mbps} Mb/s`
															: rate !== '-'
																? rate
																: ''}
													</span>
												</div>

												<div className="app-dash-nic-row">
													<span className="app-ui-sm app-ui-mono">{name}</span>
													{gw ? <span className="app-ui-sm app-ui-mono">GW {gw}</span> : <span />}
												</div>

												{snapText ? <p className="app-ui-sm app-ui-mono" style={{ margin: 0 }}>{snapText}</p> : null}

												{driverLine ? <p className="app-ui-sm app-ui-mono" style={{ margin: 0 }}>{driverLine}</p> : null}
											</div>
										);
									})}
							</div>
							</Card>
						</ContentBlock>

						<ContentBlock>
							<BlockHeader title="系统信息" />
							<Card variant="padded">
							<Descriptions size="small" column={desktop ? 4 : 2}>
								<Descriptions.Item label="操作系统">{fmtMaybe(status?.os_name)}</Descriptions.Item>
								<Descriptions.Item label="Kernel">{fmtMaybe(status?.system_info?.kernel)}</Descriptions.Item>
								<Descriptions.Item label="Node">{fmtMaybe(status?.system_info?.node)}</Descriptions.Item>
								<Descriptions.Item label="平台">
									{status?.system_info ? `${status.system_info.platform} / ${status.system_info.arch}` : '-'}
								</Descriptions.Item>
							</Descriptions>
							</Card>
						</ContentBlock>

					<ContentBlock>
						<BlockHeader title="资源使用" />
							<Card variant="padded">
							<div
								className="app-dash-metric-grid"
								style={{ gridTemplateColumns: `repeat(${metricCols}, minmax(0, 1fr))` }}
							>
								<MetricGauge title="CPU" percent={cpu} format={() => `${cpu}%`} />
								<MetricGauge title="内存" percent={mem} format={() => `${mem}%`} />
								<MetricGauge title="磁盘" percent={disk} format={() => `${disk}%`} />
								<div className="app-dash-metric-item app-dash-load-item">
									<div className="app-dash-load-block">
										<div className="app-ui-muted">Load Average</div>
										<div className="app-dash-load-list">
											{(
												[
													['1m', stats?.load_1],
													['5m', stats?.load_5],
													['15m', stats?.load_15],
												] as const
											).map(([label, raw]) => (
												<div key={label} className="app-dash-load-row">
													<div className="app-dash-load-row-head">
														<span className="app-ui-muted">{label}</span>
														<span className="app-ui-strong app-ui-mono">{fmtLoad(raw)}</span>
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
							</Card>
						</ContentBlock>

						<ContentBlock>
							<BlockHeader title="VBRAS 进程" />
							<Card variant="padded">
							{status?.vbras_process ? (
								<Descriptions size="small" column={1}>
									<Descriptions.Item label="Service">{fmtMaybe(status.vbras_process.service)}</Descriptions.Item>
									<Descriptions.Item label="Active">{fmtMaybe(status.vbras_process.active_state)}</Descriptions.Item>
									<Descriptions.Item label="PID">{fmtMaybe(status.vbras_process.main_pid)}</Descriptions.Item>
									<Descriptions.Item label="Tasks">{fmtMaybe(status.vbras_process.tasks)}</Descriptions.Item>
									<Descriptions.Item label="Memory">{fmtMaybe(status.vbras_process.memory)}</Descriptions.Item>
								</Descriptions>
							) : (
								<span className="app-ui-muted">暂无进程信息</span>
							)}
							</Card>
						</ContentBlock>

						<ContentBlock>
							<BlockHeader title="Agent / 云下发" />
							<Card variant="padded">
							<Descriptions size="small" column={1}>
								<Descriptions.Item label="注册完成">
									{agentSummary?.registration_finish ? (
										<Tag color="green">是</Tag>
									) : (
										<Tag>否 / 未知</Tag>
									)}
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
												? Object.keys(agentSummary.netjson)
												: (agentSummary as { netjson_keys?: string[] } | null)?.netjson_keys;
										return keys?.length ? keys.join(', ') : '—';
									})()}
								</Descriptions.Item>
							</Descriptions>
							<Button type="link" size="small" style={{ padding: 0, marginTop: 8 }} onClick={() => navigate('/ops/agent')}>
								查看详情
							</Button>
							</Card>
						</ContentBlock>
				</>
			)}
		</PageStack>
	);
}
