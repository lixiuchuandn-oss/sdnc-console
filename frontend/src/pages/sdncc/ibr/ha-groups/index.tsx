import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Alert,
	Button,
	Checkbox,
	Form,
	Input,
	Modal,
	Spin,
	Table,
	Tabs,
	Tag,
	Tooltip,
	Typography,
	message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../../components/PageContainer';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useAuth } from '../../../../contexts/AuthContext';
import { getApiErrorMessage } from '../../../../services/api';
import {
	deleteIbrHaGroup,
	fetchIbrHaGroups,
	previewIbrHaGroupDeploy,
	reconcileIbrHaGroups,
	type HaGroupHealthCode,
	type IbrHaGroup,
	type IbrHaGroupDeployPreview,
	type IbrHaGroupMember,
	type IbrHaGroupReconcileReport,
	type IbrHaGroupStatus,
} from '../../../../services/ibrHaGroupApi';
import { loadIbrVrCatalog } from '../lib/ibrVrCatalog';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import { readSideFromIntent, sideLabel } from './haGroupWizardLib';
import HaHealthCheckModal from './HaHealthCheckModal';

const STATUS_LABEL: Record<IbrHaGroupStatus, string> = {
	draft: '草稿',
	configured: '已配置',
	degraded: '降级',
	unknown: '未知',
};

function lifecycleTag(status: IbrHaGroupStatus): React.ReactNode {
	const label = STATUS_LABEL[status] || status;
	if (status === 'configured') return <Tag color="green">{label}</Tag>;
	if (status === 'degraded') return <Tag color="orange">{label}</Tag>;
	if (status === 'draft') return <Tag>{label}</Tag>;
	return <Tag>{label}</Tag>;
}

function configHealthTag(h?: HaGroupHealthCode | null): React.ReactNode {
	if (h === 'ok') return <Tag color="green">健康</Tag>;
	if (h === 'drift') return <Tag color="orange">漂移</Tag>;
	if (h === 'not_deployed') return <Tag>未下发</Tag>;
	if (h === 'degraded') return <Tag color="orange">降级</Tag>;
	if (h === 'endpoint_missing') return <Tag color="red">端点缺失</Tag>;
	return <Tag>未检查</Tag>;
}

function memberByRole(members: IbrHaGroupMember[], role: 'primary' | 'backup'): IbrHaGroupMember | undefined {
	return members.find((m) => m.role === role);
}

function formatMemberCell(member?: IbrHaGroupMember): React.ReactNode {
	if (!member) return '—';
	const title = member.name || member.vrUuid;
	return (
		<span title={member.vrUuid}>
			{title}
			{member.managementIp ? ` · ${member.managementIp}` : ''}
		</span>
	);
}

function formatTime(iso?: string): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

const jsonBlockStyle: React.CSSProperties = {
	fontSize: 12,
	lineHeight: '18px',
	whiteSpace: 'pre-wrap',
	wordBreak: 'break-word',
	overflowX: 'auto',
	margin: 0,
	maxHeight: 420,
	background: '#1e1e1e',
	color: '#d4d4d4',
	padding: 12,
	borderRadius: 6,
};

const IbrHaGroupsPage: React.FC = () => {
	const navigate = useNavigate();
	const { user } = useAuth();
	const perms = Array.isArray(user?.permissions) ? user?.permissions ?? [] : [];
	const canWrite =
		user?.role === 'super_admin' || hasPermissionForAction(perms, 'networks.vr-config:write');

	const [loading, setLoading] = useState(false);
	const [rows, setRows] = useState<IbrHaGroup[]>([]);
	const [keyword, setKeyword] = useState('');
	const [filterForm] = Form.useForm();
	const [configModal, setConfigModal] = useState<IbrHaGroup | null>(null);
	const [configLoading, setConfigLoading] = useState(false);
	const [configPreview, setConfigPreview] = useState<{
		primary?: IbrHaGroupDeployPreview;
		backup?: IbrHaGroupDeployPreview;
		primaryError?: string;
		backupError?: string;
	}>({});
	const [healthModalOpen, setHealthModalOpen] = useState(false);
	const [healthRow, setHealthRow] = useState<IbrHaGroup | null>(null);
	const [reconcileOpen, setReconcileOpen] = useState(false);
	const [reconcileLoading, setReconcileLoading] = useState(false);
	const [reconcileGroupId, setReconcileGroupId] = useState<string | undefined>();
	const [reconcileReport, setReconcileReport] = useState<IbrHaGroupReconcileReport | null>(null);
	const loadGenRef = useRef(0);

	const load = useCallback(async (force?: boolean) => {
		const gen = ++loadGenRef.current;
		setLoading(true);
		let painted = false;
		try {
			const groups = await fetchIbrHaGroups({ skipCache: force ?? true, includeHealth: false });
			if (gen !== loadGenRef.current) return;
			setRows(groups);
			painted = true;
			setLoading(false);
			void loadIbrVrCatalog();
			try {
				const withHealth = await fetchIbrHaGroups({ skipCache: true, includeHealth: true });
				if (gen !== loadGenRef.current) return;
				setRows(withHealth);
			} catch (he) {
				if (gen !== loadGenRef.current) return;
				message.warning(`配置健康暂不可用：${getApiErrorMessage(he, '请稍后刷新')}`);
			}
		} catch (e) {
			if (gen !== loadGenRef.current) return;
			message.error(getApiErrorMessage(e, '加载 HA 组失败'));
			if (!painted) setRows([]);
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const filteredRows = useMemo(() => {
		const kw = keyword.trim().toLowerCase();
		if (!kw) return rows;
		return rows.filter((row) => {
			const primary = memberByRole(row.members, 'primary');
			const backup = memberByRole(row.members, 'backup');
			const hay = [
				row.name,
				row.id,
				primary?.vrUuid,
				primary?.name,
				backup?.vrUuid,
				backup?.name,
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			return hay.includes(kw);
		});
	}, [keyword, rows]);

	const runReconcile = useCallback(
		async (repair: boolean, groupId?: string) => {
			setReconcileLoading(true);
			try {
				const report = await reconcileIbrHaGroups({ repair, groupId });
				setReconcileReport(report);
				if (repair) {
					if (report.repaired > 0) {
						message.success(
							`对账完成：已按意图重新下发 ${report.repaired} 个 HA 组（写设备本组 VRRP）`,
						);
						await load(true);
					} else if (report.withIssues > 0) {
						message.warning(
							`对账完成：仍有 ${report.withIssues} 个组未能自动修复，请查看问题列`,
						);
					} else {
						message.success('对账完成：未发现需修复项');
					}
				} else if (report.withIssues === 0) {
					message.success('对账完成：未发现配置漂移');
				} else {
					message.warning(`对账完成：发现 ${report.withIssues} 个 HA 组存在漂移或降级`);
				}
			} catch (e) {
				message.error(getApiErrorMessage(e, '对账失败'));
			} finally {
				setReconcileLoading(false);
			}
		},
		[load],
	);

	const openReconcileModal = useCallback(
		(groupId?: string) => {
			setReconcileGroupId(groupId);
			setReconcileReport(null);
			setReconcileOpen(true);
			void runReconcile(false, groupId);
		},
		[runReconcile],
	);

	const handleViewConfig = useCallback(async (row: IbrHaGroup) => {
		setConfigModal(row);
		setConfigPreview({});
		setConfigLoading(true);
		try {
			const [primary, backup] = await Promise.allSettled([
				previewIbrHaGroupDeploy(row.id, 'primary', { mergeDevice: false }),
				previewIbrHaGroupDeploy(row.id, 'backup', { mergeDevice: false }),
			]);
			setConfigPreview({
				primary: primary.status === 'fulfilled' ? primary.value : undefined,
				backup: backup.status === 'fulfilled' ? backup.value : undefined,
				primaryError:
					primary.status === 'rejected' ? getApiErrorMessage(primary.reason, '主节点组装失败') : undefined,
				backupError:
					backup.status === 'rejected' ? getApiErrorMessage(backup.reason, '备节点组装失败') : undefined,
			});
		} finally {
			setConfigLoading(false);
		}
	}, []);

	const handleDelete = useCallback(
		(row: IbrHaGroup) => {
			let revertDevice = false;
			Modal.confirm({
				title: '确认删除该HA组？',
				content: (
					<div>
						<p style={{ marginBottom: 8 }}>确定删除：{row.name}</p>
						<Checkbox checked disabled>
							回退平台中的 HA 组档案
						</Checkbox>
						<br />
						<Checkbox
							defaultChecked={false}
							onChange={(e) => {
								revertDevice = e.target.checked;
							}}
						>
							同步回退到底层设备
						</Checkbox>
						<p style={{ marginTop: 12, marginBottom: 0, color: 'rgba(0,0,0,.45)', fontSize: 12 }}>
							仍被 SRv6 隧道绑定的组不能删除。不勾选回退设备则只删平台档案，设备 VR2 / CLI
							上的本组 VRRP 会留下；勾选后按本组 vrid / group_id 剥配置（其它 VRRP 与 SRv6 保留），失败时组仍保留，可重试。
						</p>
					</div>
				),
				okText: '删除',
				okButtonProps: { danger: true },
				cancelText: '取消',
				onOk: async () => {
					try {
						await deleteIbrHaGroup(row.id, { revertDevice });
						message.success(revertDevice ? '已删除并回退设备 VRRP' : '已删除（设备 VRRP 未改）');
						await load(true);
					} catch (e) {
						message.error(getApiErrorMessage(e, '删除失败'));
						throw e;
					}
				},
			});
		},
		[load],
	);

	const columns = useMemo((): ColumnsType<IbrHaGroup> => {
		return [
			{
				title: '组名称',
				dataIndex: 'name',
				key: 'name',
				fixed: 'left',
				render: (name: string) => <b>{name}</b>,
			},
			{
				title: '主节点',
				key: 'primary',
				render: (_v, row) => formatMemberCell(memberByRole(row.members, 'primary')),
			},
			{
				title: '备节点',
				key: 'backup',
				render: (_v, row) => formatMemberCell(memberByRole(row.members, 'backup')),
			},
			{
				title: 'HA 组角色',
				key: 'side',
				render: (_v, row) => sideLabel(readSideFromIntent(row.vrrpIntent) ?? undefined),
			},
			{
				title: '模式',
				dataIndex: 'mode',
				key: 'mode',
				render: (mode: string) => (mode === 'active-standby' ? '双机主备' : mode),
			},
			{
				title: '生命周期',
				dataIndex: 'status',
				key: 'status',
				render: (status: IbrHaGroupStatus) => (
					<Tooltip title="平台档案生命周期，不等于 VRRP 已通">{lifecycleTag(status)}</Tooltip>
				),
			},
			{
				title: '配置健康',
				key: 'configHealth',
				render: (_v, row) => {
					const clickable =
						row.configHealth === 'drift' ||
						row.configHealth === 'degraded' ||
						row.configHealth === 'endpoint_missing' ||
						row.configHealth === 'not_deployed';
					const tip = [
						row.configHealthMessage || '刷新列表可重新对账',
						row.configHealthCheckedAt ? `检查于 ${formatTime(row.configHealthCheckedAt)}` : '',
						'只比本组 VR2 的 vrid / group_id 与平台意图，不扫 live VRRP，也不计入 SRv6 隧道黄标。',
						clickable
							? '点击打开「配置对账」。扫描并修复会按意图重新下发本组 VRRP（写设备）。'
							: '',
					]
						.filter(Boolean)
						.join('\n');
					return (
						<Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tip}</span>}>
							<span
								role={clickable ? 'button' : undefined}
								style={clickable ? { cursor: 'pointer' } : undefined}
								onClick={clickable ? () => openReconcileModal(row.id) : undefined}
							>
								{configHealthTag(row.configHealth)}
							</span>
						</Tooltip>
					);
				},
			},
			{
				title: '创建时间',
				dataIndex: 'createdAt',
				key: 'createdAt',
				render: (d: string) => formatTime(d),
			},
			{
				title: '操作',
				key: 'actions',
				fixed: 'right',
				render: (_v, row) => (
					<ResourceActionsDropdown
						items={[
							{
								key: 'view',
								label: '查看配置',
								onClick: () => void handleViewConfig(row),
							},
							...(canWrite
								? [
										{
											key: 'update',
											label: '配置更新',
											onClick: () => navigate(`/admin/interconnect/ha-groups/${row.id}/wizard`),
										},
									]
								: []),
							{
								key: 'health',
								label: '健康巡检',
								onClick: () => {
									setHealthRow(row);
									setHealthModalOpen(true);
								},
							},
							...(canWrite
								? [
										{ type: 'divider' as const, key: 'divider' },
										{
											key: 'delete',
											label: '删除HA组',
											danger: true,
											onClick: () => handleDelete(row),
										},
									]
								: []),
						]}
					/>
				),
			},
		];
	}, [canWrite, handleDelete, handleViewConfig, navigate, openReconcileModal]);

	return (
		<PageContainer
			titleLevel={3}
			asCard={false}
			primaryAction={
				canWrite
					? {
							text: '创建 HA 组',
							type: 'primary',
							onClick: () => navigate('/admin/interconnect/ha-groups/create'),
						}
					: undefined
			}
			secondaryActions={
				<Button
					onClick={() => {
						openReconcileModal();
					}}
				>
					配置对账
				</Button>
			}
			onRefresh={() => {
				void load(true);
			}}
			toolbarLeft={
				<Form
					className="toolbar-container"
					form={filterForm}
					layout="inline"
					style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
					onValuesChange={(_, all) => setKeyword(all.keyword || '')}
				>
					<Form.Item name="keyword" style={{ marginBottom: 0 }}>
						<Input
							allowClear
							placeholder="组名称 / 实例 ID"
							className="toolbar-search"
							suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
						/>
					</Form.Item>
					<button
						type="button"
						className="toolbar-reset-btn"
						onClick={() => {
							filterForm.resetFields();
							setKeyword('');
						}}
					>
						重置
					</button>
				</Form>
			}
			tableProps={{
				rowKey: 'id',
				loading,
				columns,
				dataSource: filteredRows,
				bordered: false,
				className: 'std-table',
				scroll: { x: true },
				pagination: {
					size: 'small',
					showTotal: (total) => `共 ${total} 条`,
				},
			}}
		>
			<Modal
				title={`HA 组配置 · ${configModal?.name || ''}`}
				open={Boolean(configModal)}
				onCancel={() => setConfigModal(null)}
				footer={null}
				width={760}
				destroyOnClose
			>
				<Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
					平台意图为向导保存的 vrrpIntent；组装片是下发时写入接口 vrrp 与顶层 vrrp group 的 JSON。
				</Typography.Paragraph>
				<Spin spinning={configLoading}>
					<Tabs
						items={[
							{
								key: 'intent',
								label: '平台意图',
								children: (
									<pre style={jsonBlockStyle}>
										{configModal?.vrrpIntent
											? safeStringify(configModal.vrrpIntent)
											: '本组尚未保存 VRRP 意图'}
									</pre>
								),
							},
							{
								key: 'primary',
								label: '主节点组装',
								children: (
									<pre style={jsonBlockStyle}>
										{configPreview.primaryError
											? configPreview.primaryError
											: configPreview.primary
												? safeStringify(configPreview.primary.slice)
												: '暂无组装结果'}
									</pre>
								),
							},
							{
								key: 'backup',
								label: '备节点组装',
								children: (
									<pre style={jsonBlockStyle}>
										{configPreview.backupError
											? configPreview.backupError
											: configPreview.backup
												? safeStringify(configPreview.backup.slice)
												: '暂无组装结果'}
									</pre>
								),
							},
						]}
					/>
				</Spin>
			</Modal>

			<Modal
				title="HA 组配置对账"
				open={reconcileOpen}
				onCancel={() => {
					setReconcileOpen(false);
					setReconcileReport(null);
					setReconcileGroupId(undefined);
				}}
				width={860}
				footer={[
					<Button
						key="close"
						onClick={() => {
							setReconcileOpen(false);
							setReconcileReport(null);
							setReconcileGroupId(undefined);
						}}
					>
						关闭
					</Button>,
					<Button
						key="scan"
						loading={reconcileLoading}
						onClick={() => void runReconcile(false, reconcileGroupId)}
					>
						重新扫描
					</Button>,
					...(canWrite
						? [
								<Button
									key="repair"
									type="primary"
									loading={reconcileLoading}
									onClick={() => void runReconcile(true, reconcileGroupId)}
								>
									扫描并修复
								</Button>,
							]
						: []),
				]}
			>
				<Alert
					type="info"
					showIcon
					style={{ marginBottom: 12 }}
					message="对账说明"
					description="只比较本组 VR2 上的 vrid / group_id 是否等于平台意图物化结果。其它 VRRP 与 SRv6 / ACL / NAT / IPsec 不计入。「扫描并修复」会按意图重新下发主备设备（写 VR2 / CLI），不会用设备片回写意图，也不会改 SRv6 账本。"
				/>
				{reconcileReport ? (
					<div style={{ marginBottom: 8, color: 'rgba(0,0,0,.65)' }}>
						扫描 {reconcileReport.scanned} 个 HA 组 · 问题 {reconcileReport.withIssues} · 已修复{' '}
						{reconcileReport.repaired}
					</div>
				) : null}
				<Table
					size="small"
					loading={reconcileLoading}
					rowKey="groupId"
					pagination={{ pageSize: 8, size: 'small' }}
					dataSource={reconcileReport?.items ?? []}
					locale={{ emptyText: reconcileLoading ? '扫描中…' : '暂无对账结果' }}
					columns={[
						{ title: '组名称', dataIndex: 'name', key: 'name' },
						{
							title: '健康',
							dataIndex: 'health',
							key: 'health',
							render: (h: HaGroupHealthCode) => configHealthTag(h),
						},
						{
							title: '问题',
							dataIndex: 'message',
							key: 'message',
							render: (msg: string, row) =>
								row.health === 'ok' && !row.repaired ? (
									<Tag color="green">一致</Tag>
								) : (
									msg || '—'
								),
						},
						{
							title: '修复动作',
							dataIndex: 'repairActions',
							key: 'repairActions',
							render: (acts: string[]) => (acts?.length ? acts.join('；') : '—'),
						},
					]}
				/>
			</Modal>

			<HaHealthCheckModal
				open={healthModalOpen}
				group={healthRow}
				onClose={() => {
					setHealthModalOpen(false);
					setHealthRow(null);
				}}
			/>
		</PageContainer>
	);
};

export default IbrHaGroupsPage;
