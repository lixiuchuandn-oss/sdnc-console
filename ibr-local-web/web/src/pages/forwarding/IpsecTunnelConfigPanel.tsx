import { Button, Form, Input, InputNumber, Modal, Switch, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { TableBlock } from '../../components/TableBlock';

export type IpsecTunnelConfig = {
	ID: string;
	ike_local_ip?: string;
	ike_remote_ip?: string;
	ike_dpd_delay?: number;
	ike_dpd_timeout?: number;
	ike_mode?: string;
	ike_proposal_local?: string;
	ike_proposal_remote?: { remote_id?: string; pre_shared_key?: string };
	traffic_selectors_local?: string;
	traffic_selectors_remote?: string;
	vrf_id?: string;
	sa_dpd_action?: string;
	sa_esp_proposals?: string;
	'sa-initiate'?: boolean;
	source?: string;
};

export function IpsecTunnelConfigPanel() {
	const [loading, setLoading] = useState(false);
	const [tunnels, setTunnels] = useState<IpsecTunnelConfig[]>([]);
	const [modalOpen, setModalOpen] = useState(false);
	const [editing, setEditing] = useState<IpsecTunnelConfig | null>(null);
	const [form] = Form.useForm();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ tunnels: IpsecTunnelConfig[] }>('/forwarding/ipsec/tunnels');
			setTunnels(data.tunnels ?? []);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const openCreate = () => {
		setEditing(null);
		form.resetFields();
		form.setFieldsValue({ 'sa-initiate': true, ike_mode: 'main' });
		setModalOpen(true);
	};

	const openEdit = (row: IpsecTunnelConfig) => {
		setEditing(row);
		form.setFieldsValue({
			...row,
			remote_id: row.ike_proposal_remote?.remote_id,
			pre_shared_key: row.ike_proposal_remote?.pre_shared_key,
			'sa-initiate': row['sa-initiate'] === true || String(row['sa-initiate']) === 'true',
		});
		setModalOpen(true);
	};

	const save = async () => {
		try {
			const v = await form.validateFields();
			const body: IpsecTunnelConfig = {
				ID: String(v.ID).trim(),
				ike_local_ip: v.ike_local_ip?.trim(),
				ike_remote_ip: v.ike_remote_ip?.trim(),
				ike_dpd_delay: v.ike_dpd_delay,
				ike_dpd_timeout: v.ike_dpd_timeout,
				ike_mode: v.ike_mode?.trim(),
				ike_proposal_local: v.ike_proposal_local?.trim(),
				ike_proposal_remote:
					v.remote_id && v.pre_shared_key
						? { remote_id: String(v.remote_id).trim(), pre_shared_key: String(v.pre_shared_key).trim() }
						: undefined,
				traffic_selectors_local: v.traffic_selectors_local?.trim(),
				traffic_selectors_remote: v.traffic_selectors_remote?.trim(),
				vrf_id: v.vrf_id?.trim(),
				sa_dpd_action: v.sa_dpd_action?.trim(),
				sa_esp_proposals: v.sa_esp_proposals?.trim(),
				'sa-initiate': Boolean(v['sa-initiate']),
			};
			await api.post('/forwarding/ipsec/tunnels', body);
			message.success(editing ? '已更新隧道配置' : '已创建隧道配置');
			setModalOpen(false);
			void load();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in (e as object)) return;
			message.error(e instanceof Error ? e.message : '保存失败');
		}
	};

	const columns: ColumnsType<IpsecTunnelConfig> = [
		{ title: 'ID', dataIndex: 'ID', width: 100 },
		{
			title: '来源',
			dataIndex: 'source',
			width: 90,
			render: (s: string) => {
				const color = s === 'cloud' ? 'blue' : s === 'both' ? 'purple' : 'default';
				return <Tag color={color}>{s === 'cloud' ? '云平台' : s === 'both' ? '云+本地' : '本地'}</Tag>;
			},
		},
		{ title: '本端 IKE', dataIndex: 'ike_local_ip', ellipsis: true },
		{ title: '对端 IKE', dataIndex: 'ike_remote_ip', ellipsis: true },
		{ title: '本地 TS', dataIndex: 'traffic_selectors_local', ellipsis: true },
		{ title: '对端 TS', dataIndex: 'traffic_selectors_remote', ellipsis: true },
		{ title: 'ESP', dataIndex: 'sa_esp_proposals', ellipsis: true },
		{
			title: '操作',
			key: 'op',
			width: 160,
			render: (_, row) => (
				<div className="app-inline-actions">
					<Button size="small" onClick={() => openEdit(row)}>
						编辑
					</Button>
					<Button
						size="small"
						danger
						onClick={async () => {
							try {
								await api.delete(`/forwarding/ipsec/tunnels/${encodeURIComponent(row.ID)}`);
								message.success('已删除');
								void load();
							} catch (e) {
								message.error(e instanceof Error ? e.message : '删除失败');
							}
						}}
					>
						删除
					</Button>
				</div>
			),
		},
	];

	return (
		<>
			<TableBlock
				title="隧道配置"
				action={
					<>
						<Button type="primary" onClick={openCreate}>
							新建隧道
						</Button>
						<Button onClick={() => void load()}>刷新</Button>
					</>
				}
				loading={loading}
				rowKey="ID"
				columns={columns}
				dataSource={tunnels}
				paginated={false}
				scroll={{ x: true }}
			/>
			<Modal
				title={editing ? `编辑隧道 ${editing.ID}` : '新建 IPsec 隧道'}
				open={modalOpen}
				onCancel={() => setModalOpen(false)}
				onOk={() => void save()}
				width={640}
				destroyOnClose
			>
				<Form form={form} layout="vertical">
					<Form.Item label="隧道 ID" name="ID" rules={[{ required: true, message: '必填' }]}>
						<Input disabled={Boolean(editing)} placeholder="例如 1 或 tunnel-a" />
					</Form.Item>
					<Form.Item label="IKE 本端 IP" name="ike_local_ip" rules={[{ required: true }]}>
						<Input placeholder="100.1.1.2" />
					</Form.Item>
					<Form.Item label="IKE 对端 IP" name="ike_remote_ip" rules={[{ required: true }]}>
						<Input placeholder="101.1.1.2" />
					</Form.Item>
					<Form.Item label="IKE 模式" name="ike_mode">
						<Input placeholder="main / aggressive" />
					</Form.Item>
					<Form.Item label="IKE 本端 proposal" name="ike_proposal_local">
						<Input placeholder="vr1" />
					</Form.Item>
					<Form.Item label="对端 ID (proposal-remote)" name="remote_id">
						<Input placeholder="vr2" />
					</Form.Item>
					<Form.Item label="预共享密钥" name="pre_shared_key">
						<Input.Password placeholder="PSK" />
					</Form.Item>
					<Form.Item label="本地流量选择器" name="traffic_selectors_local" rules={[{ required: true, message: 'commit 必填' }]}>
						<Input placeholder="100.1.1.0/24, 171.100.101.0/24" />
					</Form.Item>
					<Form.Item label="对端流量选择器" name="traffic_selectors_remote" rules={[{ required: true, message: 'commit 必填' }]}>
						<Input placeholder="102.1.1.0/24" />
					</Form.Item>
					<Form.Item label="VRF ID" name="vrf_id">
						<Input placeholder="可选" />
					</Form.Item>
					<Form.Item label="ESP 提案" name="sa_esp_proposals">
						<Input placeholder="aes256-sha256-modp2048" />
					</Form.Item>
					<Form.Item label="SA DPD 动作" name="sa_dpd_action">
						<Input placeholder="restart" />
					</Form.Item>
					<div className="app-form-inline-pair">
						<Form.Item label="DPD delay" name="ike_dpd_delay">
							<InputNumber min={1} style={{ width: 120 }} />
						</Form.Item>
						<Form.Item label="DPD timeout" name="ike_dpd_timeout">
							<InputNumber min={1} style={{ width: 120 }} />
						</Form.Item>
					</div>
					<Form.Item label="保存后立即发起连接" name="sa-initiate" valuePropName="checked">
						<Switch />
					</Form.Item>
				</Form>
			</Modal>
		</>
	);
}
