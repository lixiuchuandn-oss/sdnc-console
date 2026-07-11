import { App as AntApp, Button, Form, Input, Select, Tabs, Typography, message } from 'antd';
import { useState } from 'react';
import { api, publicApi, setToken } from '../api/client';

type AccountLoginResp = {
	account?: { access_token?: string; username?: string };
	bind?: { status?: string; vr_unique_id?: string; error?: string; reason?: string };
};

type Props = {
	onAuthed: () => void;
};

export function LoginPage({ onAuthed }: Props) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState('account');

	const verifyBearer = async (token: string, opts?: { persistSession?: boolean }) => {
		setToken(token);
		if (opts?.persistSession) {
			await publicApi.post('/session', { token });
		}
		const { data } = await api.get<{ sub?: string }>('/me');
		if (!data?.sub) {
			throw new Error('登录验证失败，请重试');
		}
		onAuthed();
	};

	return (
		<AntApp>
			<div style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '64px 24px' }}>
				<div style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>
					<Typography.Title level={3} style={{ marginTop: 0 }}>
						IBR 登录
					</Typography.Title>
					<Typography.Paragraph type="secondary">
						使用平台账号登录，或粘贴访问令牌。令牌仅保存在本机浏览器。
					</Typography.Paragraph>

					<Tabs
						activeKey={tab}
						onChange={(k) => {
							setTab(k);
							setError(null);
						}}
						items={[
							{
								key: 'account',
								label: '平台账号',
								children: (
									<Form
										layout="vertical"
										initialValues={{ vr_type: 'sase' }}
										onFinish={async (values: { username: string; password: string; vr_type: string }) => {
											setSaving(true);
											setError(null);
											try {
												const { data } = await publicApi.post<AccountLoginResp>('/account/login', {
													username: values.username.trim(),
													password: values.password,
													vr_type: values.vr_type || 'sase',
												});
												const t = data.account?.access_token?.trim();
												if (!t) {
													throw new Error('登录未返回有效令牌');
												}
												const b = data.bind;
												if (b?.status === 'BOUND' && b.vr_unique_id) {
													message.success('登录成功');
												} else if (b?.status === 'FAILED' && b.error) {
													message.warning('已登录，但设备绑定未完成');
												} else if (b?.status === 'SKIPPED') {
													message.warning('已登录，设备绑定已跳过');
												} else {
													message.success('登录成功');
												}
												await verifyBearer(t);
											} catch (e) {
												setToken(null);
												setError(e instanceof Error ? e.message : '登录失败');
											} finally {
												setSaving(false);
											}
										}}
									>
										<Form.Item name="username" label="平台登录账号" rules={[{ required: true, message: '请输入账号' }]}>
											<Input autoComplete="username" placeholder="平台账号" />
										</Form.Item>
										<Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
											<Input.Password autoComplete="current-password" />
										</Form.Item>
										<Form.Item name="vr_type" label="VR 类型（绑定用）">
											<Select
												options={[
													{ value: 'sase', label: 'SASE' },
												]}
											/>
										</Form.Item>
										{error && tab === 'account' ? (
											<Typography.Paragraph type="danger" style={{ marginTop: 0 }}>
												{error}
											</Typography.Paragraph>
										) : null}
										<Button type="primary" htmlType="submit" loading={saving}>
											登录
										</Button>
									</Form>
								),
							},
							{
								key: 'token',
								label: '访问令牌',
								children: (
									<Form
										layout="vertical"
										onFinish={async (values: { token: string }) => {
											setSaving(true);
											setError(null);
											try {
												await verifyBearer(values.token.trim(), { persistSession: true });
												message.success('登录成功');
											} catch (e) {
												setToken(null);
												setError(e instanceof Error ? e.message : '验证失败');
											} finally {
												setSaving(false);
											}
										}}
									>
										<Form.Item
											label="访问令牌"
											name="token"
											rules={[{ required: true, message: '请输入访问令牌' }]}
										>
											<Input.TextArea rows={5} placeholder="粘贴访问令牌" />
										</Form.Item>
										{error && tab === 'token' ? (
											<Typography.Paragraph type="danger" style={{ marginTop: 0 }}>
												{error}
											</Typography.Paragraph>
										) : null}
										<Button type="primary" htmlType="submit" loading={saving}>
											登录
										</Button>
									</Form>
								),
							},
						]}
					/>
				</div>
			</div>
		</AntApp>
	);
}
