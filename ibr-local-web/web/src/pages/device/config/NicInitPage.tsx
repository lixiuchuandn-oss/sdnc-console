import { QuestionCircleOutlined } from '@ant-design/icons';
import { Button, Divider, Form, Modal, Radio, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';

type InitMode = 'static' | 'dhcp';

type StatusResp = {
	init_mode: InitMode;
	pci_nics: { pci: string }[];
	mgmt_pci: string | null;
	nics_initialized: boolean;
	os_nic_attach_pci: string[] | null;
	vr_name?: string;
	net_overview?: {
		wan?: { name: string; ip: string; source: 'os' | 'vpp'; attached: boolean; gateway?: string | null };
		lan?: { name: string; ip: string; source: 'os' | 'vpp'; attached: boolean; gateway?: string | null };
	};
	net_init_ok?: boolean;
	last_apply?: { public_ip?: string; public_gw?: string | null; private_ip?: string } | null;
};

export function NicInitPage() {
	const navigate = useNavigate();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<StatusResp | null>(null);
	const [previewOpen, setPreviewOpen] = useState(false);
	const [previewContent, setPreviewContent] = useState('');
	const [pendingPayload, setPendingPayload] = useState<{
		mode: InitMode;
		nics: { pci: string; role: 'wan' | 'lan' }[];
		attach_pci?: string[];
	} | null>(null);
	const [restartOpen, setRestartOpen] = useState(false);
	const [restartLogs, setRestartLogs] = useState<string[]>([]);

	const [form] = Form.useForm<{
		mode: InitMode;
		wan_pci?: string;
		lan_pci?: string;
		extra_pcis?: string[];
	}>();

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			setError(null);
			try {
				const { data } = await api.get<StatusResp>('/status');
				if (cancelled) return;
				setStatus(data);
				form.setFieldsValue({
					mode: data.init_mode ?? 'static',
					wan_pci: undefined,
					lan_pci: undefined,
				});
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [form]);

	const pcis = useMemo(() => (status?.pci_nics ?? []).map((x) => x.pci).filter(Boolean), [status]);
	const mgmtPci = status?.mgmt_pci ?? null;

	const options = useMemo(
		() =>
			pcis.map((pci) => ({
				label: pci === mgmtPci ? `${pci}（默认管理口）` : pci,
				value: pci,
				disabled: false,
			})),
		[pcis, mgmtPci],
	);

	const businessOptionsStatic = useMemo(() => options.filter((o) => o.value !== mgmtPci), [options, mgmtPci]);

	if (loading) {
		return (
			<PageStack>
				<PageHeader title="初始化网卡" description="选择模式并绑定 WAN、LAN 网卡。" />
				<ContentBlock>
					<Card variant="padded">
						<Spin />
					</Card>
				</ContentBlock>
			</PageStack>
		);
	}

	if (!status) {
		return (
			<PageStack>
				<PageHeader title="初始化网卡" description="选择模式并绑定 WAN、LAN 网卡。" />
				<ContentBlock>
					<Card variant="padded">
						<Typography.Paragraph type="danger" style={{ marginTop: 0 }}>
							{error ?? '无法加载状态'}
						</Typography.Paragraph>
						<Button onClick={() => window.location.reload()}>重试</Button>
					</Card>
				</ContentBlock>
			</PageStack>
		);
	}

	return (
		<>
			<PageStack>
				<PageHeader title="初始化网卡" description="选择模式并绑定 WAN、LAN 网卡。" />

				<ContentBlock>
					<BlockHeader title="当前状态" />
					<Card variant="padded">
						<Space size={8} wrap>
							<Tag color={status.nics_initialized ? 'success' : 'warning'}>{status.nics_initialized ? '已初始化' : '未初始化'}</Tag>
							{status.nics_initialized ? (
								<Typography.Text type="secondary">
									模式：{status.init_mode === 'dhcp' ? 'DHCP' : '静态'}，已绑定 PCI：{(status.os_nic_attach_pci ?? []).join(', ') || '-'}
								</Typography.Text>
							) : (
								<Typography.Text type="secondary">请选择模式与网卡并执行初始化</Typography.Text>
							)}
						</Space>
					</Card>
				</ContentBlock>

				<ContentBlock>
					<BlockHeader title="初始化配置" />
					<Card variant="padded">
					<Form
						form={form}
						layout="vertical"
						onFinish={async (values) => {
							const mode = values.mode ?? 'static';
							const wan = values.wan_pci?.trim() || '';
							const lan = values.lan_pci?.trim() || '';
							const extra = Array.isArray(values.extra_pcis) ? values.extra_pcis.map((x) => String(x).trim()).filter(Boolean) : [];
							const attach_pci = Array.from(new Set([wan, lan, ...extra].map((x) => x.trim()).filter(Boolean)));

							setSaving(true);
							setError(null);
							try {
								await api.post('/nics/mode', { mode });
								const payload =
									mode === 'dhcp'
										? { mode, nics: [] as { pci: string; role: 'wan' | 'lan' }[] }
										: {
												mode,
												nics: [...(wan ? [{ pci: wan, role: 'wan' as const }] : []), ...(lan ? [{ pci: lan, role: 'lan' as const }] : [])],
												attach_pci: attach_pci.length > 0 ? attach_pci : undefined,
											};
								setPendingPayload(payload);
								const { data } = await api.post<{ ok: boolean; config_content: string; message?: string; error?: string }>('/nics/preview_config', payload);
								if (!data?.ok) throw new Error(data?.error || '生成配置失败');
								setPreviewContent(String(data.config_content ?? ''));
								setPreviewOpen(true);
							} catch (e) {
								setError(e instanceof Error ? e.message : '初始化失败');
							} finally {
								setSaving(false);
							}
						}}
					>
						<Form.Item
							label={
								<Space size={6} align="center">
									<span>初始化模式</span>
									<Tooltip
										placement="right"
										overlayStyle={{ maxWidth: 520 }}
										title={
											<Space direction="vertical" size={8} style={{ width: '100%' }}>
												<div>登记业务网口并清这些口的 IP/口级绑定；仅当目标口尚未进入 VPP 数据面（或仍在 OS）时才短中断重启。</div>
												<div>
													<div style={{ fontWeight: 600, marginBottom: 4 }}>静态模式（3 网口）</div>
													<ul style={{ margin: 0, paddingLeft: 18 }}>
														<li>管理口保留 OS；WAN/LAN 交 VBRAS</li>
														<li>startup-config 按口合并，非整文件覆盖</li>
														<li>interface 由 PCI 号生成，请按实际 PCI 选择</li>
													</ul>
												</div>
												<div>
													<div style={{ fontWeight: 600, marginBottom: 4 }}>DHCP 模式（2 网口）</div>
													<ul style={{ margin: 0, paddingLeft: 18 }}>
														<li>排除管理口后接管其余物理网卡，口上写 DHCP</li>
														<li>WAN/LAN 身份按接管序写入（不是全量 PCI 下标）</li>
														<li>VBRAS 会对接口下发 DHCP 配置，需确保网络侧有 DHCP 服务</li>
													</ul>
												</div>
											</Space>
										}
									>
										<QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)', cursor: 'help' }} />
									</Tooltip>
								</Space>
							}
							name="mode"
							rules={[{ required: true, message: '请选择模式' }]}
						>
							<Radio.Group
								options={[
									{ label: '静态模式（3 网口）', value: 'static' },
									{ label: 'DHCP 模式（2 网口）', value: 'dhcp' },
								]}
							/>
						</Form.Item>

						<Divider style={{ margin: '12px 0' }} />

						<Form.Item shouldUpdate noStyle>
							{() => {
								const mode = (form.getFieldValue('mode') as InitMode) ?? 'static';
								return (
									<>
										{mode === 'static' ? (
											<Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
												管理口默认使用仍在 OS 的物理口（mgmt_pci）：{mgmtPci ?? '-'}
											</Typography.Paragraph>
										) : (
											<Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
												DHCP 排除管理口后按接管序写入 WAN/LAN 身份（不是全量 PCI 下标第一块）。执行可能 down 网卡；仅当目标口尚未进入 VPP 数据面时才重启。
											</Typography.Paragraph>
										)}

										{mode === 'static' ? (
											<>
												<Form.Item label="WAN 口（PCI）" name="wan_pci" rules={[{ required: true, message: '请选择 WAN 口' }]}>
													<Select
														placeholder="选择 PCI"
														options={businessOptionsStatic}
														onChange={() => {
															const wan = String(form.getFieldValue('wan_pci') ?? '');
															const lan = String(form.getFieldValue('lan_pci') ?? '');
															if (wan && lan && wan === lan) {
																form.setFieldsValue({ lan_pci: undefined });
															}
														}}
													/>
												</Form.Item>

												<Form.Item label="LAN 口（PCI）" name="lan_pci" rules={[{ required: true, message: '请选择 LAN 口' }]}>
													<Select
														placeholder="选择 PCI"
														options={businessOptionsStatic.map((o) => {
															const wan = String(form.getFieldValue('wan_pci') ?? '');
															const disabled = o.value === wan || o.value === mgmtPci;
															return { ...o, disabled };
														})}
													/>
												</Form.Item>

												<Form.Item label="辅助 LAN 口（可选，最多 4 块）" name="extra_pcis">
													<Select
														mode="multiple"
														placeholder="选择需要接管的额外网卡（可选）"
														options={businessOptionsStatic
															.filter((o) => {
																const wan = String(form.getFieldValue('wan_pci') ?? '');
																const lan = String(form.getFieldValue('lan_pci') ?? '');
																return o.value !== wan && o.value !== lan;
															})
															.map((o) => ({ ...o, disabled: false }))}
														onChange={(vals) => {
															const list = Array.isArray(vals) ? vals.map((x) => String(x)) : [];
															if (list.length > 4) {
																form.setFieldsValue({ extra_pcis: list.slice(0, 4) });
															}
														}}
													/>
												</Form.Item>
											</>
										) : null}
									</>
								);
							}}
						</Form.Item>

						{error ? (
							<Typography.Paragraph type="danger" style={{ marginTop: 0 }}>
								{error}
							</Typography.Paragraph>
						) : null}

						<Space>
							<Button type="primary" htmlType="submit" loading={saving}>
								执行初始化
							</Button>
							<Button onClick={() => navigate('/')}>取消</Button>
						</Space>
					</Form>
					</Card>
				</ContentBlock>
			</PageStack>
			<Modal
				title="生成的配置预览"
				open={previewOpen}
				okText="应用配置并重启 VBRAS"
				cancelText="取消"
				onCancel={() => {
					setPreviewOpen(false);
				}}
				onOk={async () => {
					if (!pendingPayload) return;
					setSaving(true);
					setError(null);
					try {
						const { data } = await api.post<{ ok: boolean; logs?: string[]; attach_pci?: string[]; error?: string }>('/nics/apply_restart', pendingPayload);
						if (!data?.ok) throw new Error(data?.error || '重启失败');
						setPreviewOpen(false);
						setRestartLogs(Array.isArray(data.logs) ? data.logs.map((x) => String(x)) : []);
						setRestartOpen(true);
					} catch (e) {
						setError(e instanceof Error ? e.message : '重启失败');
					} finally {
						setSaving(false);
					}
				}}
				okButtonProps={{ loading: saving }}
			>
				<Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
					确认无误后点击“应用配置并重启 VBRAS”。
				</Typography.Paragraph>
				<pre className="app-code-block app-code-block-inset app-code-block-tall">{previewContent || '(空)'}</pre>
			</Modal>
			<Modal
				title="重启执行日志"
				open={restartOpen}
				okText="进入控制台"
				cancelText="关闭"
				onCancel={() => setRestartOpen(false)}
				onOk={() => {
					setRestartOpen(false);
					navigate('/', { replace: true });
				}}
			>
				<pre className="app-code-block app-code-block-inset app-code-block-tall">{(restartLogs ?? []).join('\n') || '(无日志)'}</pre>
			</Modal>
		</>
	);
}
