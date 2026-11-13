import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Checkbox, Form, Input, Modal, Spin, Tabs, Tag, Typography, message } from 'antd';
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
	type IbrHaGroup,
	type IbrHaGroupDeployPreview,
	type IbrHaGroupMember,
	type IbrHaGroupStatus,
} from '../../../../services/ibrHaGroupApi';
import { loadIbrVrCatalog } from '../lib/ibrVrCatalog';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import { commonBadgeStyles } from '../../../../utils/tableStyles';
import { readSideFromIntent, sideLabel } from './haGroupWizardLib';

const STATUS_LABEL: Record<IbrHaGroupStatus, string> = {
	draft: '草稿',
	configured: '已配置',
	degraded: '降级',
	unknown: '未知',
};

function statusBadge(status: IbrHaGroupStatus): React.ReactNode {
	if (status === 'configured') {
		return (
			<Badge
				status={commonBadgeStyles.statusMap.success.status}
				text={<span style={commonBadgeStyles.text}>{STATUS_LABEL[status]}</span>}
			/>
		);
	}
	if (status === 'degraded') {
		return (
			<Badge
				status={commonBadgeStyles.statusMap.warning.status}
				text={<span style={commonBadgeStyles.text}>{STATUS_LABEL[status]}</span>}
			/>
		);
	}
	if (status === 'draft') {
		return <Tag>{STATUS_LABEL[status]}</Tag>;
	}
	return (
		<Badge
			status={commonBadgeStyles.statusMap.default.status}
			text={<span style={commonBadgeStyles.text}>{STATUS_LABEL[status] || status}</span>}
		/>
	);
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

	const load = useCallback(async (force?: boolean) => {
		setLoading(true);
		try {
			const groups = await fetchIbrHaGroups({ skipCache: force ?? true });
			setRows(groups);
			// 预热 IBR 目录，向导页进入时更快
			void loadIbrVrCatalog();
		} catch (e) {
			message.error(getApiErrorMessage(e, '加载 HA 组失败'));
		} finally {
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

	const handleDelete = useCallback((row: IbrHaGroup) => {
			let revertDevice = true;
			Modal.confirm({
			title: '删除 HA 组',
				content: (
					<div>
						<p style={{ marginBottom: 8 }}>确定删除「{row.name}」？不会删除 IBR 实例本身。</p>
						<Checkbox checked disabled style={{ color: 'rgba(0,0,0,.88)' }}>
							回退平台中的 HA 组档案
						</Checkbox>
						<br />
						<Checkbox
							defaultChecked
							onChange={(e) => {
								revertDevice = e.target.checked;
							}}
						>
							同步回退到底层设备
						</Checkbox>
						<p style={{ marginTop: 12, marginBottom: 0, color: 'rgba(0,0,0,.45)', fontSize: 12 }}>
							删除时会清除 SRv6 隧道端点上的 HA 归属标注，不改隧道配置或设备。不勾选回退设备时，设备 VR2 / CLI
							上的本组 VRRP 会留下；勾选后按本组 vrid / group_id 剥配置（其它 VRRP 与 SRv6 保留），失败时组和隧道标注仍保留，可重试。
						</p>
					</div>
				),
				okText: '删除',
				okButtonProps: { danger: true },
				cancelText: '取消',
				onOk: async () => {
					try {
						const result = await deleteIbrHaGroup(row.id, { revertDevice });
						const detachedMessage = result.detachedTunnelCount
							? `，已清除 ${result.detachedTunnelCount} 条隧道的 HA 标注`
							: '';
						message.success(
							`${revertDevice ? '已删除并回退设备 VRRP' : '已删除（设备 VRRP 未改）'}${detachedMessage}`,
						);
						await load(true);
					} catch (e) {
						message.error(getApiErrorMessage(e, '删除失败'));
						throw e;
					}
				},
			});
	}, [load]);
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
				title: '状态',
				dataIndex: 'status',
				key: 'status',
				render: (status: IbrHaGroupStatus) => statusBadge(status),
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
												key: 'wizard',
												label: '配置向导',
												onClick: () => navigate(`/admin/interconnect/ha-groups/${row.id}/wizard`),
											},
											{
												key: 'delete',
												label: '删除',
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
	}, [canWrite, handleDelete, handleViewConfig, navigate]);

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
		</PageContainer>
	);
};

export default IbrHaGroupsPage;
