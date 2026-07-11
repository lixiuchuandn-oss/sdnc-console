import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EllipsisOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Dropdown, Form, Input, Spin, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { useIbrConsoleWritePermission } from '../lib/useIbrConsoleWritePermission';
import { getApiErrorMessage } from '../../../../../../services/api';
import {
	addIbrForwardingIpv6Route,
	addIbrForwardingRoute,
	deleteIbrForwardingIpv6Route,
	deleteIbrForwardingRoute,
	fetchIbrForwardingIpv6Routes,
	fetchIbrForwardingRoutes,
	type IbrForwardingRouteRow,
} from '../../../../../../services/ibrDeviceOpsApi';
import {
	ConsoleForwardTable,
	FORWARD_TABLE_PAGE_SIZE,
	ConsoleOpsModal,
	ForwardTableFooter,
	ForwardTextDrawer,
	forwardTableEmpty,
	useForwardTablePage,
} from '../lib/forwardPanelUi';
import { IbrConsoleSegmented } from '../components/IbrConsoleSegmented';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

type Props = {
	vrUuid: string;
	managementIp: string;
};

type RouteTab = 'ipv4' | 'ipv6';

const ROUTES_TABS: { id: RouteTab; label: string }[] = [
	{ id: 'ipv4', label: 'IPv4 路由' },
	{ id: 'ipv6', label: 'IPv6 路由' },
];

type AddRouteForm = {
	dst?: string;
	gw?: string;
	vrf_id?: string;
};

function RouteStatusDot({ row }: { row: IbrForwardingRouteRow }) {
	const connected = row.next_hop === 'Connected';
	return (
		<span className="ibr-console-status-dot">
			<span className={`ibr-console-status-dot-mark${connected ? '' : ' is-on'}`} aria-hidden />
			<span>{connected ? 'Connected' : 'Active'}</span>
		</span>
	);
}

export const VrConsoleRoutesPanel: React.FC<Props> = ({ vrUuid, managementIp }) => {
	const canWrite = useIbrConsoleWritePermission('networks.vr-config:write');

	const [activeTab, setActiveTab] = useState<RouteTab>('ipv4');
	const [loading, setLoading] = useState(false);
	const [routes, setRoutes] = useState<IbrForwardingRouteRow[]>([]);
	const [raw, setRaw] = useState('');
	const [rawDrawerOpen, setRawDrawerOpen] = useState(false);
	const [modalOpen, setModalOpen] = useState(false);
	const [form] = Form.useForm<AddRouteForm>();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data =
				activeTab === 'ipv4'
					? await fetchIbrForwardingRoutes(vrUuid, { skipCache: true })
					: await fetchIbrForwardingIpv6Routes(vrUuid, { skipCache: true });
			if (data.error) throw new Error(data.error);
			setRoutes(Array.isArray(data.routes) ? data.routes : []);
			setRaw(typeof data.raw_output === 'string' ? data.raw_output : '');
		} catch (e) {
			message.error(getApiErrorMessage(e, '加载失败'));
			setRoutes([]);
			setRaw('');
		} finally {
			setLoading(false);
		}
	}, [activeTab, vrUuid]);

	useEffect(() => {
		void load();
	}, [load]);

	const { page, setPage, pageData, total } = useForwardTablePage(routes, FORWARD_TABLE_PAGE_SIZE);

	const add = async () => {
		try {
			const values = await form.validateFields();
			const body = {
				dst: String(values.dst ?? '').trim(),
				gw: String(values.gw ?? '').trim(),
				vrf_id: String(values.vrf_id ?? '').trim(),
			};
			const res =
				activeTab === 'ipv4'
					? await addIbrForwardingRoute(vrUuid, body)
					: await addIbrForwardingIpv6Route(vrUuid, body);
			if (res.error) throw new Error(res.error);
			message.success('已添加');
			setModalOpen(false);
			form.resetFields();
			void load();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(getApiErrorMessage(e, '添加失败'));
		}
	};

	const columns = useMemo((): ColumnsType<IbrForwardingRouteRow> => {
		const cols: ColumnsType<IbrForwardingRouteRow> = [
			{ title: '协议', dataIndex: 'protocol', width: 88 },
			{ title: '前缀', dataIndex: 'prefix', ellipsis: true },
			{ title: '下一跳', dataIndex: 'next_hop', ellipsis: true },
			{ title: '接口', dataIndex: 'interface', ellipsis: true },
			{
				title: '状态',
				key: 'status',
				width: 110,
				render: (_v, row) => <RouteStatusDot row={row} />,
			},
		];
		if (canWrite) {
			cols.push({
				title: '',
				key: 'actions',
				width: 48,
				align: 'right',
				render: (_v, row) => {
					const canDelete = Boolean(row.prefix && row.next_hop && row.next_hop !== 'Connected');
					const items: MenuProps['items'] = [
						{
							key: 'delete',
							label: '删除',
							danger: true,
							disabled: !canDelete,
							onClick: async () => {
								try {
									const body = { dst: row.prefix, gw: row.next_hop };
									const res =
										activeTab === 'ipv4'
											? await deleteIbrForwardingRoute(vrUuid, body)
											: await deleteIbrForwardingIpv6Route(vrUuid, body);
									if (res.error) throw new Error(res.error);
									message.success('已删除');
									void load();
								} catch (e) {
									message.error(getApiErrorMessage(e, '删除失败'));
								}
							},
						},
					];
					return (
						<div className="ibr-console-row-actions">
							<Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
								<Button type="text" size="small" icon={<EllipsisOutlined />} aria-label="更多操作" />
							</Dropdown>
						</div>
					);
				},
			});
		}
		return cols;
	}, [activeTab, canWrite, load, vrUuid]);

	if (!managementIp) {
		return <VrConsoleNoDevicePanel />;
	}

	const tabTitle = activeTab === 'ipv4' ? 'IPv4 路由条目' : 'IPv6 路由条目';

	return (
		<>
			<div className="ibr-console-ops-panel">
				<IbrConsoleSegmented
					tabs={ROUTES_TABS}
					activeTab={activeTab}
					onChange={setActiveTab}
					ariaLabel="路由类型"
				/>

				<div className="ibr-console-content-block">
					<div className="ibr-console-block-header">
						<h2 className="ibr-console-block-title">{tabTitle}</h2>
						<div className="ibr-console-block-action">
							<Button type="default" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
								刷新
							</Button>
							<Button type="default" onClick={() => setRawDrawerOpen(true)}>
								原始输出
							</Button>
							{canWrite ? (
								<Button type="primary" onClick={() => setModalOpen(true)}>
									添加
								</Button>
							) : null}
						</div>
					</div>
					<div className="ibr-console-ops-card ibr-console-ops-card--table-pad">
						<div className="ibr-console-data-table-wrap">
							<Spin spinning={loading}>
								<ConsoleForwardTable
									showHeader
									rowKey={(r) => r.raw}
									columns={columns}
									dataSource={pageData}
									scroll={{ x: true }}
									locale={{ emptyText: forwardTableEmpty('暂无路由条目') }}
								/>
							</Spin>
						</div>
					</div>
					<ForwardTableFooter
						total={total}
						page={page}
						pageSize={FORWARD_TABLE_PAGE_SIZE}
						onChange={setPage}
					/>
				</div>
			</div>

			<ForwardTextDrawer
				title="原始输出"
				open={rawDrawerOpen}
				onClose={() => setRawDrawerOpen(false)}
				text={raw}
				emptyText="（暂无，请先刷新加载）"
			/>

			<ConsoleOpsModal
				title={activeTab === 'ipv4' ? '添加 IPv4 静态路由' : '添加 IPv6 路由'}
				open={modalOpen}
				onCancel={() => setModalOpen(false)}
				onOk={() => void add()}
				destroyOnClose
			>
				<Form form={form} layout="vertical" preserve={false}>
					<Form.Item
						name="dst"
						label={activeTab === 'ipv4' ? '目标网段 / 主机' : '目的前缀'}
						rules={[{ required: true, message: '必填' }]}
					>
						<Input
							className="ibr-console-ops-input"
							placeholder={activeTab === 'ipv4' ? '0.0.0.0/0 或 10.0.0.0/8' : '2001:db8::/64'}
						/>
					</Form.Item>
					<Form.Item
						name="gw"
						label={activeTab === 'ipv4' ? '网关' : '下一跳'}
						rules={[{ required: true, message: '必填' }]}
					>
						<Input
							className="ibr-console-ops-input"
							placeholder={activeTab === 'ipv4' ? '192.168.1.1' : '2001:db8::1'}
						/>
					</Form.Item>
					<Form.Item name="vrf_id" label="VRF（可选）">
						<Input className="ibr-console-ops-input" />
					</Form.Item>
				</Form>
			</ConsoleOpsModal>
		</>
	);
};
