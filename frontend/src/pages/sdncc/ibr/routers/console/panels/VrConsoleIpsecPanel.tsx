import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
	Button,
	Form,
	Input,
	InputNumber,
	Modal,
	Space,
	Switch,
	Table,
	Tag,
	Typography,
	message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getApiErrorMessage } from '../../../../../../services/api';
import {
	applyIbrForwardingIpsecTunnel,
	connectIbrForwardingIpsec,
	deleteIbrForwardingIpsecTunnel,
	disconnectIbrForwardingIpsec,
	fetchIbrForwardingIpsecAutoreconnect,
	fetchIbrForwardingIpsecReconnectLogs,
	fetchIbrForwardingIpsecSas,
	fetchIbrForwardingIpsecTunnels,
	saveIbrForwardingIpsecAutoreconnect,
	type IbrForwardingIpsecChildSa,
	type IbrForwardingIpsecReconnectLogRow,
	type IbrForwardingIpsecSasConn,
	type IbrForwardingIpsecTunnelRow,
} from '../../../../../../services/ibrDeviceOpsApi';
import { useIbrConsoleWritePermission } from '../lib/useIbrConsoleWritePermission';
import {
	ConsoleForwardTable,
	FORWARD_TABLE_PAGE_SIZE,
	ConsoleOpsDrawer,
	ConsoleOpsModal,
	ForwardTableFooter,
	ForwardTextDrawer,
	forwardTableEmpty,
	useForwardTablePage,
} from '../lib/forwardPanelUi';
import { IbrConsoleSegmented } from '../components/IbrConsoleSegmented';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

/** 设备 IPsec（ibr-local-web 同源）；勿用 fetchIPsecVPNsMerged / /api/networks/ipsec */

type Props = {
	vrUuid: string;
	managementIp: string;
};

type IpsecTab = 'sa' | 'config' | 'guard';

const IPSEC_TABS: { id: IpsecTab; label: string }[] = [
	{ id: 'sa', label: 'SA 状态' },
	{ id: 'config', label: '隧道配置' },
	{ id: 'guard', label: '守卫' },
];

function statusColor(status: string) {
	const s = String(status || '').toUpperCase();
	if (s === 'ESTABLISHED') return 'green';
	if (s === 'REKEYING') return 'processing';
	if (s === 'CONNECTING') return 'orange';
	if (s === 'DISCONNECTED') return 'red';
	return 'default';
}

function tunnelSourceTag(source?: string) {
	const color = source === 'cloud' ? 'blue' : source === 'both' ? 'purple' : 'default';
	const label = source === 'cloud' ? '云平台' : source === 'both' ? '云+本地' : '本地';
	return <Tag color={color}>{label}</Tag>;
}

function formatTrafficCount(n: number | undefined) {
	if (n == null || !Number.isFinite(n)) return '—';
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
	if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	return `${(n / 1_000_000_000).toFixed(2)}G`;
}

function sumChildSaTraffic(children: IbrForwardingIpsecChildSa[] | undefined) {
	return (children || []).reduce(
		(acc, c) => ({
			inBytes: acc.inBytes + (Number(c.in_bytes) || 0),
			inPackets: acc.inPackets + (Number(c.in_packets) || 0),
			outBytes: acc.outBytes + (Number(c.out_bytes) || 0),
			outPackets: acc.outPackets + (Number(c.out_packets) || 0),
		}),
		{ inBytes: 0, inPackets: 0, outBytes: 0, outPackets: 0 },
	);
}

export const VrConsoleIpsecPanel: React.FC<Props> = ({ vrUuid, managementIp }) => {
	const canWrite = useIbrConsoleWritePermission('networks.ipsec:write');

	const [tab, setTab] = useState<IpsecTab>('sa');

	const [saLoading, setSaLoading] = useState(false);
	const [saRows, setSaRows] = useState<IbrForwardingIpsecSasConn[]>([]);
	const [saRaw, setSaRaw] = useState('');
	const [saRawOpen, setSaRawOpen] = useState(false);
	const [actionId, setActionId] = useState('');

	const [cfgLoading, setCfgLoading] = useState(false);
	const [tunnels, setTunnels] = useState<IbrForwardingIpsecTunnelRow[]>([]);
	const [cfgModalOpen, setCfgModalOpen] = useState(false);
	const [editingTunnel, setEditingTunnel] = useState<IbrForwardingIpsecTunnelRow | null>(null);
	const [cfgSubmitting, setCfgSubmitting] = useState(false);
	const [cfgForm] = Form.useForm();

	const [guardLogs, setGuardLogs] = useState<IbrForwardingIpsecReconnectLogRow[]>([]);
	const [guardDrawerOpen, setGuardDrawerOpen] = useState(false);
	const [guardForm] = Form.useForm();

	const loadGenRef = useRef(0);

	const loadSa = useCallback(async () => {
		const gen = ++loadGenRef.current;
		const reqUuid = vrUuid;
		setSaLoading(true);
		try {
			const data = await fetchIbrForwardingIpsecSas(reqUuid, { skipCache: true });
			if (gen !== loadGenRef.current || reqUuid !== vrUuid) return;
			if (data.error) throw new Error(data.error);
			setSaRows(Array.isArray(data.sas) ? data.sas : []);
			setSaRaw(String(data.raw ?? ''));
		} catch (e) {
			if (gen !== loadGenRef.current) return;
			message.error(getApiErrorMessage(e, '加载 IPsec SA 失败'));
			setSaRows([]);
			setSaRaw('');
		} finally {
			if (gen === loadGenRef.current) setSaLoading(false);
		}
	}, [vrUuid]);

	const loadTunnels = useCallback(async () => {
		const gen = ++loadGenRef.current;
		const reqUuid = vrUuid;
		setCfgLoading(true);
		try {
			const data = await fetchIbrForwardingIpsecTunnels(reqUuid, { skipCache: true });
			if (gen !== loadGenRef.current || reqUuid !== vrUuid) return;
			if (data.error) throw new Error(data.error);
			setTunnels(Array.isArray(data.tunnels) ? data.tunnels : []);
		} catch (e) {
			if (gen !== loadGenRef.current) return;
			message.error(getApiErrorMessage(e, '加载隧道配置失败'));
			setTunnels([]);
		} finally {
			if (gen === loadGenRef.current) setCfgLoading(false);
		}
	}, [vrUuid]);

	const loadGuardLogs = useCallback(async () => {
		const gen = ++loadGenRef.current;
		const reqUuid = vrUuid;
		try {
			const data = await fetchIbrForwardingIpsecReconnectLogs(reqUuid, { skipCache: true });
			if (gen !== loadGenRef.current || reqUuid !== vrUuid) return;
			setGuardLogs(Array.isArray(data.logs) ? data.logs : []);
		} catch (e) {
			if (gen !== loadGenRef.current) return;
			message.error(getApiErrorMessage(e, '加载守卫日志失败'));
			setGuardLogs([]);
		}
	}, [vrUuid]);

	const loadGuardCfg = useCallback(async () => {
		const gen = ++loadGenRef.current;
		const reqUuid = vrUuid;
		try {
			const data = await fetchIbrForwardingIpsecAutoreconnect(reqUuid, { skipCache: true });
			if (gen !== loadGenRef.current || reqUuid !== vrUuid) return;
			guardForm.setFieldsValue(data);
		} catch (e) {
			if (gen !== loadGenRef.current) return;
			message.error(getApiErrorMessage(e, '加载守卫配置失败'));
		}
	}, [guardForm, vrUuid]);

	useEffect(() => {
		if (tab === 'sa') void loadSa();
		if (tab === 'config') void loadTunnels();
		if (tab === 'guard') void loadGuardLogs();
	}, [tab, loadSa, loadTunnels, loadGuardLogs]);

	useEffect(() => {
		if (tab !== 'guard') return;
		const t = setInterval(() => void loadGuardLogs(), 8000);
		return () => clearInterval(t);
	}, [tab, loadGuardLogs]);

	const {
		page: saPage,
		setPage: setSaPage,
		pageData: saPageData,
		total: saTotal,
		pageSize: saPageSize,
	} = useForwardTablePage(saRows, FORWARD_TABLE_PAGE_SIZE);

	const {
		page: cfgPage,
		setPage: setCfgPage,
		pageData: cfgPageData,
		total: cfgTotal,
		pageSize: cfgPageSize,
	} = useForwardTablePage(tunnels, FORWARD_TABLE_PAGE_SIZE);

	const {
		page: guardPage,
		setPage: setGuardPage,
		pageData: guardPageData,
		total: guardTotal,
		pageSize: guardPageSize,
	} = useForwardTablePage(guardLogs, FORWARD_TABLE_PAGE_SIZE);

	const handleConnect = useCallback(
		async (row: IbrForwardingIpsecSasConn) => {
			setActionId(row.name);
			try {
				const data = await connectIbrForwardingIpsec(vrUuid, { ipsec_id: row.name });
				if (data.error) throw new Error(data.error);
				message.success('已发起连接');
				await loadSa();
			} catch (e) {
				message.error(getApiErrorMessage(e, '连接失败'));
			} finally {
				setActionId('');
			}
		},
		[loadSa, vrUuid],
	);

	const handleDisconnect = useCallback(
		async (row: IbrForwardingIpsecSasConn) => {
			setActionId(row.name);
			try {
				const data = await disconnectIbrForwardingIpsec(vrUuid, { ipsec_id: row.name });
				if (data.error) throw new Error(data.error);
				message.success('已断开');
				await loadSa();
			} catch (e) {
				message.error(getApiErrorMessage(e, '断开失败'));
			} finally {
				setActionId('');
			}
		},
		[loadSa, vrUuid],
	);

	const openCreateTunnel = useCallback(() => {
		setEditingTunnel(null);
		cfgForm.resetFields();
		cfgForm.setFieldsValue({ 'sa-initiate': true, ike_mode: 'main' });
		setCfgModalOpen(true);
	}, [cfgForm]);

	const openEditTunnel = useCallback(
		(row: IbrForwardingIpsecTunnelRow) => {
			setEditingTunnel(row);
			cfgForm.setFieldsValue({
				...row,
				remote_id: row.ike_proposal_remote?.remote_id,
				pre_shared_key: row.ike_proposal_remote?.pre_shared_key,
				'sa-initiate': row['sa-initiate'] === true || String(row['sa-initiate']) === 'true',
			});
			setCfgModalOpen(true);
		},
		[cfgForm],
	);

	const saveTunnel = async () => {
		try {
			const v = await cfgForm.validateFields();
			setCfgSubmitting(true);
			const body: IbrForwardingIpsecTunnelRow = {
				ID: String(v.ID).trim(),
				ike_local_ip: v.ike_local_ip?.trim(),
				ike_remote_ip: v.ike_remote_ip?.trim(),
				ike_dpd_delay: v.ike_dpd_delay,
				ike_dpd_timeout: v.ike_dpd_timeout,
				ike_mode: v.ike_mode?.trim(),
				ike_proposal_local: v.ike_proposal_local?.trim(),
				ike_proposal_remote:
					v.remote_id && v.pre_shared_key
						? { remote_id: String(v.remote_id).trim(), pre_shared_key: String(v.pre_shared_key).trim() }
						: undefined,
				traffic_selectors_local: v.traffic_selectors_local?.trim(),
				traffic_selectors_remote: v.traffic_selectors_remote?.trim(),
				vrf_id: v.vrf_id?.trim(),
				sa_dpd_action: v.sa_dpd_action?.trim(),
				sa_esp_proposals: v.sa_esp_proposals?.trim(),
				'sa-initiate': Boolean(v['sa-initiate']),
			};
			const data = await applyIbrForwardingIpsecTunnel(vrUuid, body);
			if (data.error) throw new Error(data.error);
			message.success(editingTunnel ? '已更新隧道配置' : '已创建隧道配置');
			setCfgModalOpen(false);
			await loadTunnels();
			if (tab === 'sa') await loadSa();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in (e as object)) return;
			message.error(getApiErrorMessage(e, '保存失败'));
		} finally {
			setCfgSubmitting(false);
		}
	};

	const saveGuard = async () => {
		try {
			const v = await guardForm.validateFields();
			const data = await saveIbrForwardingIpsecAutoreconnect(vrUuid, {
				enabled: v.enabled,
				reconnect_enabled: v.reconnect_enabled,
				interval: v.interval,
				max_retries: v.max_retries,
			});
			if ((data as { error?: string }).error) throw new Error((data as { error?: string }).error);
			message.success('守卫配置已保存');
			setGuardDrawerOpen(false);
			void loadGuardLogs();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in (e as object)) return;
			message.error(getApiErrorMessage(e, '保存失败'));
		}
	};

	const saColumns: ColumnsType<IbrForwardingIpsecSasConn> = useMemo(
		() => [
			{ title: '名称 / ID', dataIndex: 'name', key: 'name', fixed: 'left' },
			{
				title: '状态',
				dataIndex: 'status',
				key: 'status',
				render: (s: string) => <Tag color={statusColor(s)}>{s || '—'}</Tag>,
			},
			{
				title: '来源',
				dataIndex: 'source',
				key: 'source',
				render: (v?: string) => v || '本地',
			},
			{ title: '本端', dataIndex: 'local', key: 'local', ellipsis: true, render: (v?: string) => v || '—' },
			{ title: '对端', dataIndex: 'remote', key: 'remote', ellipsis: true, render: (v?: string) => v || '—' },
			{ title: '运行时间', dataIndex: 'uptime', key: 'uptime', render: (v?: string) => v || '—' },
			{
				title: '报文(入/出)',
				key: 'packets',
				render: (_: unknown, row) => {
					const t = sumChildSaTraffic(row.children);
					if (!row.children?.length) return '—';
					return `${formatTrafficCount(t.inPackets)}/${formatTrafficCount(t.outPackets)}`;
				},
			},
			{
				title: '字节(入/出)',
				key: 'bytes',
				render: (_: unknown, row) => {
					const t = sumChildSaTraffic(row.children);
					if (!row.children?.length) return '—';
					return `${formatTrafficCount(t.inBytes)}/${formatTrafficCount(t.outBytes)}`;
				},
			},
			{
				title: '操作',
				key: 'actions',
				fixed: 'right',
				render: (_: unknown, row) =>
					canWrite ? (
						<Space size={4} className="ibr-console-row-actions">
							<Button type="link" size="small" loading={actionId === row.name} onClick={() => void handleConnect(row)}>
								连接
							</Button>
							<Button
								type="link"
								size="small"
								danger
								loading={actionId === row.name}
								onClick={() => void handleDisconnect(row)}
							>
								断开
							</Button>
						</Space>
					) : null,
			},
		],
		[actionId, canWrite, handleConnect, handleDisconnect],
	);

	const cfgColumns: ColumnsType<IbrForwardingIpsecTunnelRow> = useMemo(
		() => [
			{ title: 'ID', dataIndex: 'ID', key: 'id', fixed: 'left' },
			{
				title: '来源',
				dataIndex: 'source',
				key: 'source',
				render: (s?: string) => tunnelSourceTag(s),
			},
			{ title: '本端 IKE', dataIndex: 'ike_local_ip', key: 'local', ellipsis: true },
			{ title: '对端 IKE', dataIndex: 'ike_remote_ip', key: 'remote', ellipsis: true },
			{ title: '本地 TS', dataIndex: 'traffic_selectors_local', key: 'tsl', ellipsis: true },
			{ title: '对端 TS', dataIndex: 'traffic_selectors_remote', key: 'tsr', ellipsis: true },
			{
				title: '操作',
				key: 'actions',
				fixed: 'right',
				render: (_: unknown, row) =>
					canWrite ? (
						<Space size={4} className="ibr-console-row-actions">
							<Button type="link" size="small" onClick={() => openEditTunnel(row)}>
								编辑
							</Button>
							<Button
								type="link"
								size="small"
								danger
								onClick={() => {
									Modal.confirm({
										title: '确认删除',
										content: `确定删除隧道「${row.ID}」？`,
										okButtonProps: { danger: true },
										onOk: async () => {
											const data = await deleteIbrForwardingIpsecTunnel(vrUuid, row.ID);
											if (data.error) throw new Error(data.error);
											message.success('已删除');
											await loadTunnels();
										},
									});
								}}
							>
								删除
							</Button>
						</Space>
					) : null,
			},
		],
		[canWrite, loadTunnels, openEditTunnel, vrUuid],
	);

	const guardColumns: ColumnsType<IbrForwardingIpsecReconnectLogRow> = useMemo(
		() => [
			{ title: '时间', dataIndex: 'time', key: 'time', fixed: 'left' },
			{ title: '隧道', dataIndex: 'tunnel_id', key: 'tunnel_id' },
			{ title: '动作', dataIndex: 'action', key: 'action' },
			{ title: '详情', dataIndex: 'detail', key: 'detail', ellipsis: true },
		],
		[],
	);

	if (!String(managementIp || '').trim()) {
		return <VrConsoleNoDevicePanel />;
	}

	const tabTitle = tab === 'sa' ? 'SA 状态' : tab === 'config' ? '隧道配置' : '守卫日志';

	return (
		<div className="ibr-console-ops-panel">
			<IbrConsoleSegmented
				tabs={IPSEC_TABS}
				activeTab={tab}
				onChange={setTab}
				ariaLabel="IPsec 视图"
			/>

			<div className="ibr-console-content-block">
				<div className="ibr-console-block-header">
					<h2 className="ibr-console-block-title">{tabTitle}</h2>
					<div className="ibr-console-block-action">
						{tab === 'sa' ? (
							<>
								<Button
									type="default"
									icon={<ReloadOutlined />}
									loading={saLoading}
									onClick={() => void loadSa()}
								>
									刷新 SA
								</Button>
								<Button type="default" onClick={() => setSaRawOpen(true)}>
									查看输出
								</Button>
							</>
						) : null}
						{tab === 'config' ? (
							<>
								<Button
									type="default"
									icon={<ReloadOutlined />}
									loading={cfgLoading}
									onClick={() => void loadTunnels()}
								>
									刷新
								</Button>
								{canWrite ? (
									<Button type="primary" icon={<PlusOutlined />} onClick={openCreateTunnel}>
										新建隧道
									</Button>
								) : null}
							</>
						) : null}
						{tab === 'guard' ? (
							<>
								<Button type="default" icon={<ReloadOutlined />} onClick={() => void loadGuardLogs()}>
									刷新日志
								</Button>
								{canWrite ? (
									<Button type="primary" onClick={() => setGuardDrawerOpen(true)}>
										守卫配置
									</Button>
								) : null}
							</>
						) : null}
					</div>
				</div>

				{tab === 'sa' ? (
					<>
						<div className="ibr-console-ops-card ibr-console-ops-card--table-pad">
							<div className="ibr-console-data-table-wrap">
								<ConsoleForwardTable<IbrForwardingIpsecSasConn>
									rowKey="name"
									loading={saLoading}
									columns={saColumns}
									dataSource={saPageData}
									scroll={{ x: true }}
									locale={{ emptyText: forwardTableEmpty('暂无 IPsec SA') }}
									expandable={{
										expandedRowRender: (row) => (
											<div style={{ padding: '4px 0 8px' }}>
												{row.children?.length ? (
													<Table<IbrForwardingIpsecChildSa>
														size="small"
														pagination={false}
														rowKey={(_, idx) => `${row.name}-child-${idx}`}
														dataSource={row.children}
														columns={[
															{ title: 'Child SA', dataIndex: 'name', key: 'name', render: (v: string) => v || '—' },
															{
																title: '报文(入/出)',
																key: 'pkts',
																render: (_: unknown, c) =>
																	`${formatTrafficCount(c.in_packets)}/${formatTrafficCount(c.out_packets)}`,
															},
															{
																title: '字节(入/出)',
																key: 'bytes',
																render: (_: unknown, c) =>
																	`${formatTrafficCount(c.in_bytes)}/${formatTrafficCount(c.out_bytes)}`,
															},
														]}
													/>
												) : null}
												{(row.raw_lines?.length ?? 0) > 0 ? (
													<pre className="app-code-block app-code-block-inset" style={{ marginTop: 8 }}>
														{(row.raw_lines ?? []).join('\n')}
													</pre>
												) : null}
											</div>
										),
										rowExpandable: (row) =>
											(row.children?.length ?? 0) > 0 || (row.raw_lines?.length ?? 0) > 0,
									}}
								/>
							</div>
						</div>
						<ForwardTableFooter total={saTotal} page={saPage} pageSize={saPageSize} onChange={setSaPage} />
					</>
				) : null}

				{tab === 'config' ? (
					<>
						<div className="ibr-console-ops-card ibr-console-ops-card--table-pad">
							<div className="ibr-console-data-table-wrap">
								<ConsoleForwardTable<IbrForwardingIpsecTunnelRow>
									rowKey="ID"
									loading={cfgLoading}
									columns={cfgColumns}
									dataSource={cfgPageData}
									scroll={{ x: true }}
									locale={{ emptyText: forwardTableEmpty('暂无隧道配置') }}
								/>
							</div>
						</div>
						<ForwardTableFooter total={cfgTotal} page={cfgPage} pageSize={cfgPageSize} onChange={setCfgPage} />
					</>
				) : null}

				{tab === 'guard' ? (
					<>
						<div className="ibr-console-ops-card ibr-console-ops-card--table-pad">
							<div className="ibr-console-data-table-wrap">
								<ConsoleForwardTable<IbrForwardingIpsecReconnectLogRow>
									rowKey={(r) => `${r.time}-${r.tunnel_id}-${r.action}-${r.detail}`}
									loading={false}
									columns={guardColumns}
									dataSource={guardPageData}
									scroll={{ x: true }}
									locale={{ emptyText: forwardTableEmpty('暂无守卫日志') }}
								/>
							</div>
						</div>
						<ForwardTableFooter
							total={guardTotal}
							page={guardPage}
							pageSize={guardPageSize}
							onChange={setGuardPage}
						/>
					</>
				) : null}
			</div>

			<ForwardTextDrawer
				title="原始输出 — ipsec_show_sas_list"
				open={saRawOpen}
				onClose={() => setSaRawOpen(false)}
				text={saRaw.trim() || '（暂无）'}
			/>

			<ConsoleOpsModal
				title={editingTunnel ? `编辑隧道 ${editingTunnel.ID}` : '新建 IPsec 隧道'}
				open={cfgModalOpen}
				onCancel={() => setCfgModalOpen(false)}
				onOk={() => void saveTunnel()}
				okButtonProps={{ loading: cfgSubmitting }}
				width={640}
				destroyOnClose
			>
				<Form form={cfgForm} layout="vertical">
					<Form.Item label="隧道 ID" name="ID" rules={[{ required: true, message: '必填' }]}>
						<Input disabled={Boolean(editingTunnel)} placeholder="例如 1 或 tunnel-a" />
					</Form.Item>
					<Form.Item label="IKE 本端 IP" name="ike_local_ip" rules={[{ required: true }]}>
						<Input />
					</Form.Item>
					<Form.Item label="IKE 对端 IP" name="ike_remote_ip" rules={[{ required: true }]}>
						<Input />
					</Form.Item>
					<Form.Item label="IKE 模式" name="ike_mode">
						<Input placeholder="main / aggressive" />
					</Form.Item>
					<Form.Item label="IKE 本端 proposal" name="ike_proposal_local">
						<Input />
					</Form.Item>
					<Form.Item label="对端 ID" name="remote_id">
						<Input />
					</Form.Item>
					<Form.Item label="预共享密钥" name="pre_shared_key">
						<Input.Password />
					</Form.Item>
					<Form.Item label="本地流量选择器" name="traffic_selectors_local" rules={[{ required: true }]}>
						<Input />
					</Form.Item>
					<Form.Item label="对端流量选择器" name="traffic_selectors_remote" rules={[{ required: true }]}>
						<Input />
					</Form.Item>
					<Form.Item label="VRF ID" name="vrf_id">
						<Input />
					</Form.Item>
					<Form.Item label="ESP 提案" name="sa_esp_proposals">
						<Input />
					</Form.Item>
					<Form.Item label="SA DPD 动作" name="sa_dpd_action">
						<Input />
					</Form.Item>
					<Space size="large">
						<Form.Item label="DPD delay" name="ike_dpd_delay">
							<InputNumber min={1} />
						</Form.Item>
						<Form.Item label="DPD timeout" name="ike_dpd_timeout">
							<InputNumber min={1} />
						</Form.Item>
					</Space>
					<Form.Item label="保存后立即发起连接" name="sa-initiate" valuePropName="checked">
						<Switch />
					</Form.Item>
				</Form>
			</ConsoleOpsModal>

			<ConsoleOpsDrawer
				title="自动重连 / 守卫"
				width={520}
				open={guardDrawerOpen}
				onClose={() => setGuardDrawerOpen(false)}
				destroyOnClose
				afterOpenChange={(open) => {
					if (open) void loadGuardCfg();
				}}
			>
				<Form form={guardForm} layout="vertical">
					<Form.Item name="enabled" label="监控总开关" valuePropName="checked">
						<Switch />
					</Form.Item>
					<Form.Item name="reconnect_enabled" label="自动重连" valuePropName="checked">
						<Switch />
					</Form.Item>
					<Form.Item name="interval" label="探测间隔（秒）" rules={[{ required: true }]}>
						<InputNumber min={5} max={3600} style={{ width: '100%' }} />
					</Form.Item>
					<Form.Item name="max_retries" label="最大重试次数" rules={[{ required: true }]}>
						<InputNumber min={1} max={20} style={{ width: '100%' }} />
					</Form.Item>
					<Button type="primary" onClick={() => void saveGuard()}>
						保存
					</Button>
				</Form>
				<Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
					监控平台下发且 sa-initiate 的隧道；配置与日志保存在设备 local-web 运行目录。
				</Typography.Paragraph>
			</ConsoleOpsDrawer>
		</div>
	);
};
