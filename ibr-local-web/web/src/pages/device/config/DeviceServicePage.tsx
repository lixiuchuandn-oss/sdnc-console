import { RightOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Form, Input, List, Space, Spin, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ConfigFileDrawer } from '../../../components/ConfigFileDrawer';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';
import { useConfigFileEditor } from '../../../hooks/useConfigFileEditor';
import { generateRandomMac, generateSnowflakeUuid } from '../../../utils/registerVrIdentity';

type ServiceForm = {
	tower_base?: string;
	sdnc_csmctl_address?: string;
	ai_soc_base?: string;
};

type IdentityForm = {
	name?: string;
	vm_id?: string;
	pool_id?: string;
	pool_name?: string;
	uuid?: string;
	mac?: string;
	type?: string;
	version?: string;
};

type RegisterIdentityPayload = {
	ok: boolean;
	exists?: boolean;
	content?: string;
	identity?: IdentityForm;
	error?: string;
	registration_status?: 'ONLINE' | 'OFFLINE';
	registration_finish?: boolean;
	payload_changed?: boolean;
	instance_key_changed?: boolean;
	registration_invalidated?: boolean;
	agent_poked?: boolean;
};

export function DeviceServicePage() {
	const { message } = AntApp.useApp();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [identityLoading, setIdentityLoading] = useState(true);
	const [identitySaving, setIdentitySaving] = useState(false);
	const [registrationOnline, setRegistrationOnline] = useState<boolean | null>(null);
	const [form] = Form.useForm<ServiceForm>();
	const [identityForm] = Form.useForm<IdentityForm>();

	const registerEditor = useConfigFileEditor({
		load: async () => {
			const { data } = await api.get<RegisterIdentityPayload>('/sys/register');
			if (!data?.ok) throw new Error(data?.error || '加载失败');
			return String(data.content ?? '');
		},
		save: async (content) => {
			const { data } = await api.post<{ ok: boolean; error?: string }>('/sys/register', { content });
			if (!data?.ok) throw new Error(data?.error || '保存失败');
		},
		onSaved: () => {
			message.success('已保存 registervr.conf');
			void reloadIdentityForm();
		},
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
		onSaved: () => {
			message.success('已保存 vrcontrol.conf');
		},
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

	const reloadIdentityForm = useCallback(async () => {
		const { data } = await api.get<RegisterIdentityPayload>('/sys/register');
		if (!data?.ok) throw new Error(data?.error || '加载设备身份失败');
		setRegistrationOnline(data.registration_status === 'ONLINE' || Boolean(data.registration_finish));
		const id = data.identity ?? {};
		identityForm.setFieldsValue({
			name: id.name || undefined,
			vm_id: id.vm_id || undefined,
			pool_id: id.pool_id || undefined,
			pool_name: id.pool_name || undefined,
			uuid: id.uuid || generateSnowflakeUuid(),
			mac: id.mac || generateRandomMac(),
			type: id.type || 'VR',
			version: id.version || 'V1.0',
		});
	}, [identityForm]);

	const reloadServiceForm = async () => {
		const [csmctlRes, towerRes, aisocRes] = await Promise.all([
			api.get<{ ok?: boolean; address?: string | null }>('/sys/sdnc-csmctl'),
			api.get<{ ok: boolean; base?: string | null; login_url?: string | null }>('/sys/tower'),
			api.get<{ ok: boolean; base?: string | null }>('/aisoc/base'),
		]);
		form.setFieldsValue({
			sdnc_csmctl_address: String(csmctlRes.data?.address ?? '').trim() || undefined,
			tower_base: stripUrlToHost(String(towerRes.data?.base ?? '').trim()) || undefined,
			ai_soc_base: stripUrlToHost(String(aisocRes.data?.base ?? '').trim()) || undefined,
		});
	};

	const saveAllServices = async () => {
		try {
			await form.validateFields(['tower_base', 'sdnc_csmctl_address']);
			const values = form.getFieldsValue();
			const towerBase = normalizeUrlInput(String(values.tower_base ?? '').trim());
			const csmctlAddress = String(values.sdnc_csmctl_address ?? '').trim();
			const aisocRaw = String(values.ai_soc_base ?? '').trim();
			const aisocBase = aisocRaw ? normalizeUrlInput(aisocRaw) : '';
			setSaving(true);
			await Promise.all([
				api.post('/sys/tower', { base: towerBase }),
				api.post('/sys/sdnc-csmctl', { address: csmctlAddress }),
				api.post('/aisoc/base', { base: aisocBase }),
			]);
			await reloadServiceForm();
			message.success('已保存接入地址');
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in (e as object)) {
				message.error('请填写必填项：SDN Console、SDN CSMCTL');
				return;
			}
			message.error(e instanceof Error ? e.message : '保存失败');
		} finally {
			setSaving(false);
		}
	};

	const waitForAgentOnline = async (timeoutMs = 45000): Promise<boolean> => {
		const started = Date.now();
		while (Date.now() - started < timeoutMs) {
			try {
				const { data } = await api.get<{
					registration_status?: string;
					registration_finish?: boolean;
				}>('/forwarding/agent/status');
				if (data?.registration_status === 'ONLINE' || data?.registration_finish) return true;
			} catch {
				/* 轮询失败则继续等到超时 */
			}
			await new Promise((r) => setTimeout(r, 1500));
		}
		return false;
	};

	const saveIdentity = async () => {
		try {
			await identityForm.validateFields(['uuid', 'mac', 'type', 'version']);
			const values = identityForm.getFieldsValue(true);
			setIdentitySaving(true);
			const { data } = await api.post<RegisterIdentityPayload>('/sys/register', {
				identity: {
					name: String(values.name ?? '').trim(),
					vm_id: String(values.vm_id ?? '').trim(),
					pool_id: String(values.pool_id ?? '').trim(),
					pool_name: String(values.pool_name ?? '').trim(),
					uuid: String(values.uuid ?? '').trim(),
					mac: String(values.mac ?? '').trim(),
					type: String(values.type ?? '').trim() || 'VR',
					version: String(values.version ?? '').trim() || 'V1.0',
				},
			});
			if (!data?.ok) throw new Error(data?.error || '保存失败');
			const id = data.identity ?? {};
			identityForm.setFieldsValue({
				name: id.name || undefined,
				vm_id: id.vm_id || undefined,
				pool_id: id.pool_id || undefined,
				pool_name: id.pool_name || undefined,
				uuid: id.uuid || undefined,
				mac: id.mac || undefined,
				type: id.type || undefined,
				version: id.version || undefined,
			});
			if (registerEditor.open) void registerEditor.reload();
			if (data.instance_key_changed) {
				message.warning('UUID 已变更，控制器将按新实例注册；原 UUID 上的角色/隧道不会自动迁移');
			}
			if (!data.payload_changed && (data.registration_status === 'ONLINE' || data.registration_finish)) {
				setRegistrationOnline(true);
				message.success('IBR注册状态仍为 ONLINE');
				return;
			}
			const online = await waitForAgentOnline();
			setRegistrationOnline(online);
			if (online) {
				try {
					await api.post('/sys/sdnc/report-management-ip', {});
				} catch {
					/* 后台会补报，不在保存结果里展示 */
				}
				message.success('已保存并注册到控制器（ONLINE）');
			} else {
				message.warning(
					data.agent_poked
						? '已保存身份，尚未 ONLINE。请确认 SDN CSMCTL 可达后查看 Agent 状态'
						: '已保存身份，未唤醒到 vrctl.agent，将等待其下一轮扫描',
				);
			}
		} catch (e) {
			if (e && typeof e === 'object' && 'errorFields' in (e as object)) {
				message.error('请填写必填项：UUID、MAC、类型、版本');
				return;
			}
			message.error(e instanceof Error ? e.message : '保存失败');
		} finally {
			setIdentitySaving(false);
		}
	};

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			setIdentityLoading(true);
			try {
				await Promise.all([reloadServiceForm(), reloadIdentityForm()]);
			} catch (e) {
				if (!cancelled) message.error(e instanceof Error ? e.message : '加载失败');
			} finally {
				if (!cancelled) {
					setLoading(false);
					setIdentityLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [form, message, reloadIdentityForm]);

	const identityEditableItems: Array<{
		key: string;
		title: string;
		description: string;
		name: keyof IdentityForm;
		placeholder: string;
		required: boolean;
		requiredMessage: string;
	}> = [
		{
			key: 'name',
			title: '设备名称',
			description: '显示名，修改后仍属同一实例（不改 UUID）；空则保存时自动生成',
			name: 'name',
			placeholder: '',
			required: false,
			requiredMessage: '',
		},
		{
			key: 'vm_id',
			title: 'VM ID',
			description: '运维辅助标识；控制器主键是 UUID；空则保存时自动生成',
			name: 'vm_id',
			placeholder: '',
			required: false,
			requiredMessage: '',
		},
		{
			key: 'pool_id',
			title: '资源池 ID',
			description: '可选',
			name: 'pool_id',
			placeholder: '',
			required: false,
			requiredMessage: '',
		},
		{
			key: 'pool_name',
			title: '资源池名称',
			description: '可选',
			name: 'pool_name',
			placeholder: '',
			required: false,
			requiredMessage: '',
		},
	];

	const identityControlledItems: Array<{
		key: string;
		title: string;
		description: string;
		name: keyof IdentityForm;
		placeholder?: string;
		required: boolean;
		requiredMessage: string;
		editable: boolean;
	}> = [
		{
			key: 'uuid',
			title: 'UUID',
			description: '实例主键，空则自动生成，保存后固定不可改',
			name: 'uuid',
			placeholder: '保存后生成',
			required: true,
			requiredMessage: 'UUID 不能为空',
			editable: false,
		},
		{
			key: 'mac',
			title: 'MAC',
			description: '注册用地址，空则自动生成，可按需修改',
			name: 'mac',
			placeholder: 'XX:XX:XX:XX:XX:XX',
			required: true,
			requiredMessage: '请填写 MAC',
			editable: true,
		},
		{
			key: 'type',
			title: '类型',
			description: '默认 VR',
			name: 'type',
			required: true,
			requiredMessage: '类型不能为空',
			editable: false,
		},
		{
			key: 'version',
			title: '版本',
			description: '默认 V1.0',
			name: 'version',
			required: true,
			requiredMessage: '版本不能为空',
			editable: false,
		},
	];

	return (
		<>
			<PageStack>
				<PageHeader
					title="端点配置及IBR注册"
					description="配置 SDN Console、SDN CSMCTL、AI SOC 的接入地址，以及本机注册身份。与业务网卡初始化相互独立，可先做任意一项。"
				/>

				<Form form={form} layout="vertical" component={false}>
					<ContentBlock>
						<BlockHeader
							title="接入地址"
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
											title: 'SDN Console',
											description: 'SDN Console 管理地址',
											name: 'tower_base' as const,
											placeholder: '例如 10.21.0.60:5001',
											required: true,
											requiredMessage: '请输入 SDN Console 地址',
										},
										{
											key: 'sdnc-csmctl',
											title: 'SDN CSMCTL',
											description: 'SDN CSMCTL 控制器地址',
											name: 'sdnc_csmctl_address' as const,
											placeholder: '例如 10.21.0.60:8016',
											required: true,
											requiredMessage: '请输入 SDN CSMCTL 地址',
										},
										{
											key: 'aisoc',
											title: 'AI SOC',
											description: 'AI SOC 服务地址（可选）',
											name: 'ai_soc_base' as const,
											placeholder: '例如 10.20.254.121:8000',
											required: false,
											requiredMessage: '',
										},
									]}
									renderItem={(item) => (
										<List.Item
											key={item.key}
											extra={
												<Form.Item
													name={item.name}
													noStyle
													rules={
														item.required
															? [{ required: true, whitespace: true, message: item.requiredMessage }]
															: []
													}
												>
													<Input
														className="app-settings-list-input"
														placeholder={item.placeholder}
														disabled={loading || saving}
														allowClear={!item.required}
													/>
												</Form.Item>
											}
										>
											<List.Item.Meta
												title={
													<span>
														{item.required ? <span className="app-settings-required-mark">*</span> : null}
														{item.title}
													</span>
												}
												description={item.description}
											/>
										</List.Item>
									)}
								/>
							</Spin>
						</Card>
					</ContentBlock>
				</Form>

				<Form form={identityForm} layout="vertical" component={false}>
					<ContentBlock>
						<BlockHeader
							title="设备身份"
							action={
								<Space>
									{registrationOnline === true ? (
										<Tag color="green">IBR注册状态：ONLINE</Tag>
									) : registrationOnline === false ? (
										<Tag>IBR注册状态：OFFLINE</Tag>
									) : null}
									<Button
										type="primary"
										loading={identitySaving}
										disabled={identityLoading}
										onClick={() => void saveIdentity()}
									>
										保存
									</Button>
								</Space>
							}
						/>
						<Card variant="list">
							<Spin spinning={identityLoading}>
								<List
									split
									className="app-settings-list"
									dataSource={identityEditableItems}
									renderItem={(item) => (
										<List.Item
											key={item.key}
											extra={
												<Form.Item
													name={item.name}
													noStyle
													rules={
														item.required
															? [{ required: true, whitespace: true, message: item.requiredMessage }]
															: []
													}
												>
													<Input
														className="app-settings-list-input app-settings-list-input-fill"
														placeholder={item.placeholder}
														disabled={identityLoading || identitySaving}
														allowClear={!item.required}
													/>
												</Form.Item>
											}
										>
											<List.Item.Meta
												title={
													<span>
														{item.required ? <span className="app-settings-required-mark">*</span> : null}
														{item.title}
													</span>
												}
												description={item.description}
											/>
										</List.Item>
									)}
								/>
								<List
									split
									className="app-settings-list"
									style={{ borderTop: '1px solid var(--app-border, #f0f0f0)' }}
									dataSource={identityControlledItems}
									renderItem={(item) => (
										<List.Item
											key={item.key}
											extra={
												<Form.Item
													name={item.name}
													noStyle
													rules={
														item.required
															? [{ required: true, whitespace: true, message: item.requiredMessage }]
															: []
													}
												>
													<Input
														className="app-settings-list-input"
														placeholder={item.placeholder || '（未生成）'}
														disabled={identityLoading || identitySaving || !item.editable}
														readOnly={!item.editable}
													/>
												</Form.Item>
											}
										>
											<List.Item.Meta
												title={
													<span>
														{item.required ? <span className="app-settings-required-mark">*</span> : null}
														{item.title}
													</span>
												}
												description={item.description}
											/>
										</List.Item>
									)}
								/>
							</Spin>
						</Card>
					</ContentBlock>
				</Form>

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

			<ConfigFileDrawer
				open={registerEditor.open}
				onClose={registerEditor.closeDrawer}
				fileName="registervr.conf"
				filePath="/usr/local/src/vrconf/registervr.conf"
				hint="日常请用上方「设备身份」表单；此处为专家整文件编辑，误改 uuid/mac 可能导致注册断链。"
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
