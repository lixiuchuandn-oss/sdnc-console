import { RightOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Form, Input, List, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ConfigFileDrawer } from '../../../components/ConfigFileDrawer';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';
import { useConfigFileEditor } from '../../../hooks/useConfigFileEditor';

type ServiceForm = {
	tower_base?: string;
	manageip?: string;
	ai_soc_base?: string;
};

export function DeviceServicePage() {
	const { message } = AntApp.useApp();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [form] = Form.useForm<ServiceForm>();

	const registerEditor = useConfigFileEditor({
		load: async () => {
			const { data } = await api.get<{ ok: boolean; exists?: boolean; content?: string; error?: string }>('/sys/register');
			if (!data?.ok) throw new Error(data?.error || '加载失败');
			return String(data.content ?? '');
		},
		save: async (content) => {
			const { data } = await api.post<{ ok: boolean; error?: string }>('/sys/register', { content });
			if (!data?.ok) throw new Error(data?.error || '保存失败');
		},
		onSaved: () => message.success('已保存 registervr.conf'),
	});

	const vrcontrolEditor = useConfigFileEditor({
		load: async () => {
			const { data } = await api.get<{ ok: boolean; exists?: boolean; content?: string; error?: string }>('/sys/vrcontrol');
			if (!data?.ok) throw new Error(data?.error || '加载失败');
			return String(data.content ?? '');
		},
		save: async (content) => {
			const { data } = await api.post<{ ok: boolean; error?: string }>('/sys/vrcontrol', { content });
			if (!data?.ok) throw new Error(data?.error || '保存失败');
		},
		onSaved: () => message.success('已保存 vrcontrol.conf'),
	});

	const stripUrlToHost = (raw: string): string => {
		const v = String(raw ?? '').trim();
		if (!v) return '';
		if (v.includes('://')) {
			try {
				const u = new URL(v);
				return (u.host || v).trim();
			} catch {
				return v.split('://')[1]?.split('/')[0]?.trim() || v;
			}
		}
		return v.split('/')[0]?.trim() || v;
	};

	const normalizeUrlInput = (raw: string): string => {
		const v = String(raw ?? '').trim();
		if (!v) return '';
		if (/^https?:\/\//i.test(v)) return v;
		return `http://${v}`;
	};

	const reloadServiceForm = async () => {
		const [sdwanRes, towerRes, aisocRes] = await Promise.all([
			api.get<{ ok?: boolean; manageip?: string | null }>('/sys/sdwan'),
			api.get<{ ok: boolean; base?: string | null; login_url?: string | null }>('/sys/tower'),
			api.get<{ ok: boolean; base?: string | null }>('/aisoc/base'),
		]);
		form.setFieldsValue({
			manageip: String(sdwanRes.data?.manageip ?? '').trim() || undefined,
			tower_base: stripUrlToHost(String(towerRes.data?.base ?? '').trim()) || undefined,
			ai_soc_base: stripUrlToHost(String(aisocRes.data?.base ?? '').trim()) || undefined,
		});
	};

	const saveAllServices = async () => {
		try {
			await form.validateFields(['tower_base', 'manageip', 'ai_soc_base']);
			const values = form.getFieldsValue();
			const towerBase = normalizeUrlInput(String(values.tower_base ?? '').trim());
			const manageip = String(values.manageip ?? '').trim();
			const aisocBase = normalizeUrlInput(String(values.ai_soc_base ?? '').trim());
			setSaving(true);
			await Promise.all([
				api.post('/sys/tower', { base: towerBase }),
				api.post('/sdwan', { manageip }),
				api.post('/aisoc/base', { base: aisocBase }),
			]);
			await reloadServiceForm();
			message.success('已保存服务配置');
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in (e as object)) return;
			message.error(e instanceof Error ? e.message : '保存失败');
		} finally {
			setSaving(false);
		}
	};

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			try {
				const [sdwanRes, towerRes, aisocRes] = await Promise.all([
					api.get<{ ok?: boolean; manageip?: string | null }>('/sys/sdwan'),
					api.get<{ ok: boolean; base?: string | null; login_url?: string | null }>('/sys/tower'),
					api.get<{ ok: boolean; base?: string | null }>('/aisoc/base'),
				]);
				if (cancelled) return;
				form.setFieldsValue({
					manageip: String(sdwanRes.data?.manageip ?? '').trim() || undefined,
					tower_base: stripUrlToHost(String(towerRes.data?.base ?? '').trim()) || undefined,
					ai_soc_base: stripUrlToHost(String(aisocRes.data?.base ?? '').trim()) || undefined,
				});
			} catch (e) {
				if (!cancelled) message.error(e instanceof Error ? e.message : '加载失败');
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [form, message]);

	return (
		<>
			<Form form={form} layout="vertical" component={false}>
				<PageStack>
					<PageHeader title="配置服务" description="配置 Tower、SDWAN、AI SOC 等上游服务地址。" />

					<ContentBlock>
						<BlockHeader
							title="上游服务"
							action={
								<Button type="primary" loading={saving} disabled={loading} onClick={() => void saveAllServices()}>
									保存
								</Button>
							}
						/>
						<Card variant="list">
							<Spin spinning={loading}>
								<List
									split
									className="app-settings-list"
									dataSource={[
										{
											key: 'tower',
											title: 'Compute.Tower',
											description: 'Compute Tower 管理地址',
											name: 'tower_base' as const,
											placeholder: '例如 192.168.2.14:3001',
											requiredMessage: '请输入 Compute.Tower 地址',
										},
										{
											key: 'sdwan',
											title: 'SDWAN',
											description: 'SDWAN 控制器地址',
											name: 'manageip' as const,
											placeholder: '例如 10.20.255.93:8016',
											requiredMessage: '请输入 SDWAN 控制器地址',
										},
										{
											key: 'aisoc',
											title: 'AI SOC',
											description: 'AI SOC 服务地址',
											name: 'ai_soc_base' as const,
											placeholder: '例如 10.20.254.121:8000',
											requiredMessage: '请输入 AI SOC 服务地址',
										},
									]}
									renderItem={(item) => (
										<List.Item
											key={item.key}
											extra={
												<Form.Item
													name={item.name}
													noStyle
													rules={[{ required: true, message: item.requiredMessage }]}
												>
													<Input
														className="app-settings-list-input"
														placeholder={item.placeholder}
														disabled={loading || saving}
													/>
												</Form.Item>
											}
										>
											<List.Item.Meta title={item.title} description={item.description} />
										</List.Item>
									)}
								/>
							</Spin>
						</Card>
					</ContentBlock>

					<ContentBlock>
						<BlockHeader title="配置文件" />
						<Card variant="list">
							<List
								split
								className="app-settings-list"
								dataSource={[
									{
										key: 'vrcontrol',
										title: 'vrcontrol.conf',
										onClick: vrcontrolEditor.openDrawer,
									},
									{
										key: 'register',
										title: 'registervr.conf',
										onClick: registerEditor.openDrawer,
									},
								]}
								renderItem={(item) => (
									<List.Item
										key={item.key}
										className="app-settings-list-item-clickable"
										onClick={item.onClick}
										extra={<RightOutlined className="app-settings-list-chevron" aria-hidden />}
									>
										<span className="app-settings-list-filename">{item.title}</span>
									</List.Item>
								)}
							/>
						</Card>
					</ContentBlock>
				</PageStack>
			</Form>

			<ConfigFileDrawer
				open={registerEditor.open}
				onClose={registerEditor.closeDrawer}
				fileName="registervr.conf"
				filePath="/usr/local/src/vrconf/registervr.conf"
				hint="一般不需要修改；如无特殊需求请勿改动。"
				loading={registerEditor.loading}
				editing={registerEditor.editing}
				error={registerEditor.error}
				content={registerEditor.content}
				draft={registerEditor.draft}
				emptyText="（文件为空或不存在）"
				onRefresh={() => void registerEditor.reload()}
				onEdit={registerEditor.startEdit}
				onSave={() => void registerEditor.save()}
				onCancelEdit={registerEditor.cancelEdit}
				onDraftChange={registerEditor.setDraft}
			/>

			<ConfigFileDrawer
				open={vrcontrolEditor.open}
				onClose={vrcontrolEditor.closeDrawer}
				fileName="vrcontrol.conf"
				filePath="/usr/local/src/vrconf/vrcontrol.conf"
				hint="JSON 格式；上方表单保存的地址也会写入此文件。编辑前请确认 JSON 语法正确。"
				loading={vrcontrolEditor.loading}
				editing={vrcontrolEditor.editing}
				error={vrcontrolEditor.error}
				content={vrcontrolEditor.content}
				draft={vrcontrolEditor.draft}
				emptyText="（文件为空或不存在）"
				onRefresh={() => void vrcontrolEditor.reload()}
				onEdit={vrcontrolEditor.startEdit}
				onSave={() => void vrcontrolEditor.save()}
				onCancelEdit={vrcontrolEditor.cancelEdit}
				onDraftChange={vrcontrolEditor.setDraft}
			/>
		</>
	);
}
