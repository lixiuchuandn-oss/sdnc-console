import { QuestionCircleOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Form, Input, Modal, Radio, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';
import {
	buildUnattachedPciSelectOptions,
	findNicRoleByPci,
	formatPciNicSelectLabel,
	type NicRoleRowLike,
	type PciNicBrief,
} from './nicRoleResolve';

type InitMode = 'static' | 'dhcp';

type StatusResp = {
	init_mode: InitMode;
	pci_nics: PciNicBrief[];
	mgmt_pci: string | null;
	wan_pci?: string | null;
	lan_pci?: string | null;
	nics_initialized: boolean;
	os_nic_attach_pci: string[] | null;
	nic_roles?: { roles?: NicRoleRowLike[] } | null;
};

export function NicInitPage() {
	const navigate = useNavigate();
	const { message } = AntApp.useApp();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<StatusResp | null>(null);
	const [previewOpen, setPreviewOpen] = useState(false);
	const [previewContent, setPreviewContent] = useState('');
	const [previewNote, setPreviewNote] = useState('');
	const [previewNeedsRestart, setPreviewNeedsRestart] = useState(true);
	const [pendingPayload, setPendingPayload] = useState<{
		mode: InitMode;
		nics: { pci: string; role: 'wan' | 'lan' }[];
		attach_pci?: string[];
	} | null>(null);

	const [form] = Form.useForm<{
		mode: InitMode;
		wan_pci?: string;
		lan_pci?: string;
	}>();
	const mode = (Form.useWatch('mode', form) as InitMode | undefined) ?? 'static';
	const watchedWan = String(Form.useWatch('wan_pci', form) ?? '');

	const applyStatusToForm = useCallback(
		(data: StatusResp) => {
			setStatus(data);
			const wan = String(data.wan_pci ?? '').trim();
			const lan = String(data.lan_pci ?? '').trim();
			const ready = Boolean(wan) && (data.init_mode === 'dhcp' ? true : Boolean(lan));
			form.setFieldsValue({
				mode: data.init_mode ?? 'static',
				wan_pci: ready ? wan || undefined : undefined,
				lan_pci: ready ? lan || undefined : undefined,
			});
			if (!ready) form.resetFields(['wan_pci', 'lan_pci']);
		},
		[form],
	);

	const reloadStatus = useCallback(async () => {
		const { data } = await api.get<StatusResp>('/status');
		applyStatusToForm(data);
	}, [applyStatusToForm]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			setError(null);
			try {
				const { data } = await api.get<StatusResp>('/status');
				if (cancelled) return;
				applyStatusToForm(data);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [applyStatusToForm]);

	const mgmtPci = status?.mgmt_pci ?? null;
	const roles = status?.nic_roles?.roles ?? [];
	/** 与辅助口页一致：仅 WAN/LAN 身份写全才算初始化完成（禁止仅凭 attach 非空收起选型）。 */
	const identityReady = useMemo(() => {
		const wan = String(status?.wan_pci ?? '').trim();
		const lan = String(status?.lan_pci ?? '').trim();
		if (!wan) return false;
		return status?.init_mode === 'dhcp' ? true : Boolean(lan);
	}, [status]);
	const labelForPci = useCallback(
		(pci: string | null | undefined) => {
			const p = String(pci ?? '').trim();
			if (!p) return '-';
			const nic = (status?.pci_nics ?? []).find((x) => String(x.pci ?? '').trim() === p);
			return formatPciNicSelectLabel(nic ?? { pci: p }, findNicRoleByPci(roles, p));
		},
		[status, roles],
	);
	const attachedLabels = useMemo(
		() => (status?.os_nic_attach_pci ?? []).map((pci) => labelForPci(pci)).filter((x) => x && x !== '-'),
		[status, labelForPci],
	);

	const businessOptions = useMemo(() => {
		if (identityReady) {
			const wanted = [String(status?.wan_pci ?? '').trim(), String(status?.lan_pci ?? '').trim()].filter(Boolean);
			return wanted.map((pci) => ({
				value: pci,
				label: formatPciNicSelectLabel(
					(status?.pci_nics ?? []).find((x) => String(x.pci ?? '').trim() === pci) ?? { pci },
					findNicRoleByPci(roles, pci),
				),
			}));
		}
		return buildUnattachedPciSelectOptions({
			pciNics: status?.pci_nics,
			mgmtPci,
			attachedPcis: [],
			roles,
		});
	}, [status, mgmtPci, roles, identityReady]);

	const lanOptions = useMemo(
		() => businessOptions.map((o) => ({ ...o, disabled: o.value === watchedWan })),
		[businessOptions, watchedWan],
	);

	if (loading) {
		return (
			<PageStack>
				<PageHeader title="初始化网卡" description="选定 WAN/LAN 并清理口级配置；全局业务保留。" />
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
				<PageHeader title="初始化网卡" description="选定 WAN/LAN 并清理口级配置；全局业务保留。" />
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
				<PageHeader
					title="初始化网卡"
					description={
						identityReady
							? 'WAN/LAN 已选定，配置只读。更换请先恢复出厂设置。'
							: '选定 WAN/LAN 并写入本机角色。新机口上暂无地址属正常，可接着设置网口IP。'
					}
				/>

				<ContentBlock>
					<BlockHeader title="当前状态" />
					<Card variant="padded">
						{identityReady ? (
							<Space direction="vertical" size={10} style={{ width: '100%' }}>
								<Space size={8} wrap>
									<Tag color="success">已初始化</Tag>
									<Typography.Text type="secondary">
										{status.init_mode === 'dhcp' ? 'DHCP 模式' : '静态模式'}
									</Typography.Text>
								</Space>
								<div style={{ display: 'grid', gap: 8 }}>
									{mgmtPci ? (
										<div>
											<Typography.Text type="secondary">管理口（OS）</Typography.Text>
											<div>
												<Typography.Text>{labelForPci(mgmtPci)}</Typography.Text>
											</div>
										</div>
									) : null}
									{status.wan_pci ? (
										<div>
											<Typography.Text type="secondary">WAN</Typography.Text>
											<div>
												<Typography.Text strong style={{ color: '#389e0d' }}>
													{labelForPci(status.wan_pci)}
												</Typography.Text>
											</div>
										</div>
									) : null}
									{status.lan_pci ? (
										<div>
											<Typography.Text type="secondary">LAN</Typography.Text>
											<div>
												<Typography.Text strong style={{ color: '#389e0d' }}>
													{labelForPci(status.lan_pci)}
												</Typography.Text>
											</div>
										</div>
									) : null}
									{(status.os_nic_attach_pci ?? [])
										.filter((pci) => {
											const p = String(pci).trim();
											return p && p !== status.wan_pci && p !== status.lan_pci;
										})
										.map((pci) => (
											<div key={pci}>
												<Typography.Text type="secondary">辅助口</Typography.Text>
												<div>
													<Typography.Text strong style={{ color: '#389e0d' }}>
														{labelForPci(pci)}
													</Typography.Text>
												</div>
											</div>
										))}
								</div>
							</Space>
						) : (
							<Space size={8} wrap>
								<Tag color="warning">未初始化</Tag>
								{attachedLabels.length ? (
									<Typography.Text type="secondary">清单已有口但身份未齐，请继续选定</Typography.Text>
								) : (
									<Typography.Text type="secondary">请选择模式与 WAN/LAN</Typography.Text>
								)}
							</Space>
						)}
					</Card>
				</ContentBlock>

				<ContentBlock>
					<BlockHeader title={identityReady ? '初始化配置（只读）' : '初始化配置'} />
					<Card variant="padded">
						<Form
							form={form}
							layout="vertical"
							disabled={identityReady}
							onFinish={async (values) => {
								const nextMode = values.mode ?? 'static';
								const wan = values.wan_pci?.trim() || '';
								const lan = values.lan_pci?.trim() || '';
								const attach_pci = Array.from(new Set([wan, lan].map((x) => x.trim()).filter(Boolean)));
								if (!wan) {
									setError('请选择 WAN 口');
									return;
								}
								if (nextMode === 'static' && !lan) {
									setError('请选择 LAN 口');
									return;
								}
								if (lan && wan === lan) {
									setError('WAN 与 LAN 不能是同一块网卡');
									return;
								}

								setSaving(true);
								setError(null);
								try {
									await api.post('/nics/mode', { mode: nextMode });
									const payload = {
										mode: nextMode,
										nics: [
											{ pci: wan, role: 'wan' as const },
											...(lan ? [{ pci: lan, role: 'lan' as const }] : []),
										],
										attach_pci: attach_pci.length > 0 ? attach_pci : undefined,
									};
									setPendingPayload(payload);
									const { data } = await api.post<{
										ok: boolean;
										config_content: string;
										preview_note?: string;
										message?: string;
										requires_vbras_restart?: boolean;
										error?: string;
									}>('/nics/preview_config', payload);
									if (!data?.ok) throw new Error(data?.error || '生成配置失败');
									setPreviewContent(String(data.config_content ?? ''));
									setPreviewNote(String(data.preview_note ?? data.message ?? ''));
									setPreviewNeedsRestart(Boolean(data.requires_vbras_restart));
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
											title="管理口不会被接管；选成 WAN/LAN 的旧业务口会清掉口上地址。"
										>
											<QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)', cursor: 'help' }} />
										</Tooltip>
									</Space>
								}
								name="mode"
								rules={[{ required: true, message: '请选择模式' }]}
							>
								<Radio.Group
									disabled={identityReady}
									options={[
										{ label: '静态模式（3 网口）', value: 'static' },
										{ label: 'DHCP 模式（2 网口）', value: 'dhcp' },
									]}
								/>
							</Form.Item>

							<Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
								管理口由系统自动选定：仍在操作系统中、PCI 序号最小的物理网卡（当前 {labelForPci(mgmtPci)}），初始化不改此口。
								{identityReady ? '' : mode === 'static' ? ' 请选定 WAN 与 LAN。' : ' 请选定 WAN（必选），LAN 可选。'}
							</Typography.Paragraph>

							{identityReady ? (
								<Form.Item label="WAN 口">
									<Input readOnly value={labelForPci(status.wan_pci)} />
								</Form.Item>
							) : (
								<Form.Item label="WAN 口" name="wan_pci" rules={[{ required: true, message: '请选择 WAN 口' }]}>
									<Select
										placeholder={businessOptions.length ? '选择网卡' : '无可用网卡'}
										options={businessOptions}
										optionFilterProp="label"
										showSearch
										disabled={businessOptions.length === 0}
										onChange={(nextWan) => {
											const nextLan = String(form.getFieldValue('lan_pci') ?? '');
											if (nextWan && nextLan && nextWan === nextLan) form.setFieldsValue({ lan_pci: undefined });
										}}
									/>
								</Form.Item>
							)}

							{identityReady ? (
								<Form.Item label={mode === 'dhcp' ? 'LAN 口（可选）' : 'LAN 口'}>
									<Input readOnly value={status.lan_pci ? labelForPci(status.lan_pci) : '-'} />
								</Form.Item>
							) : (
								<Form.Item
									label={mode === 'dhcp' ? 'LAN 口（可选）' : 'LAN 口'}
									name="lan_pci"
									rules={mode === 'static' ? [{ required: true, message: '请选择 LAN 口' }] : []}
								>
									<Select
										allowClear={mode === 'dhcp'}
										placeholder={mode === 'dhcp' ? '可不选' : businessOptions.length ? '选择网卡' : '无可用网卡'}
										options={lanOptions}
										optionFilterProp="label"
										showSearch
										disabled={businessOptions.length === 0}
									/>
								</Form.Item>
							)}

							{error ? (
								<Typography.Paragraph type="danger" style={{ marginTop: 0 }}>
									{error}
								</Typography.Paragraph>
							) : null}

							{identityReady ? null : (
							<Space>
								<Button type="primary" htmlType="submit" loading={saving} disabled={businessOptions.length === 0}>
									执行初始化
								</Button>
								<Button onClick={() => navigate('/')}>取消</Button>
							</Space>
							)}
						</Form>
					</Card>
				</ContentBlock>
			</PageStack>
			<Modal
				title="接口配置预览"
				open={previewOpen}
				okText={previewNeedsRestart ? '应用并重启 VBRAS' : '应用'}
				cancelText="取消"
				onCancel={() => setPreviewOpen(false)}
				onOk={async () => {
					if (!pendingPayload) return;
					setSaving(true);
					setError(null);
					try {
						const { data } = await api.post<{
							ok: boolean;
							logs?: string[];
							attach_pci?: string[];
							vbras_restarted?: boolean;
							error?: string;
						}>('/nics/apply_restart', pendingPayload);
						if (!data?.ok) throw new Error(data?.error || '应用失败');
						setPreviewOpen(false);
						setPendingPayload(null);
						message.success(
							data.vbras_restarted
								? '初始化完成（已重启数据面）。可去设置网口IP。'
								: '初始化完成。可去设置网口IP。',
						);
						await reloadStatus();
					} catch (e) {
						setError(e instanceof Error ? e.message : '应用失败');
					} finally {
						setSaving(false);
					}
				}}
				okButtonProps={{ loading: saving, danger: previewNeedsRestart }}
			>
				<Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
					{previewNote || '确认后应用；仅清相关口配置。'}
				</Typography.Paragraph>
				<pre className="app-code-block app-code-block-inset app-code-block-tall">{previewContent || '(空)'}</pre>
			</Modal>
		</>
	);
}
