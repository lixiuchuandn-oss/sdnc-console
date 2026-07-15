import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import {
	Button,
	Descriptions,
	Divider,
	Form,
	Input,
	InputNumber,
	Space,
	Spin,
	Switch,
	Tag,
	Typography,
	message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getApiErrorMessage } from '../../../../../../services/api';
import {
	createIbrForwardingNatEntry,
	deleteIbrForwardingNatEntry,
	disableIbrForwardingNat,
	enableIbrForwardingNat,
	fetchIbrForwardingNatEntries,
	fetchIbrForwardingNatStatus,
	toggleIbrForwardingNatUseWanIp,
	type IbrForwardingNatEntryRow,
	type IbrForwardingNatGlobal,
} from '../../../../../../services/ibrDeviceOpsApi';
import { useIbrConsoleWritePermission } from '../lib/useIbrConsoleWritePermission';
import {
	ConsoleForwardTable,
	FORWARD_TABLE_PAGE_SIZE,
	ConsoleOpsDrawer,
	ConsoleOpsModal,
	ForwardTableFooter,
	forwardTableEmpty,
	useForwardTablePage,
} from '../lib/forwardPanelUi';
import { IbrConsoleSegmented } from '../components/IbrConsoleSegmented';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

/** 设备 NAT（ibr-local-web 同源）；勿用 NATPage / /api/networks/nat */

type Props = {
	vrUuid: string;
	managementIp: string;
};

type NatTab = 'static' | 'snat' | 'dnat';

const NAT_TABS: { id: NatTab; label: string }[] = [
	{ id: 'static', label: '静态 NAT' },
	{ id: 'snat', label: 'SNAT' },
	{ id: 'dnat', label: 'DNAT' },
];

const NAT_TYPE_BY_TAB: Record<NatTab, string> = {
	static: 'STATIC',
	snat: 'SNAT',
	dnat: 'DNAT',
};

function NatGlobalDrawer(props: {
	open: boolean;
	onClose: () => void;
	vrUuid: string;
	canWrite: boolean;
}) {
	const [loading, setLoading] = useState(false);
	const [g, setG] = useState<IbrForwardingNatGlobal | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await fetchIbrForwardingNatStatus(props.vrUuid, { skipCache: true });
			if (data.error) throw new Error(data.error);
			setG(data.global ?? null);
		} catch (e) {
			message.error(getApiErrorMessage(e, '加载 NAT 状态失败'));
		} finally {
			setLoading(false);
		}
	}, [props.vrUuid]);

	useEffect(() => {
		if (props.open) void load();
	}, [props.open, load]);

	const enable = async () => {
		try {
			const res = await enableIbrForwardingNat(props.vrUuid, {
				wan_if: g?.wan_if ?? '',
				use_wan_ip_as_pool: g?.use_wan_ip_as_pool !== false,
			});
			if (res.error) throw new Error(res.error);
			message.success('已下发启用 NAT');
			void load();
		} catch (e) {
			message.error(getApiErrorMessage(e, '启用失败'));
		}
	};

	const disable = async () => {
		try {
			const res = await disableIbrForwardingNat(props.vrUuid);
			if (res.error) throw new Error(res.error);
			message.success('已下发关闭 NAT');
			void load();
		} catch (e) {
			message.error(getApiErrorMessage(e, '关闭失败'));
		}
	};

	const toggleWanIp = async (checked: boolean) => {
		try {
			const res = await toggleIbrForwardingNatUseWanIp(props.vrUuid, { enabled: checked });
			if (res.error) throw new Error(res.error);
			message.success('已更新 SNAT 地址池策略');
			void load();
		} catch (e) {
			message.error(getApiErrorMessage(e, '更新失败'));
		}
	};

	return (
		<ConsoleOpsDrawer
			title="NAT 全局配置"
			width={640}
			open={props.open}
			onClose={props.onClose}
			destroyOnClose
		>
			<Spin spinning={loading}>
				{g ? (
					<Space direction="vertical" size={0} style={{ width: '100%' }}>
						<Descriptions bordered size="small" column={1} labelStyle={{ width: 160, whiteSpace: 'nowrap' }}>
							<Descriptions.Item label="NAT 运行状态">
								{g.enabled ? <Tag color="success">已启用</Tag> : <Tag>未启用</Tag>}
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

						{props.canWrite ? (
							<>
								<Divider style={{ margin: '24px 0' }} />
								<Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
									下发操作
								</Typography.Title>
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
								<div style={{ marginTop: 20 }}>
									<Typography.Text>使用 WAN 口公网 IP 作为 SNAT 源</Typography.Text>
									<div style={{ marginTop: 8 }}>
										<Switch
											checked={g.use_wan_ip_as_pool}
											onChange={(c) => void toggleWanIp(c)}
											disabled={!g.enabled}
											checkedChildren="开"
											unCheckedChildren="关"
										/>
									</div>
								</div>
							</>
						) : null}
					</Space>
				) : (
					<Typography.Text type="secondary">暂无数据</Typography.Text>
				)}
			</Spin>
		</ConsoleOpsDrawer>
	);
}

export const VrConsoleNatPanel: React.FC<Props> = ({ vrUuid, managementIp }) => {
	const canWrite = useIbrConsoleWritePermission('networks.nat:write');

	const [activeTab, setActiveTab] = useState<NatTab>('static');
	const [loading, setLoading] = useState(false);
	const [entries, setEntries] = useState<IbrForwardingNatEntryRow[]>([]);
	const [globalDrawerOpen, setGlobalDrawerOpen] = useState(false);
	const [modalOpen, setModalOpen] = useState(false);
	const [modalSubmitting, setModalSubmitting] = useState(false);
	const [form] = Form.useForm();

	const loadGenRef = useRef(0);

	const loadEntries = useCallback(async () => {
		const gen = ++loadGenRef.current;
		const reqUuid = vrUuid;
		setLoading(true);
		try {
			const data = await fetchIbrForwardingNatEntries(reqUuid, { skipCache: true });
			if (gen !== loadGenRef.current || reqUuid !== vrUuid) return;
			if (data.error) throw new Error(data.error);
			setEntries(Array.isArray(data.entries) ? data.entries : []);
		} catch (e) {
			if (gen !== loadGenRef.current) return;
			message.error(getApiErrorMessage(e, '加载 NAT 条目失败'));
		} finally {
			if (gen === loadGenRef.current) setLoading(false);
		}
	}, [vrUuid]);

	useEffect(() => {
		void loadEntries();
	}, [loadEntries]);

	const filteredEntries = useMemo(
		() => entries.filter((e) => (e.type || '').toUpperCase() === NAT_TYPE_BY_TAB[activeTab]),
		[entries, activeTab],
	);
	const listPage = useForwardTablePage(filteredEntries, FORWARD_TABLE_PAGE_SIZE);

	const handleDelete = useCallback(
		async (row: IbrForwardingNatEntryRow) => {
			try {
				const res = await deleteIbrForwardingNatEntry(vrUuid, row.id);
				if (res.error) throw new Error(res.error);
				message.success('已删除');
				void loadEntries();
			} catch (e) {
				message.error(getApiErrorMessage(e, '删除失败'));
			}
		},
		[loadEntries, vrUuid],
	);

	const columns = useMemo((): ColumnsType<IbrForwardingNatEntryRow> => {
		if (activeTab === 'snat') {
			const cols: ColumnsType<IbrForwardingNatEntryRow> = [
				{ title: '编号', dataIndex: 'id', width: 72 },
				{ title: '协议', dataIndex: 'proto', width: 80 },
				{ title: '起始', dataIndex: 'range_start' },
				{ title: '结束', dataIndex: 'range_end' },
			];
			if (canWrite) {
				cols.push({
					title: '操作',
					key: 'act',
					fixed: 'right',
					width: 88,
					render: (_, row) => (
						<Button type="link" danger size="small" onClick={() => void handleDelete(row)}>
							删除
						</Button>
					),
				});
			}
			return cols;
		}

		const cols: ColumnsType<IbrForwardingNatEntryRow> = [
			{ title: '编号', dataIndex: 'id', width: 72 },
			{ title: '协议', dataIndex: 'proto', width: 80 },
			{ title: '内网 IP', dataIndex: 'inside_ip' },
			{ title: '内网端口', dataIndex: 'inside_port', width: 100 },
			{ title: '外网 IP', dataIndex: 'outside_ip' },
			{ title: '外网端口', dataIndex: 'outside_port', width: 110 },
			{ title: 'VRF', dataIndex: 'vrf_id', width: 80 },
		];
		if (canWrite) {
			cols.push({
				title: '操作',
				key: 'act',
				fixed: 'right',
				width: 88,
				render: (_, row) => (
					<Button type="link" danger size="small" onClick={() => void handleDelete(row)}>
						删除
					</Button>
				),
			});
		}
		return cols;
	}, [activeTab, canWrite, handleDelete]);

	const submitCreate = async () => {
		try {
			const v = await form.validateFields();
			setModalSubmitting(true);
			let body: Record<string, unknown>;
			if (activeTab === 'snat') {
				body = {
					type: 'SNAT',
					range_start: v.range_start,
					range_end: v.range_end,
				};
			} else if (activeTab === 'static') {
				body = {
					type: 'STATIC',
					inside_ip: v.inside_ip,
					outside_ip: v.outside_ip,
					proto: v.proto || 'ip',
					vrf_id: v.vrf_id || '',
				};
			} else {
				body = {
					type: 'DNAT',
					inside_ip: v.inside_ip,
					outside_ip: v.outside_ip,
					proto: v.proto || 'tcp',
					vrf_id: v.vrf_id || '',
					inside_port: v.inside_port,
					outside_port: v.outside_port,
				};
			}
			const res = await createIbrForwardingNatEntry(vrUuid, body);
			if (res.error) throw new Error(res.error);
			message.success('已创建');
			setModalOpen(false);
			form.resetFields();
			void loadEntries();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(getApiErrorMessage(e, '创建失败'));
		} finally {
			setModalSubmitting(false);
		}
	};

	const tabTitle =
		activeTab === 'static' ? '静态 NAT' : activeTab === 'snat' ? 'SNAT' : 'DNAT';

	if (!managementIp) {
		return <VrConsoleNoDevicePanel />;
	}

	return (
		<>
			<div className="ibr-console-ops-panel">
				<IbrConsoleSegmented
					tabs={NAT_TABS}
					activeTab={activeTab}
					onChange={setActiveTab}
					ariaLabel="NAT 类型"
				/>

				<div className="ibr-console-content-block">
					<div className="ibr-console-block-header">
						<h2 className="ibr-console-block-title">{tabTitle} 条目</h2>
						<div className="ibr-console-block-action">
							<Button
								type="default"
								icon={<ReloadOutlined />}
								loading={loading}
								onClick={() => void loadEntries()}
							>
								刷新
							</Button>
							<Button type="default" onClick={() => setGlobalDrawerOpen(true)}>
								全局配置
							</Button>
							{canWrite ? (
								<Button type="primary" onClick={() => setModalOpen(true)}>
									新增
								</Button>
							) : null}
						</div>
					</div>

					<div className="ibr-console-ops-card ibr-console-ops-card--table-pad">
						<div className="ibr-console-data-table-wrap">
							<Spin spinning={loading}>
								<ConsoleForwardTable
									showHeader
									rowKey="id"
									columns={columns}
									dataSource={listPage.pageData}
									scroll={{ x: true }}
									locale={{ emptyText: forwardTableEmpty(`设备上暂无 ${tabTitle} 条目`) }}
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

			<NatGlobalDrawer
				open={globalDrawerOpen}
				onClose={() => setGlobalDrawerOpen(false)}
				vrUuid={vrUuid}
				canWrite={canWrite}
			/>

			<ConsoleOpsModal
				title={`新增 ${tabTitle} 条目`}
				open={modalOpen}
				width={480}
				okText="创建"
				cancelText="取消"
				confirmLoading={modalSubmitting}
				destroyOnClose
				maskClosable={false}
				onCancel={() => {
					setModalOpen(false);
					form.resetFields();
				}}
				onOk={() => void submitCreate()}
			>
				<Form form={form} layout="vertical" preserve={false}>
					{activeTab === 'snat' ? (
						<>
							<Form.Item name="range_start" label="起始 IP" rules={[{ required: true }]}>
								<Input placeholder="10.0.0.1" />
							</Form.Item>
							<Form.Item name="range_end" label="结束 IP" rules={[{ required: true }]}>
								<Input placeholder="10.0.0.254" />
							</Form.Item>
						</>
					) : (
						<>
							<Form.Item name="inside_ip" label="内网 IP" rules={[{ required: true }]}>
								<Input placeholder="内网侧地址" />
							</Form.Item>
							<Form.Item name="outside_ip" label="外网 IP" rules={[{ required: true }]}>
								<Input placeholder="外网侧地址" />
							</Form.Item>
							<Form.Item
								name="proto"
								label="协议"
								initialValue={activeTab === 'static' ? 'ip' : 'tcp'}
							>
								<Input placeholder="如 ip、tcp、udp" />
							</Form.Item>
							<Form.Item name="vrf_id" label="VRF（可选）">
								<Input placeholder="留空表示默认" />
							</Form.Item>
							{activeTab === 'dnat' ? (
								<>
									<Form.Item name="inside_port" label="内网端口" rules={[{ required: true }]}>
										<InputNumber min={1} max={65535} style={{ width: '100%' }} />
									</Form.Item>
									<Form.Item name="outside_port" label="外网端口" rules={[{ required: true }]}>
										<InputNumber min={1} max={65535} style={{ width: '100%' }} />
									</Form.Item>
								</>
							) : null}
						</>
					)}
				</Form>
			</ConsoleOpsModal>
		</>
	);
};
