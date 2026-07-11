import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EllipsisOutlined } from '@ant-design/icons';
import { Button, Dropdown, Form, Input, Select, Spin, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { getApiErrorMessage } from '../../../../../../services/api';
import {
	applyIbrForwardingAcl,
	commitIbrForwardingAcl,
	configIbrForwardingAclRule,
	createIbrForwardingAcl,
	deleteIbrForwardingAcl,
	deleteIbrForwardingAclRule,
	fetchIbrForwardingAclRules,
	fetchIbrForwardingAcls,
	fetchIbrForwardingInterfaces,
	noCommitIbrForwardingAcl,
	unapplyIbrForwardingAcl,
	type IbrForwardingAclRow,
	type IbrForwardingAclRuleRow,
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
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

/** 设备 ACL（ibr-local-web 同源）；勿用 useAclManagement / /api/networks/acl-groups */

type Props = {
	vrUuid: string;
	managementIp: string;
};

const ACL_RULES_DRAWER_WIDTH = 960;
const Z_DRAWER_ACL_DETAIL = 1000;
const Z_DRAWER_ACL_RAW = 1100;

type IfBind = { interface: string; direction: string };

function actionTag(action: string) {
	return (
		<Tag color={action === 'permit' ? 'green' : 'red'} className="ibr-console-acl-tag">
			{String(action).toUpperCase()}
		</Tag>
	);
}

export const VrConsoleAclPanel: React.FC<Props> = ({ vrUuid, managementIp }) => {
	const canWrite = useIbrConsoleWritePermission('networks.acl:write');

	const [listLoading, setListLoading] = useState(false);
	const [rulesLoading, setRulesLoading] = useState(false);
	const [acls, setAcls] = useState<IbrForwardingAclRow[]>([]);
	const [selectedAclId, setSelectedAclId] = useState('');
	const [rules, setRules] = useState<IbrForwardingAclRuleRow[]>([]);
	const [applied, setApplied] = useState<IfBind[]>([]);
	const [configStatus, setConfigStatus] = useState('');
	const [interfaceApplied, setInterfaceApplied] = useState(false);
	const [runningRulesPresent, setRunningRulesPresent] = useState(false);
	const [ifaces, setIfaces] = useState<string[]>([]);
	const [rawOut, setRawOut] = useState('');

	const [createModalOpen, setCreateModalOpen] = useState(false);
	const [createSubmitting, setCreateSubmitting] = useState(false);
	const [createForm] = Form.useForm<{ acl_id: string }>();

	const [rulesDrawerOpen, setRulesDrawerOpen] = useState(false);
	const [applyDrawerOpen, setApplyDrawerOpen] = useState(false);
	const [ruleModalOpen, setRuleModalOpen] = useState(false);
	const [ruleModalSubmitting, setRuleModalSubmitting] = useState(false);
	const [ruleModalForm] = Form.useForm();
	const [applyForm] = Form.useForm();
	const [unapplyForm] = Form.useForm();
	const [interfaceApplyModalOpen, setInterfaceApplyModalOpen] = useState(false);
	const [interfaceUnbindModalOpen, setInterfaceUnbindModalOpen] = useState(false);
	const [interfaceApplySubmitting, setInterfaceApplySubmitting] = useState(false);
	const [interfaceUnbindSubmitting, setInterfaceUnbindSubmitting] = useState(false);

	const [rawDrawerOpen, setRawDrawerOpen] = useState(false);

	const loadAcls = useCallback(async () => {
		setListLoading(true);
		try {
			const data = await fetchIbrForwardingAcls(vrUuid, { skipCache: true });
			if (data.error) throw new Error(data.error);
			setAcls(Array.isArray(data.acls) ? data.acls : []);
		} catch (e) {
			message.error(getApiErrorMessage(e, '加载 ACL 列表失败'));
		} finally {
			setListLoading(false);
		}
	}, [vrUuid]);

	const loadRules = useCallback(
		async (aclId: string) => {
			if (!aclId) return;
			setRulesLoading(true);
			try {
				const data = await fetchIbrForwardingAclRules(vrUuid, aclId, { skipCache: true });
				if (data.error) throw new Error(data.error);
				setRules(Array.isArray(data.rules) ? data.rules : []);
				setApplied(Array.isArray(data.applied_interfaces) ? data.applied_interfaces : []);
				setConfigStatus(data.config_status ?? '');
				setInterfaceApplied(Boolean(data.interface_applied));
				setRunningRulesPresent(Boolean(data.running_rules_present));
				setRawOut(data.raw_output ?? '');
			} catch (e) {
				message.error(getApiErrorMessage(e, '加载规则失败'));
			} finally {
				setRulesLoading(false);
			}
		},
		[vrUuid],
	);

	useEffect(() => {
		void loadAcls();
	}, [loadAcls]);

	const loadIfaces = useCallback(async () => {
		try {
			const data = await fetchIbrForwardingInterfaces(vrUuid, { skipCache: true });
			if (data.error) throw new Error(data.error);
			setIfaces(Array.isArray(data.interfaces) ? data.interfaces : []);
		} catch (e) {
			setIfaces([]);
			message.error(getApiErrorMessage(e, '加载接口列表失败'));
		}
	}, [vrUuid]);

	const closeAllAclDrawers = useCallback(() => {
		setRulesDrawerOpen(false);
		setApplyDrawerOpen(false);
		setInterfaceApplyModalOpen(false);
		setInterfaceUnbindModalOpen(false);
	}, []);

	const listPage = useForwardTablePage(acls, FORWARD_TABLE_PAGE_SIZE);

	const openRulesDrawer = useCallback(
		(row: IbrForwardingAclRow) => {
			setSelectedAclId(row.id);
			closeAllAclDrawers();
			setRulesDrawerOpen(true);
			void loadRules(row.id);
		},
		[closeAllAclDrawers, loadRules],
	);

	const openApplyDrawer = useCallback(
		(row: IbrForwardingAclRow) => {
			setSelectedAclId(row.id);
			closeAllAclDrawers();
			setApplyDrawerOpen(true);
			void loadRules(row.id);
			void loadIfaces();
		},
		[closeAllAclDrawers, loadIfaces, loadRules],
	);

	const submitCreateAcl = async () => {
		try {
			const values = await createForm.validateFields();
			const id = String(values.acl_id ?? '').trim();
			if (!id) {
				message.warning('请输入 ACL 编号');
				return;
			}
			setCreateSubmitting(true);
			const res = await createIbrForwardingAcl(vrUuid, { acl_id: id });
			if (res.error) throw new Error(res.error);
			message.success('已创建');
			createForm.resetFields();
			setCreateModalOpen(false);
			void loadAcls();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(getApiErrorMessage(e, '创建失败'));
		} finally {
			setCreateSubmitting(false);
		}
	};

	const submitAddRule = async () => {
		if (!selectedAclId) return;
		try {
			const v = await ruleModalForm.validateFields();
			setRuleModalSubmitting(true);
			const res = await configIbrForwardingAclRule(vrUuid, {
				acl_id: selectedAclId,
				rule_id: (v.rule_id ?? '').trim(),
				match_action: v.match_action,
				proto: (v.proto ?? '').trim(),
				source: (v.source ?? '').trim(),
				destination: (v.destination ?? '').trim(),
				sport: (v.sport ?? '').trim(),
				dport: (v.dport ?? '').trim(),
			});
			if (res.error) throw new Error(res.error);
			message.success('已下发规则');
			ruleModalForm.resetFields();
			setRuleModalOpen(false);
			void loadRules(selectedAclId);
			void loadAcls();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(getApiErrorMessage(e, '添加失败'));
		} finally {
			setRuleModalSubmitting(false);
		}
	};

	const handleCommit = async () => {
		if (!selectedAclId) return;
		try {
			const res = await commitIbrForwardingAcl(vrUuid, { acl_id: selectedAclId });
			if (res.error) throw new Error(res.error);
			message.success('已 commit');
			void loadRules(selectedAclId);
		} catch (e) {
			message.error(getApiErrorMessage(e, '失败'));
		}
	};

	const handleNoCommit = async () => {
		if (!selectedAclId) return;
		try {
			const res = await noCommitIbrForwardingAcl(vrUuid, { acl_id: selectedAclId });
			if (res.error) throw new Error(res.error);
			message.success('已 no commit');
			void loadRules(selectedAclId);
		} catch (e) {
			message.error(getApiErrorMessage(e, '失败'));
		}
	};

	const submitInterfaceApply = async () => {
		if (!selectedAclId) return;
		try {
			const v = await applyForm.validateFields();
			setInterfaceApplySubmitting(true);
			const res = await applyIbrForwardingAcl(vrUuid, {
				interface: v.interface,
				acl_id: selectedAclId,
				if_direction: v.if_direction || 'input',
			});
			if (res.error) throw new Error(res.error);
			message.success('已应用');
			setInterfaceApplyModalOpen(false);
			applyForm.resetFields();
			void loadRules(selectedAclId);
			void loadAcls();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(getApiErrorMessage(e, '失败'));
		} finally {
			setInterfaceApplySubmitting(false);
		}
	};

	const submitInterfaceUnbind = async () => {
		if (!selectedAclId) return;
		try {
			const v = await unapplyForm.validateFields();
			setInterfaceUnbindSubmitting(true);
			const res = await unapplyIbrForwardingAcl(vrUuid, {
				interface: v.interface,
				acl_id: selectedAclId,
				if_direction: v.if_direction || 'input',
			});
			if (res.error) throw new Error(res.error);
			message.success('已解除');
			setInterfaceUnbindModalOpen(false);
			unapplyForm.resetFields();
			void loadRules(selectedAclId);
			void loadAcls();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(getApiErrorMessage(e, '失败'));
		} finally {
			setInterfaceUnbindSubmitting(false);
		}
	};

	const bindColumns = useMemo((): ColumnsType<IfBind> => {
		return [
			{ title: '接口', dataIndex: 'interface', ellipsis: true },
			{ title: '方向', dataIndex: 'direction', width: 96 },
		];
	}, []);

	const ruleColumns = useMemo((): ColumnsType<IbrForwardingAclRuleRow> => {
		const cols: ColumnsType<IbrForwardingAclRuleRow> = [
			{ title: '序号', dataIndex: 'rule_id', width: 88 },
			{
				title: '动作',
				dataIndex: 'action',
				width: 96,
				render: (act) => actionTag(act),
			},
			{ title: '详情', dataIndex: 'details', ellipsis: true },
		];
		if (canWrite) {
			cols.push({
				title: '',
				key: 'actions',
				width: 48,
				align: 'right',
				render: (_v, row) => (
					<div className="ibr-console-row-actions">
						<Dropdown
							menu={{
								items: [{ key: 'delete', label: '删除', danger: true }],
								onClick: async ({ key }) => {
									if (key !== 'delete' || !selectedAclId) return;
									try {
										const res = await deleteIbrForwardingAclRule(vrUuid, {
											acl_id: selectedAclId,
											rule_id: row.rule_id,
										});
										if (res.error) throw new Error(res.error);
										message.success('已删除规则');
										void loadRules(selectedAclId);
										void loadAcls();
									} catch (e) {
										message.error(getApiErrorMessage(e, '删除失败'));
									}
								},
							}}
							trigger={['click']}
							placement="bottomRight"
						>
							<Button type="text" size="small" icon={<EllipsisOutlined />} aria-label="更多操作" />
						</Dropdown>
					</div>
				),
			});
		}
		return cols;
	}, [canWrite, loadAcls, loadRules, selectedAclId, vrUuid]);

	const columns = useMemo((): ColumnsType<IbrForwardingAclRow> => {
		const cols: ColumnsType<IbrForwardingAclRow> = [
			{ title: 'ACL ID', dataIndex: 'id', fixed: 'left', width: 120 },
			{
				title: '规则数',
				dataIndex: 'rule_count',
				width: 88,
				render: (v) => (v == null ? 0 : v),
			},
			{ title: '引用次数', dataIndex: 'count', width: 100 },
		];
		if (canWrite) {
			cols.push({
				title: '',
				key: 'ops',
				fixed: 'right',
				width: 48,
				align: 'right',
				render: (_v, row) => {
					const items: MenuProps['items'] = [
						{ key: 'rules', label: '规则配置' },
						{ key: 'apply', label: '应用到接口' },
						{ type: 'divider' },
						{ key: 'delete', label: '删除', danger: true },
					];
					return (
						<div className="ibr-console-row-actions">
							<Dropdown
								menu={{
									items,
									onClick: async ({ key }) => {
										if (key === 'rules') openRulesDrawer(row);
										if (key === 'apply') openApplyDrawer(row);
										if (key === 'delete') {
											try {
												const res = await deleteIbrForwardingAcl(vrUuid, { acl_id: row.id });
												if (res.error) throw new Error(res.error);
												message.success('已删除');
												if (selectedAclId === row.id) {
													closeAllAclDrawers();
													setSelectedAclId('');
												}
												void loadAcls();
											} catch (e) {
												message.error(getApiErrorMessage(e, '删除失败'));
											}
										}
									},
								}}
								trigger={['click']}
								placement="bottomRight"
							>
								<Button type="text" size="small" icon={<EllipsisOutlined />} aria-label="更多操作" />
							</Dropdown>
						</div>
					);
				},
			});
		}
		return cols;
	}, [canWrite, closeAllAclDrawers, loadAcls, openApplyDrawer, openRulesDrawer, selectedAclId, vrUuid]);

	if (!managementIp) {
		return <VrConsoleNoDevicePanel />;
	}

	return (
		<>
			<div className="ibr-console-ops-panel">
				<div className="ibr-console-content-block">
					<div className="ibr-console-block-header">
						<h2 className="ibr-console-block-title">ACL 列表</h2>
						<div className="ibr-console-block-action">
							<Button type="default" loading={listLoading} onClick={() => void loadAcls()}>
								刷新
							</Button>
							{canWrite ? (
								<Button type="primary" onClick={() => setCreateModalOpen(true)}>
									创建 ACL
								</Button>
							) : null}
						</div>
					</div>

					<div className="ibr-console-ops-card ibr-console-ops-card--table-pad">
						<div className="ibr-console-data-table-wrap">
							<Spin spinning={listLoading}>
								<ConsoleForwardTable
									showHeader
									rowKey="id"
									columns={columns}
									dataSource={listPage.pageData}
									scroll={{ x: true }}
									locale={{ emptyText: forwardTableEmpty('设备上暂无 ACL') }}
								/>
							</Spin>
						</div>
					</div>

					<ForwardTableFooter
						total={listPage.total}
						page={listPage.page}
						pageSize={FORWARD_TABLE_PAGE_SIZE}
						onChange={listPage.setPage}
					/>
				</div>
			</div>

			<ConsoleOpsModal
				title="创建 ACL"
				open={createModalOpen}
				width={440}
				okText="创建"
				cancelText="取消"
				confirmLoading={createSubmitting}
				destroyOnClose
				maskClosable={false}
				onCancel={() => {
					setCreateModalOpen(false);
					createForm.resetFields();
				}}
				onOk={() => void submitCreateAcl()}
			>
				<Form form={createForm} layout="vertical" preserve={false}>
					<Form.Item
						name="acl_id"
						label="ACL 编号"
						rules={[{ required: true, message: '请输入 ACL 编号' }]}
					>
						<Input
							className="ibr-console-ops-input"
							placeholder="例如 2000、3333（与设备策略一致）"
							allowClear
						/>
					</Form.Item>
				</Form>
			</ConsoleOpsModal>

			<ConsoleOpsDrawer
				title={selectedAclId ? `规则配置 — ACL ${selectedAclId}` : '规则配置'}
				width={ACL_RULES_DRAWER_WIDTH}
				zIndex={Z_DRAWER_ACL_DETAIL}
				open={rulesDrawerOpen}
				onClose={() => {
					setRulesDrawerOpen(false);
					setRuleModalOpen(false);
				}}
				destroyOnClose
				extra={
					selectedAclId ? (
						<Button type="link" size="small" onClick={() => setRawDrawerOpen(true)}>
							查看原始输出
						</Button>
					) : null
				}
				footer={
					canWrite && selectedAclId ? (
						<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
							<Button type="primary" onClick={() => void handleCommit()}>
								Commit
							</Button>
							<Button onClick={() => void handleNoCommit()}>No commit</Button>
						</div>
					) : null
				}
			>
				<Spin spinning={rulesLoading}>
					<Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
						当配置状态为「Committed」时，不能直接添加新规则。请先点击底部「No commit」进入可编辑状态，再添加或修改规则；确认后点击「Commit」保存到设备。
					</Typography.Paragraph>
					<Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
						配置状态：{configStatus || '—'}
						<span style={{ marginLeft: 12 }}>
							（running 内已有规则：{runningRulesPresent ? '是' : '否'}；已绑接口：
							{interfaceApplied ? '是' : '否'}）
						</span>
					</Typography.Paragraph>
					{canWrite ? (
						<div style={{ marginBottom: 12, textAlign: 'right' }}>
							<Button type="primary" onClick={() => setRuleModalOpen(true)}>
								添加规则
							</Button>
						</div>
					) : null}
					<ConsoleForwardTable
						showHeader
						rowKey={(r) => r.rule_id + r.raw}
						columns={ruleColumns}
						dataSource={rules}
						scroll={{ x: true }}
						locale={{ emptyText: forwardTableEmpty('暂无规则') }}
					/>
				</Spin>
			</ConsoleOpsDrawer>

			<ConsoleOpsDrawer
				title={selectedAclId ? `应用到接口 — ACL ${selectedAclId}` : '应用到接口'}
				width={ACL_RULES_DRAWER_WIDTH}
				zIndex={Z_DRAWER_ACL_DETAIL}
				open={applyDrawerOpen}
				onClose={() => {
					setApplyDrawerOpen(false);
					setInterfaceApplyModalOpen(false);
					setInterfaceUnbindModalOpen(false);
				}}
				destroyOnClose
				extra={
					selectedAclId ? (
						<Button type="link" size="small" onClick={() => setRawDrawerOpen(true)}>
							查看原始输出
						</Button>
					) : null
				}
			>
				<Spin spinning={rulesLoading}>
					<Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
						下表为设备上当前已绑定本 ACL 的接口与方向。需要新增绑定或解除绑定时，点击右侧按钮，在弹窗中填写接口与方向后下发。
					</Typography.Paragraph>
					<div
						style={{
							display: 'flex',
							flexWrap: 'wrap',
							alignItems: 'center',
							justifyContent: 'space-between',
							gap: 8,
							marginBottom: 12,
						}}
					>
						<Typography.Text>
							<Typography.Text type="secondary">当前绑定：</Typography.Text> {applied.length} 处
						</Typography.Text>
						{canWrite ? (
							<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
								<Button
									type="primary"
									onClick={() => {
										applyForm.resetFields();
										void loadIfaces();
										setInterfaceApplyModalOpen(true);
									}}
								>
									应用到接口
								</Button>
								<Button
									danger
									onClick={() => {
										unapplyForm.resetFields();
										void loadIfaces();
										setInterfaceUnbindModalOpen(true);
									}}
								>
									从接口解绑
								</Button>
							</div>
						) : null}
					</div>
					<ConsoleForwardTable
						showHeader
						rowKey={(r) => r.interface + r.direction}
						columns={bindColumns}
						dataSource={applied}
						scroll={{ x: true }}
						locale={{ emptyText: forwardTableEmpty('暂无绑定') }}
					/>
				</Spin>
			</ConsoleOpsDrawer>

			<ForwardTextDrawer
				title={selectedAclId ? `原始输出 — ACL ${selectedAclId}` : '原始输出'}
				open={rawDrawerOpen}
				onClose={() => setRawDrawerOpen(false)}
				text={rawOut.trim() ? rawOut : '（暂无）'}
				zIndex={Z_DRAWER_ACL_RAW}
			/>

			<ConsoleOpsModal
				title="添加规则"
				open={ruleModalOpen}
				width={560}
				okText="确定添加"
				cancelText="取消"
				confirmLoading={ruleModalSubmitting}
				destroyOnClose
				maskClosable={false}
				onCancel={() => {
					setRuleModalOpen(false);
					ruleModalForm.resetFields();
				}}
				onOk={() => void submitAddRule()}
			>
				<Form
					form={ruleModalForm}
					layout="vertical"
					preserve={false}
					initialValues={{ match_action: 'permit', proto: '' }}
				>
					<Form.Item name="rule_id" label="序号（可选）">
						<Input className="ibr-console-ops-input" placeholder="例如 10" />
					</Form.Item>
					<Form.Item name="match_action" label="动作" rules={[{ required: true, message: '请选择动作' }]}>
						<Select
							className="ibr-console-ops-input"
							options={[
								{ value: 'permit', label: 'Permit（允许）' },
								{ value: 'deny', label: 'Deny（拒绝）' },
							]}
						/>
					</Form.Item>
					<Form.Item name="proto" label="协议">
						<Select
							className="ibr-console-ops-input"
							options={[
								{ value: '', label: 'IP（全部）' },
								{ value: 'tcp', label: 'TCP' },
								{ value: 'udp', label: 'UDP' },
								{ value: 'icmp', label: 'ICMP' },
							]}
						/>
					</Form.Item>
					<Form.Item name="source" label="源地址（CIDR）" rules={[{ required: true, message: '请输入源' }]}>
						<Input className="ibr-console-ops-input" placeholder="例如 10.1.1.0/24 或 any" />
					</Form.Item>
					<Form.Item
						name="destination"
						label="目的地址（CIDR）"
						rules={[{ required: true, message: '请输入目的' }]}
					>
						<Input className="ibr-console-ops-input" placeholder="例如 any" />
					</Form.Item>
					<Form.Item noStyle shouldUpdate={(p, c) => (p?.proto ?? '') !== (c?.proto ?? '')}>
						{() => {
							const p = ruleModalForm.getFieldValue('proto') as string;
							const portProto = p === 'tcp' || p === 'udp';
							return (
								<>
									<Form.Item name="sport" label="源端口（可选）">
										<Input
											className="ibr-console-ops-input"
											disabled={!portProto}
											placeholder={portProto ? '例如 80' : '仅 TCP/UDP 可填'}
										/>
									</Form.Item>
									<Form.Item name="dport" label="目的端口（可选）">
										<Input
											className="ibr-console-ops-input"
											disabled={!portProto}
											placeholder={portProto ? '例如 80' : '仅 TCP/UDP 可填'}
										/>
									</Form.Item>
								</>
							);
						}}
					</Form.Item>
				</Form>
			</ConsoleOpsModal>

			<ConsoleOpsModal
				title={selectedAclId ? `应用到接口 — ACL ${selectedAclId}` : '应用到接口'}
				open={interfaceApplyModalOpen}
				width={480}
				okText="确定"
				cancelText="取消"
				confirmLoading={interfaceApplySubmitting}
				destroyOnClose
				maskClosable={false}
				onCancel={() => {
					setInterfaceApplyModalOpen(false);
					applyForm.resetFields();
				}}
				onOk={() => void submitInterfaceApply()}
			>
				<Form form={applyForm} layout="vertical" preserve={false}>
					<Form.Item name="interface" label="接口" rules={[{ required: true, message: '请选择接口' }]}>
						<Select
							className="ibr-console-ops-input"
							showSearch
							allowClear
							options={ifaces.map((x) => ({ value: x, label: x }))}
							placeholder="选择要绑定的接口"
						/>
					</Form.Item>
					<Form.Item name="if_direction" label="方向" initialValue="input">
						<Select
							className="ibr-console-ops-input"
							options={[
								{ value: 'input', label: '入站（in）' },
								{ value: 'output', label: '出站（out）' },
							]}
						/>
					</Form.Item>
				</Form>
			</ConsoleOpsModal>

			<ConsoleOpsModal
				title={selectedAclId ? `从接口解绑 — ACL ${selectedAclId}` : '从接口解绑'}
				open={interfaceUnbindModalOpen}
				width={480}
				okText="确定解除"
				cancelText="取消"
				okButtonProps={{ danger: true }}
				confirmLoading={interfaceUnbindSubmitting}
				destroyOnClose
				maskClosable={false}
				onCancel={() => {
					setInterfaceUnbindModalOpen(false);
					unapplyForm.resetFields();
				}}
				onOk={() => void submitInterfaceUnbind()}
			>
				<Form form={unapplyForm} layout="vertical" preserve={false}>
					<Form.Item name="interface" label="接口" rules={[{ required: true, message: '请选择接口' }]}>
						<Select
							className="ibr-console-ops-input"
							showSearch
							allowClear
							options={ifaces.map((x) => ({ value: x, label: x }))}
							placeholder="选择要解除绑定的接口"
						/>
					</Form.Item>
					<Form.Item name="if_direction" label="方向" initialValue="input">
						<Select
							className="ibr-console-ops-input"
							options={[
								{ value: 'input', label: '入站（in）' },
								{ value: 'output', label: '出站（out）' },
							]}
						/>
					</Form.Item>
				</Form>
			</ConsoleOpsModal>
		</>
	);
};
