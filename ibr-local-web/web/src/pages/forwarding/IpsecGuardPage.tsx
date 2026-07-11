import { Button, Drawer, Form, InputNumber, Space, Switch, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { TableBlock } from '../../components/TableBlock';

type LogRow = { time: string; tunnel_id: string; action: string; detail: string };

export function IpsecGuardPage() {
	const [form] = Form.useForm();
	const [logs, setLogs] = useState<LogRow[]>([]);
	const [guardDrawerOpen, setGuardDrawerOpen] = useState(false);

	const loadCfg = useCallback(async () => {
		try {
			const { data } = await api.get<{ enabled: boolean; reconnect_enabled: boolean; interval: number; max_retries: number }>(
				'/forwarding/ipsec/autoreconnect',
			);
			form.setFieldsValue(data);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载配置失败');
		}
	}, [form]);

	const loadLogs = useCallback(async () => {
		try {
			const { data } = await api.get<{ logs: LogRow[] }>('/forwarding/ipsec/reconnect-logs');
			setLogs(data.logs ?? []);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载日志失败');
		}
	}, []);

	useEffect(() => {
		void loadLogs();
		const t = setInterval(() => void loadLogs(), 8000);
		return () => clearInterval(t);
	}, [loadLogs]);

	const save = async () => {
		try {
			const v = await form.validateFields();
			await api.post('/forwarding/ipsec/autoreconnect', {
				enabled: v.enabled,
				reconnect_enabled: v.reconnect_enabled,
				interval: v.interval,
				max_retries: v.max_retries,
			});
			message.success('已保存');
			void loadCfg();
			void loadLogs();
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in e) return;
			message.error(e instanceof Error ? e.message : '保存失败');
		}
	};

	const cols: ColumnsType<LogRow> = [
		{ title: '时间', dataIndex: 'time', width: 170 },
		{ title: '隧道 / 系统', dataIndex: 'tunnel_id', width: 140 },
		{ title: '动作', dataIndex: 'action', width: 110 },
		{ title: '详情', dataIndex: 'detail', ellipsis: true },
	];

	return (
		<>
			<PageStack>
				<PageHeader title="IPsec 守卫" description="监控隧道连通性与自动重连，查看重连日志。" />
				<TableBlock
					title="重连日志"
					action={
						<>
							<Button type="primary" onClick={() => setGuardDrawerOpen(true)}>
								自动重连 / 守卫
							</Button>
							<Button onClick={() => void loadLogs()}>刷新日志</Button>
						</>
					}
					rowKey={(r) => r.time + r.tunnel_id + r.action + r.detail}
					columns={cols}
					dataSource={logs}
					pageSize={15}
				/>
			</PageStack>

			<Drawer
				title="自动重连 / 守卫"
				width={520}
				open={guardDrawerOpen}
				onClose={() => setGuardDrawerOpen(false)}
				destroyOnClose
				afterOpenChange={(open) => {
					if (open) void loadCfg();
				}}
			>
				<Form form={form} layout="vertical" style={{ maxWidth: '100%' }}>
					<Form.Item name="enabled" label="监控总开关" valuePropName="checked">
						<Switch />
					</Form.Item>
					<Form.Item name="reconnect_enabled" label="自动重连（非仅探测）" valuePropName="checked">
						<Switch />
					</Form.Item>
					<Form.Item name="interval" label="探测间隔（秒）" rules={[{ required: true }]}>
						<InputNumber min={5} max={3600} style={{ width: '100%' }} />
					</Form.Item>
					<Form.Item name="max_retries" label="最大重试次数" rules={[{ required: true }]}>
						<InputNumber min={1} max={20} style={{ width: '100%' }} />
					</Form.Item>
					<Space>
						<Button type="primary" onClick={() => void save()}>
							保存
						</Button>
						<Button onClick={() => void loadLogs()}>刷新日志</Button>
					</Space>
				</Form>
				<Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
					开启后，本控制台会按一定间隔检查<strong>平台要求自动发起的</strong>隧道是否在设备上仍处于已建立状态；若开启「自动重连」，断线时会按次数上限尝试重新发起。配置与日志保存在本机服务运行目录下的
					<code>ipsec_monitor.json</code>、<code>ipsec_monitor.log</code>。
				</Typography.Paragraph>
			</Drawer>
		</>
	);
}
