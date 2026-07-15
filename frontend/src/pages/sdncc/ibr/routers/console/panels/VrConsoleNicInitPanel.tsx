import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Divider, Form, Radio, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { getApiErrorMessage } from '../../../../../../services/api';
import {
	applyIbrDeviceNicInitRestart,
	fetchIbrDeviceStatus,
	previewIbrDeviceNicInit,
	setIbrDeviceNicMode,
	type IbrDeviceInitMode,
	type IbrDeviceNicInitPayload,
	type IbrDeviceStatusResp,
} from '../../../../../../services/ibrDeviceOpsApi';
import { useIbrConsoleWritePermission } from '../lib/useIbrConsoleWritePermission';
import { ConsoleOpsModal } from '../lib/forwardPanelUi';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

type Props = {
	vrUuid: string;
	managementIp: string;
};

type FormValues = {
	mode: IbrDeviceInitMode;
	wan_pci?: string;
	lan_pci?: string;
	extra_pcis?: string[];
};

export const VrConsoleNicInitPanel: React.FC<Props> = ({ vrUuid, managementIp }) => {
	const canWrite = useIbrConsoleWritePermission('networks.vr-config:write');

	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [status, setStatus] = useState<IbrDeviceStatusResp | null>(null);

	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [previewOpen, setPreviewOpen] = useState(false);
	const [previewContent, setPreviewContent] = useState('');
	const [pendingPayload, setPendingPayload] = useState<IbrDeviceNicInitPayload | null>(null);
	const [restartOpen, setRestartOpen] = useState(false);
	const [restartLogs, setRestartLogs] = useState<string[]>([]);

	const [form] = Form.useForm<FormValues>();

	const loadStatus = useCallback(async () => {
		setRefreshing(true);
		setLoadError(null);
		try {
			const data = await fetchIbrDeviceStatus(vrUuid, { skipCache: true });
			setStatus(data);
			form.setFieldsValue({
				mode: data.init_mode === 'dhcp' ? 'dhcp' : 'static',
				wan_pci: undefined,
				lan_pci: undefined,
				extra_pcis: undefined,
			});
		} catch (e) {
			setLoadError(getApiErrorMessage(e, '加载设备状态失败'));
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, [vrUuid, form]);

	useEffect(() => {
		setLoading(true);
		void loadStatus();
	}, [loadStatus]);

	const pcis = useMemo(
		() => (status?.pci_nics ?? []).map((x) => String(x.pci ?? '').trim()).filter(Boolean),
		[status],
	);
	const mgmtPci = status?.mgmt_pci ?? null;

	const options = useMemo(
		() =>
			pcis.map((pci) => ({
				label: pci === mgmtPci ? `${pci}（默认管理口）` : pci,
				value: pci,
			})),
		[pcis, mgmtPci],
	);

	const businessOptionsStatic = useMemo(
		() => options.filter((o) => o.value !== mgmtPci),
		[options, mgmtPci],
	);

	const buildPayload = (values: FormValues): IbrDeviceNicInitPayload => {
		const mode = values.mode ?? 'static';
		const wan = values.wan_pci?.trim() || '';
		const lan = values.lan_pci?.trim() || '';
		const extra = Array.isArray(values.extra_pcis)
			? values.extra_pcis.map((x) => String(x).trim()).filter(Boolean)
			: [];
		const attach_pci = Array.from(new Set([wan, lan, ...extra].map((x) => x.trim()).filter(Boolean)));

		if (mode === 'dhcp') {
			return { mode, nics: [] };
		}
		return {
			mode,
			nics: [
				...(wan ? [{ pci: wan, role: 'wan' as const }] : []),
				...(lan ? [{ pci: lan, role: 'lan' as const }] : []),
			],
			attach_pci: attach_pci.length > 0 ? attach_pci : undefined,
		};
	};

	const onSubmit = async (values: FormValues) => {
		if (!canWrite) return;
		setSaving(true);
		setError(null);
		try {
			const payload = buildPayload(values);
			await setIbrDeviceNicMode(vrUuid, { mode: payload.mode });
			setPendingPayload(payload);
			const preview = await previewIbrDeviceNicInit(vrUuid, payload);
			if (!preview?.ok) throw new Error(preview?.error || '生成配置失败');
			setPreviewContent(String(preview.config_content ?? ''));
			setPreviewOpen(true);
		} catch (e) {
			setError(getApiErrorMessage(e, '初始化失败'));
		} finally {
			setSaving(false);
		}
	};

	const confirmApplyRestart = async () => {
		if (!pendingPayload || !canWrite) return;
		setSaving(true);
		setError(null);
		try {
			const data = await applyIbrDeviceNicInitRestart(vrUuid, pendingPayload);
			if (!data?.ok) throw new Error(data?.error || '重启失败');
			setPreviewOpen(false);
			setRestartLogs(Array.isArray(data.logs) ? data.logs.map(String) : []);
			setRestartOpen(true);
			await loadStatus();
		} catch (e) {
			setError(getApiErrorMessage(e, '重启失败'));
		} finally {
			setSaving(false);
		}
	};

	if (!managementIp) {
		return <VrConsoleNoDevicePanel />;
	}

	if (loading && !status) {
		return (
			<div className="ibr-console-ops-panel">
				<div className="ibr-console-ops-loading">
					<Spin tip="加载网卡状态…" />
				</div>
			</div>
		);
	}

	if (!status) {
		return (
			<div className="ibr-console-ops-panel">
				<div className="ibr-console-ops-section">
					<Typography.Paragraph type="danger" className="ibr-console-ops-error">
						{loadError ?? '无法加载状态'}
					</Typography.Paragraph>
					<Button onClick={() => void loadStatus()}>重试</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="ibr-console-ops-panel">
			<div className="ibr-console-ops-section">
				<div className="ibr-console-ops-section-head">
					<Typography.Text className="ibr-console-ops-section-title">当前状态</Typography.Text>
					<Button
						type="text"
						className="ibr-console-ops-text-btn"
						icon={<ReloadOutlined spin={refreshing} />}
						onClick={() => void loadStatus()}
						disabled={refreshing || saving}
					>
						刷新
					</Button>
				</div>
				<div className="ibr-console-ops-card">
					<Space size={8} wrap>
						<Tag color={status.nics_initialized ? 'success' : 'warning'}>
							{status.nics_initialized ? '已初始化' : '未初始化'}
						</Tag>
						{status.nics_initialized ? (
							<Typography.Text type="secondary" className="ibr-console-ops-meta">
								模式：{status.init_mode === 'dhcp' ? 'DHCP' : '静态'}，已绑定 PCI：
								{(status.os_nic_attach_pci ?? []).join(', ') || '-'}
							</Typography.Text>
						) : (
							<Typography.Text type="secondary" className="ibr-console-ops-meta">
								请选择模式与网卡并执行初始化
							</Typography.Text>
						)}
					</Space>
				</div>
			</div>

			<div className="ibr-console-ops-section">
				<div className="ibr-console-ops-section-head">
					<Typography.Text className="ibr-console-ops-section-title">初始化配置</Typography.Text>
				</div>
				<div className="ibr-console-ops-card">
					{!canWrite ? (
						<>
							<Typography.Paragraph type="secondary" className="ibr-console-ops-hint">
								当前账号缺少 IBR 写权限（networks.vr-config:write），仅可查看。
							</Typography.Paragraph>
							<div className="ibr-console-set-ip-rows">
								<div className="ibr-console-set-ip-row">
									<div className="ibr-console-set-ip-row-meta">
										<div className="ibr-console-set-ip-row-title">初始化模式</div>
									</div>
									<Typography.Text>
										{status.init_mode === 'dhcp' ? 'DHCP 模式（2 网口）' : '静态模式（3 网口）'}
									</Typography.Text>
								</div>
								<div className="ibr-console-set-ip-row">
									<div className="ibr-console-set-ip-row-meta">
										<div className="ibr-console-set-ip-row-title">已绑定 PCI</div>
									</div>
									<Typography.Text>
										{(status.os_nic_attach_pci ?? []).join(', ') || '—'}
									</Typography.Text>
								</div>
								{mgmtPci ? (
									<div className="ibr-console-set-ip-row">
										<div className="ibr-console-set-ip-row-meta">
											<div className="ibr-console-set-ip-row-title">管理口 PCI</div>
										</div>
										<Typography.Text>{mgmtPci}</Typography.Text>
									</div>
								) : null}
							</div>
						</>
					) : (
					<Form form={form} layout="vertical" onFinish={(v) => void onSubmit(v)}>
						<Form.Item
							label={
								<Space size={6} align="center">
									<span>初始化模式</span>
									<Tooltip
										placement="right"
										overlayClassName="ibr-console-ops-tooltip"
										title={
											<div className="ibr-console-ops-tooltip-body">
												<div>将重新分配业务网口并重启 VBRAS，可能导致网络中断。</div>
												<div>
													<strong>静态模式（3 网口）</strong>
													<ul>
														<li>执行后会强制 up 管理口、down 业务网口</li>
														<li>重启 VBRAS 接管 WAN/LAN</li>
													</ul>
												</div>
												<div>
													<strong>DHCP 模式（2 网口）</strong>
													<ul>
														<li>down OS 侧物理网卡并重启 VBRAS</li>
														<li>按 PCI 顺序：第一块 WAN、第二块 LAN</li>
													</ul>
												</div>
											</div>
										}
									>
										<QuestionCircleOutlined className="ibr-console-ops-help-icon" />
									</Tooltip>
								</Space>
							}
							name="mode"
							rules={[{ required: true, message: '请选择模式' }]}
							initialValue="static"
						>
							<Radio.Group
								disabled={saving}
								options={[
									{ label: '静态模式（3 网口）', value: 'static' },
									{ label: 'DHCP 模式（2 网口）', value: 'dhcp' },
								]}
							/>
						</Form.Item>

						<Divider className="ibr-console-ops-divider" />

						<Form.Item shouldUpdate noStyle>
							{() => {
								const mode = (form.getFieldValue('mode') as IbrDeviceInitMode) ?? 'static';
								return (
									<>
										{mode === 'static' ? (
											<Typography.Paragraph type="secondary" className="ibr-console-ops-hint">
												管理口默认使用第一块 PCI：{mgmtPci ?? '-'}
											</Typography.Paragraph>
										) : (
											<Typography.Paragraph type="warning" className="ibr-console-ops-hint">
												DHCP 模式会将所有物理网卡交由 VBRAS 接管（按 PCI 顺序 WAN/LAN）。执行会 down
												网卡并重启，可能导致设备短暂不可达。
											</Typography.Paragraph>
										)}

										{mode === 'static' ? (
											<>
												<Form.Item
													label="WAN 口（PCI）"
													name="wan_pci"
													rules={[{ required: true, message: '请选择 WAN 口' }]}
												>
													<Select
														className="ibr-console-ops-select"
														placeholder="选择 PCI"
														disabled={saving}
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

												<Form.Item
													label="LAN 口（PCI）"
													name="lan_pci"
													rules={[{ required: true, message: '请选择 LAN 口' }]}
												>
													<Select
														className="ibr-console-ops-select"
														placeholder="选择 PCI"
														disabled={saving}
														options={businessOptionsStatic.map((o) => {
															const wan = String(form.getFieldValue('wan_pci') ?? '');
															return { ...o, disabled: o.value === wan || o.value === mgmtPci };
														})}
													/>
												</Form.Item>

												<Form.Item label="辅助 LAN 口（可选，最多 4 块）" name="extra_pcis">
													<Select
														className="ibr-console-ops-select"
														mode="multiple"
														placeholder="选择需要接管的额外网卡（可选）"
														disabled={saving}
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
							<Typography.Paragraph type="danger" className="ibr-console-ops-error">
								{error}
							</Typography.Paragraph>
						) : null}

						<Button type="primary" htmlType="submit" loading={saving}>
							执行初始化
						</Button>
					</Form>
					)}
				</div>
			</div>

			{loadError ? (
				<Typography.Paragraph type="warning" className="ibr-console-ops-hint">
					刷新失败：{loadError}
				</Typography.Paragraph>
			) : null}

			<ConsoleOpsModal
				title="生成的配置预览"
				open={previewOpen}
				okText="应用配置并重启 VBRAS"
				cancelText="取消"
				onCancel={() => setPreviewOpen(false)}
				onOk={() => void confirmApplyRestart()}
				okButtonProps={{ loading: saving }}
				destroyOnClose
			>
				<Typography.Paragraph type="secondary" className="ibr-console-ops-hint">
					确认无误后点击「应用配置并重启 VBRAS」。此过程约需 1 分钟，请勿关闭页面。
				</Typography.Paragraph>
				<pre className="ibr-console-ops-pre ibr-console-ops-pre--scroll ibr-console-ops-pre--drawer">
					{previewContent || '(空)'}
				</pre>
			</ConsoleOpsModal>

			<ConsoleOpsModal
				title="重启执行日志"
				open={restartOpen}
				okText="刷新状态"
				cancelText="关闭"
				onCancel={() => setRestartOpen(false)}
				onOk={() => {
					setRestartOpen(false);
					void loadStatus();
				}}
				destroyOnClose
			>
				<pre className="ibr-console-ops-pre ibr-console-ops-pre--scroll ibr-console-ops-pre--drawer">
					{(restartLogs ?? []).join('\n') || '(无日志)'}
				</pre>
			</ConsoleOpsModal>
		</div>
	);
};
