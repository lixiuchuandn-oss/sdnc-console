import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { Button, Form, Input, Spin, Typography } from 'antd';
import { getApiErrorMessage } from '../../../../../../services/api';
import {
	applyIbrDeviceExtraLans,
	applyIbrDeviceNicIp,
	fetchIbrDeviceStatus,
	type IbrDeviceStatusResp,
} from '../../../../../../services/ibrDeviceOpsApi';
import { useIbrConsoleWritePermission } from '../lib/useIbrConsoleWritePermission';
import {
	findNicRoleByPci,
	normalizeIp,
	pciToVbrasIfname,
	resolveNicDisplayIp,
	resolveWanLanPci,
	type NicRoleRowLike,
} from '../lib/nicRoleResolve';
import { VrConsoleNoDevicePanel } from './VrConsoleNoDevicePanel';

type Props = {
	vrUuid: string;
	managementIp: string;
};

const WAN_CIDR_RULE = {
	pattern: /^\s*\d+\.\d+\.\d+\.\d+\/\d{1,2}\s*$/,
	message: '示例：10.0.0.2/24',
} as const;

const LAN_CIDR_RULE = {
	pattern: /^\s*\d+\.\d+\.\d+\.\d+\/\d{1,2}\s*$/,
	message: '示例：192.168.1.1/24',
} as const;

function hydrateFormFromStatus(
	status: IbrDeviceStatusResp,
	form: ReturnType<typeof Form.useForm<{ public_ip?: string; private_ip?: string }>>[0],
	setExtraCidrByIfname: React.Dispatch<React.SetStateAction<Record<string, string>>>,
) {
	const initMode = status.init_mode === 'dhcp' ? 'dhcp' : 'static';
	const roles = Array.isArray(status.nic_roles?.roles) ? status.nic_roles?.roles ?? [] : [];
	const { wanPci, lanPci } = resolveWanLanPci(initMode, status.pci_nics);
	const wanRow = findNicRoleByPci(roles, wanPci);
	const lanRow = findNicRoleByPci(roles, lanPci);
	const wanIp = resolveNicDisplayIp(
		status.net_overview?.wan?.ip,
		wanRow?.vbras?.ip,
		status.last_apply?.public_ip,
	);
	const lanIp = resolveNicDisplayIp(
		status.net_overview?.lan?.ip,
		lanRow?.vbras?.ip,
		status.last_apply?.private_ip,
	);
	form.setFieldsValue({
		public_ip: wanIp || undefined,
		private_ip: lanIp || undefined,
	});
	if (initMode === 'static') {
		const extraRows = roles.filter((r) => {
			const pci = typeof r?.pci === 'string' ? r.pci.trim() : '';
			return pci && pci !== wanPci && pci !== lanPci;
		}).slice(0, 5);
		const next: Record<string, string> = {};
		for (const r of extraRows) {
			const pci = typeof r?.pci === 'string' ? r.pci.trim() : '';
			if (!pci) continue;
			const ifname = pciToVbrasIfname(pci);
			if (!ifname) continue;
			const cidr = normalizeIp(r?.vbras?.ip);
			if (cidr) next[ifname] = cidr;
		}
		setExtraCidrByIfname(next);
	} else {
		setExtraCidrByIfname({});
	}
}

export const VrConsoleSetIpPanel: React.FC<Props> = ({ vrUuid, managementIp }) => {
	const canWrite = useIbrConsoleWritePermission('networks.vr-config:write');

	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [status, setStatus] = useState<IbrDeviceStatusResp | null>(null);

	const [saving, setSaving] = useState(false);
	const [applyError, setApplyError] = useState<string | null>(null);
	const [applyLogs, setApplyLogs] = useState<string[]>([]);

	const [extraSaving, setExtraSaving] = useState(false);
	const [extraError, setExtraError] = useState<string | null>(null);
	const [extraLogs, setExtraLogs] = useState<string[]>([]);
	const [extraCidrByIfname, setExtraCidrByIfname] = useState<Record<string, string>>({});

	const [form] = Form.useForm<{ public_ip?: string; private_ip?: string }>();

	const loadStatus = useCallback(async () => {
		setRefreshing(true);
		setLoadError(null);
		try {
			const data = await fetchIbrDeviceStatus(vrUuid, { skipCache: true });
			setStatus(data);
			hydrateFormFromStatus(data, form, setExtraCidrByIfname);
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
	}, [vrUuid, loadStatus]);

	const initMode = status?.init_mode === 'dhcp' ? 'dhcp' : 'static';
	const roles = useMemo(
		() => (Array.isArray(status?.nic_roles?.roles) ? status!.nic_roles!.roles! : []) as NicRoleRowLike[],
		[status],
	);
	const { wanPci, lanPci } = useMemo(
		() => resolveWanLanPci(initMode, status?.pci_nics),
		[initMode, status?.pci_nics],
	);

	const wanIf =
		normalizeIp(status?.net_overview?.wan?.name) || pciToVbrasIfname(wanPci) || '-';
	const lanIf =
		normalizeIp(status?.net_overview?.lan?.name) || pciToVbrasIfname(lanPci) || '-';

	const extraCandidates = useMemo(() => {
		return roles
			.filter((r) => {
				const pci = typeof r?.pci === 'string' ? r.pci.trim() : '';
				return pci && pci !== wanPci && pci !== lanPci;
			})
			.slice(0, 5)
			.map((r, i) => {
				const pci = typeof r?.pci === 'string' ? r.pci.trim() : '';
				const ifname = pci ? pciToVbrasIfname(pci) : '';
				const attached = !!r?.attached;
				const currentIp = normalizeIp(r?.vbras?.ip) || '-';
				return { idx: i + 4, pci, ifname, attached, currentIp };
			})
			.filter((x) => !!x.pci);
	}, [roles, wanPci, lanPci]);

	const extraHasEditable = extraCandidates.some((x) => x.attached && !!x.ifname);
	const netInitOk = status?.net_init_ok !== false;
	const writeDisabled = !canWrite || !netInitOk;

	const applyMain = async (values: { public_ip?: string; private_ip?: string }) => {
		setSaving(true);
		setApplyError(null);
		setApplyLogs([]);
		try {
			const data = await applyIbrDeviceNicIp(vrUuid, {
				scope: 'all',
				public_ip: values.public_ip,
				private_ip: values.private_ip,
			});
			if (!data?.ok) throw new Error(data?.error || '配置失败');
			setApplyLogs(Array.isArray(data.logs) ? data.logs.map(String) : []);
			const nextStatus = await fetchIbrDeviceStatus(vrUuid, { skipCache: true });
			setStatus(nextStatus);
			hydrateFormFromStatus(nextStatus, form, setExtraCidrByIfname);
		} catch (e) {
			setApplyError(getApiErrorMessage(e, '配置失败'));
		} finally {
			setSaving(false);
		}
	};

	const applyExtraLans = async () => {
		setExtraSaving(true);
		setExtraError(null);
		setExtraLogs([]);
		try {
			const items = roles
				.filter((r) => {
					const pci = typeof r?.pci === 'string' ? r.pci.trim() : '';
					return pci && pci !== wanPci && pci !== lanPci;
				})
				.slice(0, 5)
				.map((r) => {
					const pci = typeof r?.pci === 'string' ? r.pci.trim() : '';
					const ifname = pci ? pciToVbrasIfname(pci) : '';
					const attached = !!r?.attached;
					const cidr = ifname ? String(extraCidrByIfname[ifname] ?? '').trim() : '';
					if (!attached || !ifname || !cidr) return null;
					return { ifname, cidr };
				})
				.filter((x): x is { ifname: string; cidr: string } => !!x);
			const data = await applyIbrDeviceExtraLans(vrUuid, { items });
			if (!data?.ok) throw new Error(data?.error || '配置失败');
			setExtraLogs(Array.isArray(data.logs) ? data.logs.map(String) : []);
			const nextStatus = await fetchIbrDeviceStatus(vrUuid, { skipCache: true });
			setStatus(nextStatus);
			hydrateFormFromStatus(nextStatus, form, setExtraCidrByIfname);
		} catch (e) {
			setExtraError(getApiErrorMessage(e, '配置失败'));
		} finally {
			setExtraSaving(false);
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
			<Form form={form} component={false} onFinish={(v) => void applyMain(v)}>
				<div className="ibr-console-ops-section">
					<div className="ibr-console-ops-section-head">
						<Typography.Text className="ibr-console-ops-section-title">主网卡</Typography.Text>
						<div className="ibr-console-ops-actions">
							<Button
								type="text"
								className="ibr-console-ops-text-btn"
								icon={<ReloadOutlined spin={refreshing} />}
								onClick={() => void loadStatus()}
								disabled={refreshing || saving}
							>
								刷新
							</Button>
							{canWrite ? (
								<Button
									type="primary"
									loading={saving}
									disabled={writeDisabled || refreshing}
									onClick={() => form.submit()}
								>
									保存并应用
								</Button>
							) : null}
						</div>
					</div>
					<div className="ibr-console-ops-card">
						{!netInitOk ? (
							<Typography.Paragraph type="warning" className="ibr-console-ops-hint">
								请先完成网卡初始化并确保 VBRAS 正常启动。
							</Typography.Paragraph>
						) : null}
						{!canWrite ? (
							<Typography.Paragraph type="secondary" className="ibr-console-ops-hint">
								当前账号缺少 IBR 写权限（networks.vr-config:write），仅可查看。
							</Typography.Paragraph>
						) : null}
						<div className="ibr-console-set-ip-rows">
							<div className="ibr-console-set-ip-row">
								<div className="ibr-console-set-ip-row-meta">
									<div className="ibr-console-set-ip-row-title">WAN 口</div>
									<div className="ibr-console-set-ip-row-desc">接口 {wanIf}</div>
								</div>
								<Form.Item name="public_ip" rules={[WAN_CIDR_RULE]} className="ibr-console-set-ip-field">
									<Input
										className="ibr-console-ops-input"
										placeholder="例如 10.0.0.2/24"
										disabled={writeDisabled || saving}
									/>
								</Form.Item>
							</div>
							<div className="ibr-console-set-ip-row">
								<div className="ibr-console-set-ip-row-meta">
									<div className="ibr-console-set-ip-row-title">LAN 口</div>
									<div className="ibr-console-set-ip-row-desc">接口 {lanIf}</div>
								</div>
								<Form.Item name="private_ip" rules={[LAN_CIDR_RULE]} className="ibr-console-set-ip-field">
									<Input
										className="ibr-console-ops-input"
										placeholder="例如 192.168.1.1/24"
										disabled={writeDisabled || saving}
									/>
								</Form.Item>
							</div>
						</div>
						{applyError || applyLogs.length > 0 ? (
							<div className="ibr-console-set-ip-result">
								{applyError ? (
									<Typography.Paragraph type="danger" className="ibr-console-ops-error">
										{applyError}
									</Typography.Paragraph>
								) : null}
								{applyLogs.length > 0 ? (
									<pre className="ibr-console-ops-pre ibr-console-ops-pre--inline">{applyLogs.join('\n')}</pre>
								) : null}
							</div>
						) : null}
					</div>
				</div>
			</Form>

			<div className="ibr-console-ops-section">
				<div className="ibr-console-ops-section-head">
					<Typography.Text className="ibr-console-ops-section-title">辅助网卡</Typography.Text>
					{canWrite && initMode !== 'dhcp' ? (
						<Button
							type="primary"
							loading={extraSaving}
							disabled={!extraHasEditable || writeDisabled || refreshing}
							onClick={() => void applyExtraLans()}
						>
							保存并应用
						</Button>
					) : null}
				</div>
				<div className="ibr-console-ops-card">
					{initMode === 'dhcp' ? (
						<Typography.Paragraph type="secondary" className="ibr-console-ops-hint">
							静态模式（三网卡）下才可配置辅助网口。
						</Typography.Paragraph>
					) : extraCandidates.length === 0 ? (
						<Typography.Paragraph type="secondary" className="ibr-console-ops-hint">
							请在设备侧完成网卡初始化并接管网卡 4–8 后，此处将显示可配置的辅助 LAN 口。
						</Typography.Paragraph>
					) : (
						<>
							<div className="ibr-console-set-ip-rows">
								{extraCandidates.map((c) => {
									const label = `NIC#${c.idx}`;
									const statusText = c.ifname ? (c.attached ? '已挂载' : '未挂载') : '未识别接口名';
									const descParts = [`接口 ${c.ifname || '-'}`];
									if (c.currentIp !== '-') descParts.push(`当前 ${c.currentIp}`);
									descParts.push(statusText);
									return (
										<div key={`${label}-${c.pci}`} className="ibr-console-set-ip-row">
											<div className="ibr-console-set-ip-row-meta">
												<div className="ibr-console-set-ip-row-title">{label}</div>
												<div className="ibr-console-set-ip-row-desc">{descParts.join(' · ')}</div>
											</div>
											<Input
												className="ibr-console-ops-input ibr-console-set-ip-field-input"
												disabled={!canWrite || !c.attached || !c.ifname || extraSaving || writeDisabled}
												placeholder="例如 192.168.10.1/24"
												value={c.ifname ? extraCidrByIfname[c.ifname] ?? '' : ''}
												onChange={(e) => {
													if (!c.ifname) return;
													const v = e.target.value;
													setExtraCidrByIfname((prev) => ({ ...prev, [c.ifname]: v }));
												}}
											/>
										</div>
									);
								})}
							</div>
							{extraError || extraLogs.length > 0 ? (
								<div className="ibr-console-set-ip-result">
									{extraError ? (
										<Typography.Paragraph type="danger" className="ibr-console-ops-error">
											{extraError}
										</Typography.Paragraph>
									) : null}
									{extraLogs.length > 0 ? (
										<pre className="ibr-console-ops-pre ibr-console-ops-pre--inline">{extraLogs.join('\n')}</pre>
									) : null}
								</div>
							) : null}
						</>
					)}
				</div>
			</div>

			{loadError ? (
				<Typography.Paragraph type="warning" className="ibr-console-ops-hint">
					刷新失败：{loadError}
				</Typography.Paragraph>
			) : null}
		</div>
	);
};
