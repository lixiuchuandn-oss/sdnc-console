import { Button, Divider, Drawer, Form, Input, Modal, Select, Space, Spin, Table, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { TableBlock } from '../../components/TableBlock';

type AclRow = { id: string; count: number };
type RuleRow = { rule_id: string; action: string; details: string; raw: string };
type IfBind = { interface: string; direction: string };

/** ACL 详情类抽屉（规则配置、应用到接口）统一宽度与版式 */
const DRAWER_WIDTH_ACL = 960;
/** 规则/接口抽屉同层；原始输出从其中打开，须更高以免被遮挡（antd Drawer 默认多为 1000） */
const Z_DRAWER_ACL_DETAIL = 1000;
const Z_DRAWER_ACL_RAW = 1100;

function DrawerIntro(props: { children: ReactNode }) {
	return (
		<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
			{props.children}
		</Typography.Paragraph>
	);
}

export function AclPage() {
	const [acls, setAcls] = useState<AclRow[]>([]);
	const [aclId, setAclId] = useState('');
	const [rules, setRules] = useState<RuleRow[]>([]);
	const [applied, setApplied] = useState<IfBind[]>([]);
	const [rawOut, setRawOut] = useState('');
	const [configStatus, setConfigStatus] = useState('');
	const [interfaceApplied, setInterfaceApplied] = useState(false);
	const [runningRulesPresent, setRunningRulesPresent] = useState(false);
	const [ifaces, setIfaces] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [ruleModalForm] = Form.useForm();
	const [createAclForm] = Form.useForm<{ acl_id: string }>();
	const [applyForm] = Form.useForm();
	const [unapplyForm] = Form.useForm();
	const [createAclModalOpen, setCreateAclModalOpen] = useState(false);
	const [createAclSubmitting, setCreateAclSubmitting] = useState(false);
	const [rawDrawerOpen, setRawDrawerOpen] = useState(false);
	const [rulesDrawerOpen, setRulesDrawerOpen] = useState(false);
	const [applyDrawerOpen, setApplyDrawerOpen] = useState(false);
	const [interfaceApplyModalOpen, setInterfaceApplyModalOpen] = useState(false);
	const [interfaceUnbindModalOpen, setInterfaceUnbindModalOpen] = useState(false);
	const [interfaceApplySubmitting, setInterfaceApplySubmitting] = useState(false);
	const [interfaceUnbindSubmitting, setInterfaceUnbindSubmitting] = useState(false);
	const [ruleModalOpen, setRuleModalOpen] = useState(false);
	const [ruleModalSubmitting, setRuleModalSubmitting] = useState(false);

	const loadAcls = useCallback(async () => {
		try {
			const { data } = await api.get<{ acls: AclRow[] }>('/forwarding/acls');
			setAcls(data.acls ?? []);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载 ACL 列表失败');
		}
	}, []);

	const loadIfaces = useCallback(async () => {
		try {
			const { data } = await api.get<{ interfaces?: string[] }>('/forwarding/interfaces');
			setIfaces(Array.isArray(data.interfaces) ? data.interfaces : []);
		} catch (e) {
			setIfaces([]);
			message.error(e instanceof Error ? e.message : '加载接口列表失败');
		}
	}, []);

	const loadRules = useCallback(async (id: string) => {
		if (!id) return;
		setLoading(true);
		try {
			const { data } = await api.get<{
				rules: RuleRow[];
				applied_interfaces: IfBind[];
				raw_output: string;
				config_status: string;
				interface_applied?: boolean;
				running_rules_present?: boolean;
			}>(`/forwarding/acl/${encodeURIComponent(id)}/rules`);
			setRules(data.rules ?? []);
			setApplied(data.applied_interfaces ?? []);
			setRawOut(data.raw_output ?? '');
			setConfigStatus(data.config_status ?? '');
			setInterfaceApplied(Boolean(data.interface_applied));
			setRunningRulesPresent(Boolean(data.running_rules_present));
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载规则失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadAcls();
		void loadIfaces();
	}, [loadAcls, loadIfaces]);

	const closeAllAclDrawers = () => {
		setRulesDrawerOpen(false);
		setApplyDrawerOpen(false);
		setInterfaceApplyModalOpen(false);
		setInterfaceUnbindModalOpen(false);
	};

	const openRulesDrawer = (id: string) => {
		setAclId(id);
		closeAllAclDrawers();
		setRulesDrawerOpen(true);
		void loadRules(id);
	};

	const openApplyDrawer = (id: string) => {
		setAclId(id);
		closeAllAclDrawers();
		setApplyDrawerOpen(true);
		void loadRules(id);
		void loadIfaces();
	};

	const rawDrawerExtra =
		aclId !== '' ? (
			<Button type="link" size="small" onClick={() => setRawDrawerOpen(true)}>
				查看原始输出
			</Button>
		) : null;

	const drawerStyles = { body: { paddingTop: 12, paddingBottom: 16 } } as const;

	const handleCommit = async () => {
		if (!aclId) return;
		try {
			await api.post('/forwarding/acl/commit', { acl_id: aclId });
			message.success('已 commit');
		} catch (e) {
			message.error(e instanceof Error ? e.message : '失败');
		}
	};

	const handleNoCommit = async () => {
		if (!aclId) return;
		try {
			await api.post('/forwarding/acl/no_commit', { acl_id: aclId });
			message.success('已 no commit');
		} catch (e) {
			message.error(e instanceof Error ? e.message : '失败');
		}
	};

	const ruleCols: ColumnsType<RuleRow> = [
		{ title: '序号', dataIndex: 'rule_id', width: 88 },
		{ title: '动作', dataIndex: 'action', width: 96 },
		{ title: '详情', dataIndex: 'details', ellipsis: true },
		{
			title: '操作',
			key: 'd',
			width: 88,
			render: (_, row) => (
				<Button
					type="link"
					danger
					size="small"
					onClick={async () => {
						try {
							await api.delete('/forwarding/acl/rule', { data: { acl_id: aclId, rule_id: row.rule_id } });
							message.success('已删除规则');
							void loadRules(aclId);
						} catch (e) {
							message.error(e instanceof Error ? e.message : '删除失败');
						}
					}}
				>
					删除
				</Button>
			),
		},
	];

	const bindCols: ColumnsType<IfBind> = [
		{ title: '接口', dataIndex: 'interface', ellipsis: true },
		{ title: '方向', dataIndex: 'direction', width: 96 },
	];

	const bindTablePlain = (
		<Table
			rowKey={(r) => r.interface + r.direction}
			size="middle"
			columns={bindCols}
			dataSource={applied}
			pagination={false}
			scroll={{ x: 'max-content' }}
			locale={{ emptyText: '暂无绑定' }}
		/>
	);

	const submitCreateAclModal = async () => {
		try {
			const v = await createAclForm.validateFields();
			const id = String(v.acl_id ?? '').trim();
			if (!id) {
				message.warning('请输入 ACL 编号');
				return;
			}
			setCreateAclSubmitting(true);
			await api.post('/forwarding/acl', { acl_id: id });
			message.success('已创建');
			createAclForm.resetFields();
			setCreateAclModalOpen(false);
			void loadAcls();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(e instanceof Error ? e.message : '创建失败');
		} finally {
			setCreateAclSubmitting(false);
		}
	};

	const submitAddRuleModal = async () => {
		if (!aclId) return;
		const v = await ruleModalForm.validateFields();
		const protoTrim = (v.proto ?? '').trim();
		const sportT = (v.sport ?? '').trim();
		const dportT = (v.dport ?? '').trim();
		if ((protoTrim === 'tcp' || protoTrim === 'udp') && !sportT && !dportT) {
			const go = await new Promise<boolean>((resolve) => {
				Modal.confirm({
					title: '确认提交',
					content: '协议已指定但端口为空，确定要提交吗？（与 v1 转发页一致）',
					okText: '确定',
					cancelText: '取消',
					onOk: () => resolve(true),
					onCancel: () => resolve(false),
				});
			});
			if (!go) return;
		}
		setRuleModalSubmitting(true);
		try {
			// 与 vrlocalctl forwarding.js 一致：proto 空串表示「IP（全部）」，由服务端按 v1 转为 ip
			await api.post('/forwarding/acl/rule', {
				acl_id: aclId,
				rule_id: (v.rule_id ?? '').trim(),
				match_action: v.match_action,
				proto: (v.proto ?? '').trim(),
				source: (v.source ?? '').trim(),
				destination: (v.destination ?? '').trim(),
				sport: (v.sport ?? '').trim(),
				dport: (v.dport ?? '').trim(),
			});
			message.success('已下发规则');
			ruleModalForm.resetFields();
			setRuleModalOpen(false);
			void loadRules(aclId);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '失败');
		} finally {
			setRuleModalSubmitting(false);
		}
	};

	const submitInterfaceApplyModal = async () => {
		if (!aclId) return;
		try {
			const v = await applyForm.validateFields();
			setInterfaceApplySubmitting(true);
			await api.post('/forwarding/acl/apply', {
				interface: v.interface,
				acl_id: aclId,
				if_direction: v.if_direction || 'input',
			});
			message.success('已应用');
			setInterfaceApplyModalOpen(false);
			applyForm.resetFields();
			void loadRules(aclId);
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(e instanceof Error ? e.message : '失败');
		} finally {
			setInterfaceApplySubmitting(false);
		}
	};

	const submitInterfaceUnbindModal = async () => {
		if (!aclId) return;
		try {
			const v = await unapplyForm.validateFields();
			setInterfaceUnbindSubmitting(true);
			await api.post('/forwarding/acl/unapply', {
				interface: v.interface,
				acl_id: aclId,
				if_direction: v.if_direction || 'input',
			});
			message.success('已解除');
			setInterfaceUnbindModalOpen(false);
			unapplyForm.resetFields();
			void loadRules(aclId);
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(e instanceof Error ? e.message : '失败');
		} finally {
			setInterfaceUnbindSubmitting(false);
		}
	};

	const rulesDrawerBody = (
		<Spin spinning={loading}>
			<Space direction="vertical" size={16} style={{ width: '100%' }}>
				<DrawerIntro>
					当配置状态为「Committed」（规则已写入设备）时，不能直接添加新规则。请先点击抽屉底部的「No commit」进入可编辑状态，再添加或修改规则；确认无误后点击「Commit」保存到设备。若不想保留本次未提交的修改，也可通过「No commit」放弃。
				</DrawerIntro>
				<Divider style={{ margin: 0 }} />
				<Space align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
					<Typography.Text>
						<Typography.Text type="secondary">配置状态：</Typography.Text> {configStatus || '—'}
						<Typography.Text type="secondary" style={{ marginLeft: 12 }}>
							（running 内已有规则：{runningRulesPresent ? '是' : '否'}；已绑接口：{interfaceApplied ? '是' : '否'}）
						</Typography.Text>
					</Typography.Text>
					<Button type="primary" onClick={() => setRuleModalOpen(true)}>
						添加规则
					</Button>
				</Space>
				<Table
					rowKey={(r) => r.rule_id + r.raw}
					size="middle"
					columns={ruleCols}
					dataSource={rules}
					pagination={false}
					scroll={{ x: 'max-content' }}
					locale={{ emptyText: '暂无规则' }}
				/>
			</Space>
		</Spin>
	);

	const interfaceDrawerBody = (
		<Spin spinning={loading}>
			<Space direction="vertical" size={16} style={{ width: '100%' }}>
				<DrawerIntro>
					下表为设备上当前已绑定本 ACL 的接口与方向。需要新增绑定或解除绑定时，点击右侧按钮，在弹窗中填写接口与方向后下发。
				</DrawerIntro>
				<Divider style={{ margin: 0 }} />
				<Space align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
					<Typography.Text>
						<Typography.Text type="secondary">当前绑定：</Typography.Text> {applied.length} 处
					</Typography.Text>
					<Space wrap size={8}>
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
					</Space>
				</Space>
				{bindTablePlain}
			</Space>
		</Spin>
	);

	const rulesDrawerFooter = (
		<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
			<Button type="primary" onClick={() => void handleCommit()}>
				Commit
			</Button>
			<Button onClick={() => void handleNoCommit()}>No commit</Button>
		</div>
	);

	return (
		<>
			<PageStack>
				<PageHeader
					title="ACL 管理"
					description="创建和管理 ACL 规则，并绑定到接口。"
				/>
				<TableBlock
					title="ACL 列表"
					action={
						<>
							<Button type="primary" onClick={() => setCreateAclModalOpen(true)}>
								创建 ACL
							</Button>
							<Button onClick={() => void loadAcls()}>刷新</Button>
						</>
					}
					rowKey="id"
					columns={[
						{ title: 'ACL ID', dataIndex: 'id' },
						{ title: '引用次数', dataIndex: 'count', width: 100 },
						{
							title: '操作',
							key: 'o',
							width: 280,
							render: (_, row) => (
								<Space wrap size={0}>
									<Button type="link" size="small" onClick={() => openRulesDrawer(row.id)}>
										规则配置
									</Button>
									<Button type="link" size="small" onClick={() => openApplyDrawer(row.id)}>
										应用到接口
									</Button>
									<Button
										type="link"
										danger
										size="small"
										onClick={async () => {
											try {
												await api.delete('/forwarding/acl', { data: { acl_id: row.id } });
												message.success('已删除');
												if (aclId === row.id) {
													closeAllAclDrawers();
													setAclId('');
												}
												void loadAcls();
											} catch (e) {
												message.error(e instanceof Error ? e.message : '删除失败');
											}
										}}
									>
										删除
									</Button>
								</Space>
							),
						},
					]}
					dataSource={acls}
					paginated={false}
				/>
			</PageStack>

			<Drawer
				title={aclId ? `规则配置 — ACL ${aclId}` : '规则配置'}
				width={DRAWER_WIDTH_ACL}
				zIndex={Z_DRAWER_ACL_DETAIL}
				open={rulesDrawerOpen}
				onClose={() => setRulesDrawerOpen(false)}
				destroyOnClose={false}
				styles={drawerStyles}
				extra={rawDrawerExtra}
				footer={aclId ? rulesDrawerFooter : null}
			>
				{aclId ? rulesDrawerBody : null}
			</Drawer>

			<Drawer
				title={aclId ? `应用到接口 — ACL ${aclId}` : '应用到接口'}
				width={DRAWER_WIDTH_ACL}
				zIndex={Z_DRAWER_ACL_DETAIL}
				open={applyDrawerOpen}
				onClose={() => {
					setApplyDrawerOpen(false);
					setInterfaceApplyModalOpen(false);
					setInterfaceUnbindModalOpen(false);
				}}
				destroyOnClose={false}
				styles={drawerStyles}
				extra={rawDrawerExtra}
			>
				{aclId ? interfaceDrawerBody : null}
			</Drawer>

			<Drawer
				title={aclId ? `原始输出 — ACL ${aclId}` : '原始输出 — ACL'}
				width={880}
				zIndex={Z_DRAWER_ACL_RAW}
				open={rawDrawerOpen}
				onClose={() => setRawDrawerOpen(false)}
				destroyOnClose={false}
				styles={drawerStyles}
			>
				<Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
					以下为当前 ACL 规则与引用接口相关命令回显，与表格解析结果对照排障。
				</Typography.Paragraph>
				<pre
					style={{
						background: '#f8fafc',
						border: '1px solid rgba(0,0,0,0.06)',
						borderRadius: 8,
						padding: 12,
						fontSize: 12,
						fontFamily: 'monospace',
						whiteSpace: 'pre-wrap',
						wordBreak: 'break-all',
						minHeight: 200,
						maxHeight: 'calc(100vh - 220px)',
						overflow: 'auto',
						margin: 0,
					}}
				>
					{rawOut.trim() ? rawOut : '（暂无，请先打开上述任一抽屉并等待加载完成）'}
				</pre>
			</Drawer>

			<Modal
				title="创建 ACL"
				open={createAclModalOpen}
				width={440}
				okText="创建"
				cancelText="取消"
				confirmLoading={createAclSubmitting}
				onCancel={() => {
					setCreateAclModalOpen(false);
					createAclForm.resetFields();
				}}
				onOk={() => void submitCreateAclModal()}
				destroyOnClose
				maskClosable={false}
			>
				<Form form={createAclForm} layout="vertical" preserve={false}>
					<Form.Item name="acl_id" label="ACL 编号" rules={[{ required: true, message: '请输入 ACL 编号' }]}>
						<Input placeholder="例如 2000、2222（与设备策略一致）" allowClear />
					</Form.Item>
				</Form>
			</Modal>

			<Modal
				title="添加规则"
				open={ruleModalOpen}
				width={560}
				okText="确定添加"
				cancelText="取消"
				confirmLoading={ruleModalSubmitting}
				onCancel={() => {
					setRuleModalOpen(false);
					ruleModalForm.resetFields();
				}}
				onOk={() => submitAddRuleModal()}
				destroyOnClose
				maskClosable={false}
			>
				<Form form={ruleModalForm} layout="vertical" preserve={false} initialValues={{ match_action: 'permit', proto: '' }}>
					<Form.Item name="rule_id" label="序号（可选）">
						<Input placeholder="例如 10，与 v1 一致可留空由设备分配" />
					</Form.Item>
					<Form.Item name="match_action" label="动作" rules={[{ required: true, message: '请选择动作' }]}>
						<Select options={[{ value: 'permit', label: 'Permit（允许）' }, { value: 'deny', label: 'Deny（拒绝）' }]} />
					</Form.Item>
					<Form.Item name="proto" label="协议">
						<Select
							options={[
								{ value: '', label: 'IP（全部）' },
								{ value: 'ip', label: 'ip' },
								{ value: 'tcp', label: 'TCP' },
								{ value: 'udp', label: 'UDP' },
								{ value: 'icmp', label: 'ICMP' },
							]}
						/>
					</Form.Item>
					<Form.Item name="source" label="源地址（CIDR）" rules={[{ required: true, message: '请输入源' }]}>
						<Input placeholder="例如 10.1.1.0/24 或 any" />
					</Form.Item>
					<Form.Item name="destination" label="目的地址（CIDR）" rules={[{ required: true, message: '请输入目的' }]}>
						<Input placeholder="例如 any" />
					</Form.Item>
					<Form.Item noStyle shouldUpdate={(p, c) => (p?.proto ?? '') !== (c?.proto ?? '')}>
						{() => {
							const p = ruleModalForm.getFieldValue('proto') as string;
							const portProto = p === 'tcp' || p === 'udp';
							return (
								<>
									<Form.Item name="sport" label="源端口（可选）">
										<Input disabled={!portProto} placeholder={portProto ? '例如 80 或 1000-2000' : '仅 TCP/UDP 可填'} />
									</Form.Item>
									<Form.Item name="dport" label="目的端口（可选）">
										<Input disabled={!portProto} placeholder={portProto ? '例如 80' : '仅 TCP/UDP 可填'} />
									</Form.Item>
								</>
							);
						}}
					</Form.Item>
				</Form>
			</Modal>

			<Modal
				title={aclId ? `应用到接口 — ACL ${aclId}` : '应用到接口'}
				open={interfaceApplyModalOpen}
				okText="确定"
				cancelText="取消"
				confirmLoading={interfaceApplySubmitting}
				onCancel={() => {
					setInterfaceApplyModalOpen(false);
					applyForm.resetFields();
				}}
				onOk={() => void submitInterfaceApplyModal()}
				destroyOnClose
				maskClosable={false}
				width={480}
			>
				<Form form={applyForm} layout="vertical" requiredMark="optional" preserve={false}>
					<Form.Item name="interface" label="接口" rules={[{ required: true, message: '请选择接口' }]}>
						<Select
							showSearch
							allowClear
							options={ifaces.map((x) => ({ value: x, label: x }))}
							placeholder="选择要绑定的接口"
							style={{ width: '100%' }}
						/>
					</Form.Item>
					<Form.Item name="if_direction" label="方向" initialValue="input">
						<Select
							options={[
								{ value: 'input', label: '入站（in）' },
								{ value: 'output', label: '出站（out）' },
							]}
							style={{ width: '100%' }}
						/>
					</Form.Item>
				</Form>
			</Modal>

			<Modal
				title={aclId ? `从接口解绑 — ACL ${aclId}` : '从接口解绑'}
				open={interfaceUnbindModalOpen}
				okText="确定解除"
				cancelText="取消"
				okButtonProps={{ danger: true }}
				confirmLoading={interfaceUnbindSubmitting}
				onCancel={() => {
					setInterfaceUnbindModalOpen(false);
					unapplyForm.resetFields();
				}}
				onOk={() => void submitInterfaceUnbindModal()}
				destroyOnClose
				maskClosable={false}
				width={480}
			>
				<Form form={unapplyForm} layout="vertical" requiredMark="optional" preserve={false}>
					<Form.Item name="interface" label="接口" rules={[{ required: true, message: '请选择接口' }]}>
						<Select
							showSearch
							allowClear
							options={ifaces.map((x) => ({ value: x, label: x }))}
							placeholder="选择要解除绑定的接口"
							style={{ width: '100%' }}
						/>
					</Form.Item>
					<Form.Item name="if_direction" label="方向" initialValue="input">
						<Select
							options={[
								{ value: 'input', label: '入站（in）' },
								{ value: 'output', label: '出站（out）' },
							]}
							style={{ width: '100%' }}
						/>
					</Form.Item>
				</Form>
			</Modal>
		</>
	);
}
