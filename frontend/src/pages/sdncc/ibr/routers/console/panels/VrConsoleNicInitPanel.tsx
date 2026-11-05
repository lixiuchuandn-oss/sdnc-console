import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Divider, Form, Radio, Select, Space, Spin, Tag, Tooltip, Typography, message } from 'antd';
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
	const [previewNote, setPreviewNote] = useState('');
	const [previewNeedsRestart, setPreviewNeedsRestart] = useState(true);
	const [pendingPayload, setPendingPayload] = useState<IbrDeviceNicInitPayload | null>(null);

	const [form] = Form.useForm<FormValues>();
	const mode = (Form.useWatch('mode', form) as IbrDeviceInitMode | undefined) ?? 'static';
	const watchedWan = String(Form.useWatch('wan_pci', form) ?? '');

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

	const businessOptions = useMemo(
		() =>
			pcis
				.filter((pci) => pci !== mgmtPci)
				.map((pci) => ({ label: pci, value: pci })),
		[pcis, mgmtPci],
	);

	const lanOptions = useMemo(
		() => businessOptions.map((o) => ({ ...o, disabled: o.value === watchedWan })),
		[businessOptions, watchedWan],
	);

	const onSubmit = async (values: FormValues) => {
		if (!canWrite) return;
		const nextMode = values.mode ?? 'static';
		const wan = values.wan_pci?.trim() || '';
		const lan = values.lan_pci?.trim() || '';
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
		const attachPci = Array.from(new Set([wan, lan].filter(Boolean)));
		const payload: IbrDeviceNicInitPayload = {
			mode: nextMode,
			nics: [
				{ pci: wan, role: 'wan' },
				...(lan ? [{ pci: lan, role: 'lan' as const }] : []),
			],
			attach_pci: attachPci.length > 0 ? attachPci : undefined,
		};

		setSaving(true);
		setError(null);
		try {
			await setIbrDeviceNicMode(vrUuid, { mode: payload.mode });
			setPendingPayload(payload);
			const preview = await previewIbrDeviceNicInit(vrUuid, payload);
			if (!preview?.ok) throw new Error(preview?.error || '生成配置失败');
			setPreviewContent(String(preview.config_content ?? ''));
			setPreviewNote(String(preview.preview_note ?? preview.message ?? ''));
			setPreviewNeedsRestart(Boolean(preview.requires_vbras_restart));
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
			if (!data?.ok) throw new Error(data?.error || '应用失败');
			setPreviewOpen(false);
			setPendingPayload(null);
			message.success(data.vbras_restarted ? '初始化完成（已重启 VBRAS）' : '初始化完成');
			await loadStatus();
		} catch (e) {
			setError(getApiErrorMessage(e, '应用失败'));
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
								请选择模式与 WAN/LAN 后执行初始化
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
										title="管理口留 OS；未选中的原业务口将释放口级配置。初始化后不自动灌回 IP。"
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

						<Typography.Paragraph type="secondary" className="ibr-console-ops-hint">
							{mode === 'static'
								? `请选定 WAN 与 LAN；管理口（${mgmtPci ?? '-'}）留 OS。每次需重新选择，避免误用旧口。`
								: `请选定 WAN（必选）；LAN 可选。管理口（${mgmtPci ?? '-'}）留 OS。`}
						</Typography.Paragraph>

						<Form.Item label="WAN 口（PCI）" name="wan_pci" rules={[{ required: true, message: '请选择 WAN 口' }]}>
							<Select
								className="ibr-console-ops-select"
								placeholder="选择 PCI"
								disabled={saving}
								options={businessOptions}
								showSearch
								optionFilterProp="label"
								onChange={(nextWan) => {
									const nextLan = String(form.getFieldValue('lan_pci') ?? '');
									if (nextWan && nextLan && nextWan === nextLan) {
										form.setFieldsValue({ lan_pci: undefined });
									}
								}}
							/>
						</Form.Item>

						<Form.Item
							label={mode === 'dhcp' ? 'LAN 口（PCI，可选）' : 'LAN 口（PCI）'}
							name="lan_pci"
							rules={mode === 'static' ? [{ required: true, message: '请选择 LAN 口' }] : []}
						>
							<Select
								className="ibr-console-ops-select"
								allowClear={mode === 'dhcp'}
								placeholder={mode === 'dhcp' ? '可不选' : '选择 PCI'}
								disabled={saving}
								options={lanOptions}
								showSearch
								optionFilterProp="label"
							/>
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
				title="接口配置预览"
				open={previewOpen}
				okText={previewNeedsRestart ? '应用并重启 VBRAS' : '应用'}
				cancelText="取消"
				onCancel={() => setPreviewOpen(false)}
				onOk={() => void confirmApplyRestart()}
				okButtonProps={{ loading: saving, danger: previewNeedsRestart }}
				destroyOnClose
			>
				<Typography.Paragraph type="secondary" className="ibr-console-ops-hint">
					{previewNote || '确认后应用；仅清相关口配置。'}
				</Typography.Paragraph>
				<pre className="ibr-console-ops-pre ibr-console-ops-pre--scroll ibr-console-ops-pre--drawer">
					{previewContent || '(空)'}
				</pre>
			</ConsoleOpsModal>
		</div>
	);
};
