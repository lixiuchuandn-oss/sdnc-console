import { Button, Form, Input, InputNumber, Modal, Select, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { TableBlock } from '../../components/TableBlock';

type InterfaceDetail = {
	name: string;
	vlan?: number;
	ipv4: string[];
	ipv6: string[];
	vrf?: string;
	status: string;
	is_subinterface: boolean;
	source?: string;
};

export function SubIfPage() {
	const [loading, setLoading] = useState(false);
	const [allIfs, setAllIfs] = useState<InterfaceDetail[]>([]);
	const [modalOpen, setModalOpen] = useState(false);
	const [form] = Form.useForm();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ interfaces: InterfaceDetail[] }>('/forwarding/interfaces/detail');
			setAllIfs(data.interfaces ?? []);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const subIfs = useMemo(() => allIfs.filter((i) => i.is_subinterface), [allIfs]);
	const parents = useMemo(() => allIfs.filter((i) => !i.is_subinterface).map((i) => i.name), [allIfs]);

	const columns: ColumnsType<InterfaceDetail> = [
		{ title: '接口名', dataIndex: 'name', ellipsis: true },
		{ title: 'VLAN', dataIndex: 'vlan', width: 80, render: (v) => (v != null ? v : '—') },
		{
			title: 'IPv4',
			dataIndex: 'ipv4',
			ellipsis: true,
			render: (v: string[]) => (v?.length ? v.join(', ') : '—'),
		},
		{
			title: 'IPv6',
			dataIndex: 'ipv6',
			ellipsis: true,
			render: (v: string[]) => (v?.length ? v.join(', ') : '—'),
		},
		{ title: 'VRF', dataIndex: 'vrf', width: 90, render: (v) => v || '—' },
		{
			title: '状态',
			dataIndex: 'status',
			width: 90,
			render: (s: string) => <Tag color={s === 'up' ? 'green' : s === 'down' ? 'red' : 'default'}>{s}</Tag>,
		},
		{
			title: '来源',
			dataIndex: 'source',
			width: 90,
			render: (s: string) => (s === 'cloud' ? '云平台' : s === 'both' ? '云+本地' : '本地'),
		},
		{
			title: '操作',
			key: 'op',
			width: 100,
			render: (_, row) => (
				<Button
					size="small"
					danger
					onClick={async () => {
						try {
							await api.delete(`/forwarding/interfaces/sub/${encodeURIComponent(row.name)}`);
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

	const save = async () => {
		try {
			const v = await form.validateFields();
			const parent = String(v.parent ?? '').trim();
			const vlan = Number(v.vlan);
			const name =
				v.mode === 'manual' && v.name?.trim()
					? String(v.name).trim()
					: parent && vlan
						? `${parent.replace(/\.\d+$/, '')}.${vlan}`
						: '';
			if (!name) {
				message.error('请填写接口名或选择父接口+VLAN');
				return;
			}
			await api.post('/forwarding/interfaces/sub', {
				name,
				vlan: vlan || undefined,
				ipv4_static: v.ipv4_static?.trim(),
				ipv6_static: v.ipv6_static?.trim(),
				vrf: v.vrf?.trim(),
				status: v.status || 'up',
			});
			message.success('已应用子接口配置');
			setModalOpen(false);
			form.resetFields();
			void load();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in (e as object)) return;
			message.error(e instanceof Error ? e.message : '保存失败');
		}
	};

	return (
		<>
			<PageStack>
				<PageHeader
					title="VLAN 子接口"
					description="创建和管理 VLAN 子接口及其 IP 地址。"
				/>
				<TableBlock
					title="子接口列表"
					action={
						<>
							<Button type="primary" onClick={() => setModalOpen(true)}>
								新建子接口
							</Button>
							<Button onClick={() => void load()}>刷新</Button>
						</>
					}
					loading={loading}
					rowKey="name"
					columns={columns}
					dataSource={subIfs}
					pageSize={15}
					scroll={{ x: true }}
				/>
			</PageStack>

			<Modal title="新建子接口" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void save()} width={560} destroyOnClose>
				<Form form={form} layout="vertical" initialValues={{ mode: 'vlan', status: 'up' }}>
					<Form.Item label="创建方式" name="mode">
						<Select
							options={[
								{ value: 'vlan', label: '父接口 + VLAN ID' },
								{ value: 'manual', label: '手动输入完整接口名' },
							]}
						/>
					</Form.Item>
					<Form.Item noStyle shouldUpdate={(p, c) => p.mode !== c.mode}>
						{({ getFieldValue }) =>
							getFieldValue('mode') === 'manual' ? (
								<Form.Item label="接口名" name="name" rules={[{ required: true }]}>
									<Input placeholder="GigabitEthernet 0/5/0.100" />
								</Form.Item>
							) : (
								<>
									<Form.Item label="父接口" name="parent" rules={[{ required: true }]}>
										<Select showSearch options={parents.map((p) => ({ value: p, label: p }))} placeholder="选择物理口" />
									</Form.Item>
									<Form.Item label="VLAN ID" name="vlan" rules={[{ required: true }]}>
										<InputNumber min={1} max={4094} style={{ width: '100%' }} />
									</Form.Item>
								</>
							)
						}
					</Form.Item>
					<Form.Item label="IPv4 地址" name="ipv4_static">
						<Input placeholder="10.10.10.10/24" />
					</Form.Item>
					<Form.Item label="IPv6 地址" name="ipv6_static">
						<Input placeholder="2001:db8::1/64" />
					</Form.Item>
					<Form.Item label="VRF" name="vrf">
						<Input placeholder="可选" />
					</Form.Item>
					<Form.Item label="状态" name="status">
						<Select options={[{ value: 'up', label: 'up (no shutdown)' }, { value: 'down', label: 'down (shutdown)' }]} />
					</Form.Item>
				</Form>
			</Modal>
		</>
	);
}
