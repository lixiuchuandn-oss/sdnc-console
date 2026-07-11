import {
	Button,
	Card,
	Col,
	Descriptions,
	Divider,
	Drawer,
	Form,
	Input,
	InputNumber,
	Modal,
	Row,
	Space,
	Spin,
	Switch,
	Tag,
	Typography,
	message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { TableBlock } from '../../components/TableBlock';

type NatEntry = {
	id: string;
	type: string;
	proto: string;
	inside_ip: string;
	inside_port: number | null;
	outside_ip: string;
	outside_port: number | null;
	vrf_id: string;
	range_start: string;
	range_end: string;
};

type NatGlobal = {
	enabled: boolean;
	wan_if: string;
	group_id: number;
	use_wan_ip_as_pool: boolean;
	group_exists: boolean;
};

/** 三页共用的 NAT 全局配置抽屉（本文件内私有） */
function NatGlobalConfigDrawer(props: { open: boolean; onClose: () => void }) {
	const [loading, setLoading] = useState(false);
	const [g, setG] = useState<NatGlobal | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ global: NatGlobal }>('/forwarding/nat/status');
			setG(data.global);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载 NAT 状态失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (props.open) void load();
	}, [props.open, load]);

	const enable = async () => {
		try {
			await api.post('/forwarding/nat/enable', { wan_if: g?.wan_if ?? '', use_wan_ip_as_pool: g?.use_wan_ip_as_pool !== false });
			message.success('已下发启用 NAT');
			void load();
		} catch (e) {
			message.error(e instanceof Error ? e.message : '启用失败');
		}
	};

	const disable = async () => {
		try {
			await api.post('/forwarding/nat/disable');
			message.success('已下发关闭 NAT');
			void load();
		} catch (e) {
			message.error(e instanceof Error ? e.message : '关闭失败');
		}
	};

	const toggleWanIp = async (checked: boolean) => {
		try {
			await api.post('/forwarding/nat/use_wan_ip', { enabled: checked });
			message.success('已更新 SNAT 地址池策略');
			void load();
		} catch (e) {
			message.error(e instanceof Error ? e.message : '更新失败');
		}
	};

	return (
		<Drawer title="NAT 全局配置" width={640} open={props.open} onClose={props.onClose} destroyOnClose>
			<div style={{ width: '100%' }}>
				<Spin spinning={loading}>
					{g ? (
						<Space direction="vertical" size={0} style={{ width: '100%' }}>
							<Descriptions bordered size="small" column={1} labelStyle={{ width: 160, whiteSpace: 'nowrap' }}>
								<Descriptions.Item label="NAT 运行状态">
									{g.enabled ? <Tag color="success">已启用</Tag> : <Tag>未启用</Tag>}
									<Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
										（地址组已存在且 WAN 口已启用外网侧 NAT）
									</Typography.Text>
								</Descriptions.Item>
								<Descriptions.Item label="WAN 外网口">
									<Typography.Text code style={{ wordBreak: 'break-all' }}>
										{g.wan_if || '—'}
									</Typography.Text>
								</Descriptions.Item>
								<Descriptions.Item label="NAT 地址组 ID">{g.group_id}</Descriptions.Item>
								<Descriptions.Item label="地址组是否已存在">
									{g.group_exists ? <Tag color="processing">是</Tag> : <Tag>否</Tag>}
								</Descriptions.Item>
							</Descriptions>

							<Divider style={{ margin: '24px 0' }} />

							<Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
								下发操作
							</Typography.Title>
							<Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
								启用后会在设备上创建或挂载 NAT 地址组，并在 WAN 外网口启用外网侧 NAT；关闭将撤销上述配置。仅在 NAT 已启用时，可调整是否使用 WAN 口公网 IP 作为 SNAT 地址池。
							</Typography.Paragraph>
							<Space wrap size={12}>
								<Button type="primary" onClick={() => void enable()} disabled={g.enabled}>
									启用 NAT
								</Button>
								<Button onClick={() => void load()} type="default">
									刷新状态
								</Button>
								<Button danger onClick={() => void disable()} disabled={!g.enabled}>
									关闭 NAT
								</Button>
							</Space>

							<Card size="small" title="SNAT 地址池策略" style={{ marginTop: 20 }}>
								<Row gutter={[16, 12]} align="middle">
									<Col xs={24} sm={16}>
										<Typography.Text>
											使用 WAN 口公网 IP 作为 SNAT 源（与地址池二选一策略，具体以设备为准）
										</Typography.Text>
									</Col>
									<Col xs={24} sm={8}>
										<Switch
											checked={g.use_wan_ip_as_pool}
											onChange={(c) => void toggleWanIp(c)}
											disabled={!g.enabled}
											checkedChildren="开"
											unCheckedChildren="关"
										/>
									</Col>
								</Row>
							</Card>
						</Space>
					) : (
						<Typography.Text type="secondary">暂无数据</Typography.Text>
					)}
				</Spin>
			</div>
		</Drawer>
	);
}

/** DNAT：外网端口映射到内网服务 */
export function NatDnatPage() {
	const [loading, setLoading] = useState(false);
	const [entries, setEntries] = useState<NatEntry[]>([]);
	const [modalOpen, setModalOpen] = useState(false);
	const [globalDrawerOpen, setGlobalDrawerOpen] = useState(false);
	const [form] = Form.useForm();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ entries: NatEntry[] }>('/forwarding/nat/entries');
			setEntries((data.entries ?? []).filter((e) => (e.type || '').toUpperCase() === 'DNAT'));
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载条目失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const columns: ColumnsType<NatEntry> = [
		{ title: '编号', dataIndex: 'id', width: 72 },
		{ title: '协议', dataIndex: 'proto', width: 80 },
		{ title: '内网 IP', dataIndex: 'inside_ip' },
		{ title: '内网端口', dataIndex: 'inside_port', width: 100 },
		{ title: '外网 IP', dataIndex: 'outside_ip' },
		{ title: '外网端口', dataIndex: 'outside_port', width: 110 },
		{ title: 'VRF', dataIndex: 'vrf_id', width: 80 },
		{
			title: '操作',
			key: 'act',
			width: 100,
			render: (_, row) => (
				<Button
					type="link"
					danger
					size="small"
					onClick={async () => {
						try {
							await api.delete(`/forwarding/nat/entry/${row.id}`);
							message.success('已删除');
							void load();
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

	const submit = async () => {
		try {
			const v = await form.validateFields();
			await api.post('/forwarding/nat/entry', {
				type: 'DNAT',
				inside_ip: v.inside_ip,
				outside_ip: v.outside_ip,
				proto: v.proto || 'tcp',
				vrf_id: v.vrf_id || '',
				inside_port: v.inside_port,
				outside_port: v.outside_port,
			});
			message.success('已创建');
			setModalOpen(false);
			form.resetFields();
			void load();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(e instanceof Error ? e.message : '创建失败');
		}
	};

	return (
		<>
			<PageStack>
				<PageHeader title="DNAT" description="配置端口映射，将外网访问转发到内网服务。" />
				<TableBlock
					title="DNAT 条目"
					action={
						<>
							<Button type="primary" onClick={() => setModalOpen(true)}>
								新增
							</Button>
							<Button onClick={() => setGlobalDrawerOpen(true)}>全局配置</Button>
						</>
					}
					loading={loading}
					rowKey="id"
					columns={columns}
					dataSource={entries}
					paginated={false}
					scroll={{ x: true }}
				/>
			</PageStack>
			<NatGlobalConfigDrawer open={globalDrawerOpen} onClose={() => setGlobalDrawerOpen(false)} />
			<Modal title="新增 DNAT 端口映射" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void submit()} destroyOnClose>
				<Form form={form} layout="vertical">
					<Form.Item name="inside_ip" label="内网 IP" rules={[{ required: true }]}>
						<Input placeholder="内网侧地址" />
					</Form.Item>
					<Form.Item name="outside_ip" label="外网 IP" rules={[{ required: true }]}>
						<Input placeholder="外网侧地址" />
					</Form.Item>
					<Form.Item name="proto" label="协议" initialValue="tcp">
						<Input placeholder="如 ip、tcp、udp" />
					</Form.Item>
					<Form.Item name="vrf_id" label="VRF（可选）">
						<Input placeholder="留空表示默认" />
					</Form.Item>
					<Form.Item name="inside_port" label="内网端口" rules={[{ required: true }]}>
						<InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="内网侧端口" />
					</Form.Item>
					<Form.Item name="outside_port" label="外网端口" rules={[{ required: true }]}>
						<InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="外网侧端口" />
					</Form.Item>
				</Form>
			</Modal>
		</>
	);
}

/** SNAT：源地址转换地址池 */
export function NatSnatPage() {
	const [loading, setLoading] = useState(false);
	const [entries, setEntries] = useState<NatEntry[]>([]);
	const [modalOpen, setModalOpen] = useState(false);
	const [globalDrawerOpen, setGlobalDrawerOpen] = useState(false);
	const [form] = Form.useForm();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ entries: NatEntry[] }>('/forwarding/nat/entries');
			setEntries((data.entries ?? []).filter((e) => (e.type || '').toUpperCase() === 'SNAT'));
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载条目失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const columns: ColumnsType<NatEntry> = [
		{ title: '编号', dataIndex: 'id', width: 72 },
		{ title: '协议', dataIndex: 'proto', width: 80 },
		{ title: '起始', dataIndex: 'range_start' },
		{ title: '结束', dataIndex: 'range_end' },
		{
			title: '操作',
			key: 'act',
			width: 100,
			render: (_, row) => (
				<Button
					type="link"
					danger
					size="small"
					onClick={async () => {
						try {
							await api.delete(`/forwarding/nat/entry/${row.id}`);
							message.success('已删除');
							void load();
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

	const submit = async () => {
		try {
			const v = await form.validateFields();
			await api.post('/forwarding/nat/entry', {
				type: 'SNAT',
				range_start: v.range_start,
				range_end: v.range_end,
			});
			message.success('已创建');
			setModalOpen(false);
			form.resetFields();
			void load();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(e instanceof Error ? e.message : '创建失败');
		}
	};

	return (
		<>
			<PageStack>
				<PageHeader title="SNAT" description="配置源地址转换的地址池范围。" />
				<TableBlock
					title="SNAT 条目"
					action={
						<>
							<Button type="primary" onClick={() => setModalOpen(true)}>
								新增
							</Button>
							<Button onClick={() => setGlobalDrawerOpen(true)}>全局配置</Button>
						</>
					}
					loading={loading}
					rowKey="id"
					columns={columns}
					dataSource={entries}
					paginated={false}
					scroll={{ x: true }}
				/>
			</PageStack>
			<NatGlobalConfigDrawer open={globalDrawerOpen} onClose={() => setGlobalDrawerOpen(false)} />
			<Modal title="新增 SNAT 地址池" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void submit()} destroyOnClose>
				<Form form={form} layout="vertical">
					<Form.Item name="range_start" label="起始 IP" rules={[{ required: true }]}>
						<Input placeholder="10.0.0.1" />
					</Form.Item>
					<Form.Item name="range_end" label="结束 IP" rules={[{ required: true }]}>
						<Input placeholder="10.0.0.254" />
					</Form.Item>
				</Form>
			</Modal>
		</>
	);
}

/** 静态 NAT：内外网一对一地址映射 */
export function NatStaticPage() {
	const [loading, setLoading] = useState(false);
	const [entries, setEntries] = useState<NatEntry[]>([]);
	const [modalOpen, setModalOpen] = useState(false);
	const [globalDrawerOpen, setGlobalDrawerOpen] = useState(false);
	const [form] = Form.useForm();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ entries: NatEntry[] }>('/forwarding/nat/entries');
			setEntries((data.entries ?? []).filter((e) => (e.type || '').toUpperCase() === 'STATIC'));
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载条目失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const columns: ColumnsType<NatEntry> = [
		{ title: '编号', dataIndex: 'id', width: 72 },
		{ title: '协议', dataIndex: 'proto', width: 80 },
		{ title: '内网 IP', dataIndex: 'inside_ip' },
		{ title: '内网端口', dataIndex: 'inside_port', width: 100 },
		{ title: '外网 IP', dataIndex: 'outside_ip' },
		{ title: '外网端口', dataIndex: 'outside_port', width: 110 },
		{ title: 'VRF', dataIndex: 'vrf_id', width: 80 },
		{
			title: '操作',
			key: 'act',
			width: 100,
			render: (_, row) => (
				<Button
					type="link"
					danger
					size="small"
					onClick={async () => {
						try {
							await api.delete(`/forwarding/nat/entry/${row.id}`);
							message.success('已删除');
							void load();
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

	const submit = async () => {
		try {
			const v = await form.validateFields();
			await api.post('/forwarding/nat/entry', {
				type: 'STATIC',
				inside_ip: v.inside_ip,
				outside_ip: v.outside_ip,
				proto: v.proto || 'ip',
				vrf_id: v.vrf_id || '',
			});
			message.success('已创建');
			setModalOpen(false);
			form.resetFields();
			void load();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(e instanceof Error ? e.message : '创建失败');
		}
	};

	return (
		<>
			<PageStack>
				<PageHeader title="静态 NAT" description="维护内网与外网的一对一地址映射。" />
				<TableBlock
					title="静态 NAT 条目"
					action={
						<>
							<Button type="primary" onClick={() => setModalOpen(true)}>
								新增
							</Button>
							<Button onClick={() => setGlobalDrawerOpen(true)}>全局配置</Button>
						</>
					}
					loading={loading}
					rowKey="id"
					columns={columns}
					dataSource={entries}
					paginated={false}
					scroll={{ x: true }}
				/>
			</PageStack>
			<NatGlobalConfigDrawer open={globalDrawerOpen} onClose={() => setGlobalDrawerOpen(false)} />
			<Modal title="新增静态 NAT 条目" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void submit()} destroyOnClose>
				<Form form={form} layout="vertical">
					<Form.Item name="inside_ip" label="内网 IP" rules={[{ required: true }]}>
						<Input placeholder="内网侧地址" />
					</Form.Item>
					<Form.Item name="outside_ip" label="外网 IP" rules={[{ required: true }]}>
						<Input placeholder="外网侧地址" />
					</Form.Item>
					<Form.Item name="proto" label="协议" initialValue="ip">
						<Input placeholder="如 ip、tcp、udp" />
					</Form.Item>
					<Form.Item name="vrf_id" label="VRF（可选）">
						<Input placeholder="留空表示默认" />
					</Form.Item>
				</Form>
			</Modal>
		</>
	);
}
