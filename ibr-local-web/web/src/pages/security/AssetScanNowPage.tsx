import { ReloadOutlined, SaveOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { Button, Form, Input, Spin, Typography, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { BlockHeader } from '../../components/BlockHeader';
import { Card } from '../../components/Card';
import { ContentBlock } from '../../components/ContentBlock';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';

type ScanConfig = { subnets: string };

export function AssetScanNowPage() {
	const [loading, setLoading] = useState(true);
	const [last, setLast] = useState<Record<string, unknown> | null>(null);
	const [form] = Form.useForm<{ subnets: string }>();

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const cfgRes = await api.get<{ config: ScanConfig; last: Record<string, unknown> | null }>('/assets/scan/config');
			const c = cfgRes.data.config;
			setLast(cfgRes.data.last ?? null);
			form.setFieldsValue({ subnets: c.subnets });
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, [form]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const saveDefaultSubnets = async () => {
		const v = await form.validateFields();
		const subnets = (v.subnets ?? '').trim();
		if (!subnets) {
			message.warning('请先填写网段');
			return;
		}
		try {
			await api.post('/assets/scan/config', { subnets });
			message.success('已保存默认扫描网段');
			await refresh();
		} catch (e) {
			message.error(e instanceof Error ? e.message : '保存失败');
		}
	};

	const scanNow = async () => {
		const v = await form.validateFields();
		const subnets = (v.subnets ?? '').trim();
		if (!subnets) {
			message.warning('请填写扫描网段，可先保存为默认网段以便下次自动带出');
			return;
		}
		try {
			await api.post('/assets/scan/now', { subnets });
			message.success('扫描任务已启动');
			await refresh();
		} catch (e) {
			message.error(e instanceof Error ? e.message : '启动失败');
		}
	};

	const cancelScan = async () => {
		try {
			const { data } = await api.post<Record<string, unknown>>('/assets/scan/cancel');
			message.info(String(data.message ?? '已处理取消请求'));
			await refresh();
		} catch (e) {
			message.error(e instanceof Error ? e.message : '取消失败');
		}
	};

	const lastStatus = last && typeof last.status === 'string' ? last.status : '';
	const lastOutput = last && typeof last.output === 'string' ? (last.output as string).slice(-4000) : '';

	return (
		<PageStack>
			<PageHeader title="立即扫描" description="配置网段并手动触发资产扫描。" />

			<ContentBlock>
				<BlockHeader
					title="扫描网段"
					action={
						<>
							<Button icon={<SaveOutlined />} onClick={() => void saveDefaultSubnets()}>
								保存默认网段
							</Button>
							<Button type="primary" icon={<SearchOutlined />} onClick={() => void scanNow()}>
								开始扫描
							</Button>
							<Button icon={<StopOutlined />} onClick={() => void cancelScan()}>
								取消扫描
							</Button>
							<Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
								刷新状态
							</Button>
						</>
					}
				/>
				<Card variant="padded">
					<Spin spinning={loading}>
						<Form form={form} layout="vertical">
							<Form.Item
								name="subnets"
								label="网段"
								rules={[{ required: true, message: '请输入网段，多个用英文逗号分隔' }]}
								extra="保存后写入本机配置，下次打开本页自动填入；与单次「开始扫描」使用同一输入框。"
							>
								<Input placeholder="例如 192.168.1.0/24,10.0.0.1" allowClear />
							</Form.Item>
						</Form>
					</Spin>
				</Card>
			</ContentBlock>

			<ContentBlock>
				<BlockHeader title="当前任务与输出" />
				<Card variant="padded">
					<Spin spinning={loading}>
						<Typography.Paragraph style={{ marginBottom: 8 }}>状态：{lastStatus || '—'}</Typography.Paragraph>
						{last && typeof last.error === 'string' && last.error ? (
							<Typography.Paragraph type="danger" copyable>
								{String(last.error)}
							</Typography.Paragraph>
						) : null}
						{lastOutput ? (
							<pre className="app-code-block app-code-block-inset app-code-block-tall-sm">{lastOutput}</pre>
						) : (
							<Typography.Text type="secondary">暂无输出</Typography.Text>
						)}
					</Spin>
				</Card>
			</ContentBlock>
		</PageStack>
	);
}
