import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Checkbox, Form, Input, Modal, Tag, message } from 'antd';
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
	type IbrHaGroup,
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

	const handleDelete = useCallback((row: IbrHaGroup) => {
		let revertDevice = false;
		Modal.confirm({
			title: '解散 HA 组',
			content: (
				<div>
					<p style={{ marginBottom: 8 }}>确定解散「{row.name}」？不会删除 IBR 实例本身。</p>
					<Checkbox
						onChange={(e) => {
							revertDevice = e.target.checked;
						}}
					>
						同时从主备设备回退本组 VRRP（写入 VR2，由 agent 应用到 CLI）
					</Checkbox>
					<p style={{ margin: '8px 0 0', color: 'rgba(0,0,0,.45)', fontSize: 12 }}>
						仍被 SRv6 隧道绑定的组不能解散。不勾选则只删平台组档案，设备 / VR2 上的 VRRP 会留下；勾选失败时组仍保留，可重试。
					</p>
				</div>
			),
			okText: '解散',
			okButtonProps: { danger: true },
			cancelText: '取消',
			onOk: async () => {
				try {
					await deleteIbrHaGroup(row.id, { revertDevice });
					message.success(revertDevice ? '已解散并回退设备 VRRP' : '已解散（设备 VRRP 未改）');
					await load(true);
				} catch (e) {
					message.error(getApiErrorMessage(e, '解散失败'));
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
				render: (_v, row) =>
					canWrite ? (
						<ResourceActionsDropdown
							items={[
								{
									key: 'wizard',
									label: '配置向导',
									onClick: () => navigate(`/admin/interconnect/ha-groups/${row.id}/wizard`),
								},
								{
									key: 'delete',
									label: '解散',
									danger: true,
									onClick: () => handleDelete(row),
								},
							]}
						/>
					) : null,
			},
		];
	}, [canWrite, navigate, handleDelete]);

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
		/>
	);
};

export default IbrHaGroupsPage;
