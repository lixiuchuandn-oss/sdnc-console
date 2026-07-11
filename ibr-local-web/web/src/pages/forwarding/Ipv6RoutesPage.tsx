import { EllipsisOutlined } from '@ant-design/icons';
import { Button, Drawer, Dropdown, Form, Input, Modal, Spin, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { BlockHeader } from '../../components/BlockHeader';
import { Card } from '../../components/Card';
import { ContentBlock } from '../../components/ContentBlock';
import { DataTable, TableFooter, useDataTablePage } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { StatusDot } from '../../components/StatusDot';

type RouteRow = { raw: string; protocol: string; prefix: string; next_hop: string; interface: string };

export function Ipv6RoutesPage() {
	const [loading, setLoading] = useState(false);
	const [routes, setRoutes] = useState<RouteRow[]>([]);
	const [raw, setRaw] = useState('');
	const [rawDrawerOpen, setRawDrawerOpen] = useState(false);
	const [modalOpen, setModalOpen] = useState(false);
	const [form] = Form.useForm();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ routes: RouteRow[]; raw_output: string }>('/forwarding/routes/ipv6');
			setRoutes(data.routes ?? []);
			setRaw(data.raw_output ?? '');
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const columns: ColumnsType<RouteRow> = [
		{ title: '协议', dataIndex: 'protocol', width: 88 },
		{ title: '前缀', dataIndex: 'prefix', ellipsis: true },
		{ title: '下一跳', dataIndex: 'next_hop', ellipsis: true },
		{ title: '接口', dataIndex: 'interface', ellipsis: true },
		{
			title: '状态',
			key: 'status',
			width: 110,
			render: (_, row) =>
				row.next_hop === 'Connected' ? (
					<StatusDot active={false} label="Connected" />
				) : (
					<StatusDot label="Active" />
				),
		},
		{
			title: '',
			key: 'actions',
			width: 48,
			align: 'right',
			render: (_, row) => {
				const canDelete = Boolean(row.prefix && row.next_hop && row.next_hop !== 'Connected');
				const items: MenuProps['items'] = [
					{
						key: 'delete',
						label: '删除',
						danger: true,
						disabled: !canDelete,
						onClick: async () => {
							try {
								await api.delete('/forwarding/routes/ipv6', { data: { dst: row.prefix, gw: row.next_hop } });
								message.success('已删除');
								void load();
							} catch (e) {
								message.error(e instanceof Error ? e.message : '删除失败');
							}
						},
					},
				];
				return (
					<div className="app-row-actions">
						<Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
							<Button type="text" size="small" icon={<EllipsisOutlined />} aria-label="更多操作" />
						</Dropdown>
					</div>
				);
			},
		},
	];

	const add = async () => {
		try {
			const v = await form.validateFields();
			await api.post('/forwarding/routes/ipv6', { dst: v.dst, gw: v.gw, vrf_id: v.vrf_id || '' });
			message.success('已添加');
			setModalOpen(false);
			form.resetFields();
			void load();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in (e as object)) return;
			message.error(e instanceof Error ? e.message : '添加失败');
		}
	};

	const { page, setPage, pageData, total } = useDataTablePage(routes, 10);

	return (
		<>
			<PageStack>
				<PageHeader title="IPv6 路由" description="查看、新增和删除 IPv6 静态路由。" />

				<ContentBlock>
					<BlockHeader
						title="路由条目"
						action={
							<>
								<Button type="default" onClick={() => void load()}>
									刷新
								</Button>
								<Button type="primary" onClick={() => setModalOpen(true)}>
									添加
								</Button>
							</>
						}
					/>
					<Card variant="table">
						<Spin spinning={loading}>
							<DataTable showPagination={false} rowKey={(r) => r.raw} columns={columns} dataSource={pageData} scroll={{ x: true }} />
						</Spin>
					</Card>
					<TableFooter total={total} page={page} pageSize={10} onChange={setPage} />
				</ContentBlock>

				<ContentBlock>
					<BlockHeader
						title="原始输出"
						action={
							<Button type="default" onClick={() => setRawDrawerOpen(true)}>
								展开
							</Button>
						}
					/>
					<Card variant="padded">
						<pre className="app-code-block app-code-block-inset">{raw.trim() ? `${raw.trim().slice(0, 400)}${raw.length > 400 ? '…' : ''}` : '—'}</pre>
					</Card>
				</ContentBlock>
			</PageStack>

			<Drawer title="原始输出 — show ipv6 route" width={720} open={rawDrawerOpen} onClose={() => setRawDrawerOpen(false)}>
				<pre className="app-code-block app-code-block-full">{raw.trim() ? raw : '—'}</pre>
			</Drawer>

			<Modal title="添加 IPv6 路由" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void add()} destroyOnClose>
				<Form form={form} layout="vertical">
					<Form.Item label="目的前缀" name="dst" rules={[{ required: true }]}>
						<Input placeholder="2001:db8::/64" />
					</Form.Item>
					<Form.Item label="下一跳" name="gw" rules={[{ required: true }]}>
						<Input placeholder="2001:db8::1" />
					</Form.Item>
					<Form.Item label="VRF ID（可选）" name="vrf_id">
						<Input />
					</Form.Item>
				</Form>
			</Modal>
		</>
	);
}
