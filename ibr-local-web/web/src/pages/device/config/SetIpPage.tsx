import { RightOutlined } from '@ant-design/icons';
import { Button, Form, Input, List, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ConfigFileDrawer } from '../../../components/ConfigFileDrawer';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';
import { useConfigFileEditor } from '../../../hooks/useConfigFileEditor';
import {
	findNicRoleByPci,
	normalizeIp,
	resolveNicDisplayIp,
	resolveWanLanPci,
	type NicRoleRowLike,
} from './nicRoleResolve';

type NicRoleRow = NicRoleRowLike & {
	name?: string;
	attached?: boolean;
	os?: { name?: string; ip?: string; state?: string };
	vbras?: { name?: string; ip?: string; state?: string; gateway?: string | null };
};

type StatusResp = {
	init_mode?: 'static' | 'dhcp';
	pci_nics?: Array<{ pci?: string; ifnames?: string[]; macs?: string[] }>;
	mgmt_pci?: string | null;
	wan_pci?: string | null;
	lan_pci?: string | null;
	os_nic_attach_pci?: string[] | null;
	net_overview?: {
		wan?: { name: string; ip: string; source: 'os' | 'vpp'; attached: boolean; gateway?: string | null; identity_missing?: boolean };
		lan?: { name: string; ip: string; source: 'os' | 'vpp'; attached: boolean; gateway?: string | null; identity_missing?: boolean };
	};
	net_init_ok?: boolean;
	last_apply?: { public_ip?: string; public_gw?: string | null; private_ip?: string } | null;
	extra_lans?: Array<{ ifname: string; cidr: string }> | null;
	nic_roles?: { roles?: NicRoleRow[] } | null;
};

/** 与 VPP `show interface` / vbras CLI 一致：GigabitEthernet2/2/0（无空格）。 */
function pciToVbrasIfname(pci: string) {
	const m = /^([0-9a-fA-F]{4}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-7])$/.exec(pci.trim());
	if (!m) return '';
	const bus = Number.parseInt(m[2], 16);
	const dev = Number.parseInt(m[3], 16);
	const fn = Number.parseInt(m[4], 10);
	return `GigabitEthernet${bus}/${dev}/${fn}`;
}

export function SetIpPage() {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [result, setResult] = useState<string[]>([]);
	const [status, setStatus] = useState<StatusResp | null>(null);
	const [extraSaving, setExtraSaving] = useState(false);
	const [extraError, setExtraError] = useState<string | null>(null);
	const [extraResult, setExtraResult] = useState<string[]>([]);
	const [extraCidrByIfname, setExtraCidrByIfname] = useState<Record<string, string>>({});

	const nicRolesEditor = useConfigFileEditor({
		load: async () => {
			const { data } = await api.get<{ ok: boolean; content?: string; error?: string }>('/nic_roles_conf');
			if (!data?.ok) throw new Error(data?.error || '读取失败');
			return String(data.content ?? '');
		},
		save: async (content) => {
			const { data } = await api.post<{ ok: boolean; error?: string }>('/nic_roles_conf', { content });
			if (!data?.ok) throw new Error(data?.error || '保存失败');
		},
		onSaved: async () => {
			const { data: nextStatus } = await api.get<StatusResp>('/status');
			setStatus(nextStatus);
		},
	});

	const [form] = Form.useForm<{
		public_ip?: string;
		private_ip?: string;
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
				const initMode = data.init_mode === 'dhcp' ? 'dhcp' : 'static';
				const roles = Array.isArray(data.nic_roles?.roles) ? data.nic_roles?.roles ?? [] : [];
				const { wanPci, lanPci } = resolveWanLanPci({ wanPci: data.wan_pci, lanPci: data.lan_pci });
				const wanRow = findNicRoleByPci(roles, wanPci);
				const lanRow = findNicRoleByPci(roles, lanPci);
				const wanIp = resolveNicDisplayIp(data.net_overview?.wan?.ip, wanRow?.vbras?.ip, data.last_apply?.public_ip);
				const lanIp = resolveNicDisplayIp(data.net_overview?.lan?.ip, lanRow?.vbras?.ip, data.last_apply?.private_ip);
				form.setFieldsValue({
					public_ip: wanIp || undefined,
					private_ip: lanIp || undefined,
				});
				setResult([]);
				setExtraResult([]);
				setExtraError(null);
				if (initMode === 'static') {
					const mgmt = String(data.mgmt_pci ?? '').trim();
					const attach = Array.isArray(data.os_nic_attach_pci)
						? data.os_nic_attach_pci.map((x) => String(x).trim()).filter(Boolean)
						: [];
					const extraRows = roles.filter((r) => {
						const pci = typeof r?.pci === 'string' ? r.pci.trim() : '';
						if (!pci || pci === wanPci || pci === lanPci || pci === mgmt) return false;
						if (attach.length > 0 && !attach.includes(pci)) return false;
						return !!r?.attached;
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

	if (loading) {
		return (
			<PageStack>
				<PageHeader title="设定网卡 IP" description="配置 WAN、LAN 及辅助网口的 IP 地址。" />
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
				<PageHeader title="设定网卡 IP" description="配置 WAN、LAN 及辅助网口的 IP 地址。" />
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

	const initMode = status.init_mode === 'dhcp' ? 'dhcp' : 'static';
	const roles = Array.isArray(status.nic_roles?.roles) ? status.nic_roles?.roles ?? [] : [];
	const { wanPci, lanPci } = resolveWanLanPci({ wanPci: status.wan_pci, lanPci: status.lan_pci });
	const identityReady = Boolean(wanPci || lanPci);
	const wanIf = normalizeIp(status.net_overview?.wan?.name) || pciToVbrasIfname(wanPci) || '-';
	const lanIf = normalizeIp(status.net_overview?.lan?.name) || pciToVbrasIfname(lanPci) || '-';
	const mgmtPci = String(status.mgmt_pci ?? '').trim();
	const attachSet = Array.isArray(status.os_nic_attach_pci)
		? status.os_nic_attach_pci.map((x) => String(x).trim()).filter(Boolean)
		: [];

	const extraCandidates = roles
		.filter((r) => {
			const pci = typeof r?.pci === 'string' ? r.pci.trim() : '';
			if (!pci || pci === wanPci || pci === lanPci || pci === mgmtPci) return false;
			if (attachSet.length > 0 && !attachSet.includes(pci)) return false;
			return !!r?.attached;
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
	const extraHasEditable = identityReady && extraCandidates.some((x) => x.attached && !!x.ifname);

	const applyExtraLans = async () => {
		setExtraSaving(true);
		setExtraError(null);
		setExtraResult([]);
		try {
			const items = roles
				.filter((r) => {
					const pci = typeof r?.pci === 'string' ? r.pci.trim() : '';
					if (!pci || pci === wanPci || pci === lanPci || pci === mgmtPci) return false;
					if (attachSet.length > 0 && !attachSet.includes(pci)) return false;
					return !!r?.attached;
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
			const { data } = await api.post<{ ok: boolean; logs?: string[]; error?: string }>('/extra_lans/apply', { items });
			if (!data?.ok) throw new Error(data?.error || '配置失败');
			setExtraResult(Array.isArray(data.logs) ? data.logs.map((x) => String(x)) : []);
			const { data: nextStatus } = await api.get<StatusResp>('/status');
			setStatus(nextStatus);
		} catch (e) {
			setExtraError(e instanceof Error ? e.message : '配置失败');
		} finally {
			setExtraSaving(false);
		}
	};

	const wanCidrRule = {
		pattern: /^\s*\d+\.\d+\.\d+\.\d+\/\d{1,2}\s*$/,
		message: '示例：10.0.0.2/24',
	} as const;
	const lanCidrRule = {
		pattern: /^\s*\d+\.\d+\.\d+\.\d+\/\d{1,2}\s*$/,
		message: '示例：192.168.1.1/24',
	} as const;

	return (
		<>
			<PageStack>
				<PageHeader title="设定网卡 IP" description="配置 WAN、LAN 及辅助网口的 IP 地址。" />

				<Form
					form={form}
					component={false}
					onFinish={async (values) => {
						setSaving(true);
						setError(null);
						setResult([]);
						try {
							const { data } = await api.post<{ ok: boolean; logs?: string[]; error?: string }>('/apply', {
								scope: 'all',
								public_ip: values.public_ip,
								private_ip: values.private_ip,
							});
							if (!data?.ok) throw new Error(data?.error || '配置失败');
							setResult(Array.isArray(data.logs) ? data.logs.map((x) => String(x)) : []);
							const { data: nextStatus } = await api.get<StatusResp>('/status');
							setStatus(nextStatus);
						} catch (e) {
							setError(e instanceof Error ? e.message : '配置失败');
						} finally {
							setSaving(false);
						}
					}}
				>
					<ContentBlock>
						<BlockHeader
							title="主网卡"
							action={
								<Button type="primary" loading={saving} disabled={!identityReady} onClick={() => form.submit()}>
									保存并应用
								</Button>
							}
						/>
						<Card variant="list">
							{!identityReady ? (
								<Typography.Paragraph type="warning" style={{ margin: 0, padding: '12px 20px 0' }}>
									尚未写入 WAN/LAN 身份，请先完成「初始化网卡」后再设定 IP（禁止按下标猜口）。
								</Typography.Paragraph>
							) : status.net_init_ok ? null : (
								<Typography.Paragraph type="warning" style={{ margin: 0, padding: '12px 20px 0' }}>
									请先完成网卡初始化并确保 VBRAS 正常启动。
								</Typography.Paragraph>
							)}
							<List
								split
								className="app-settings-list"
								dataSource={[
									{
										key: 'wan',
										title: 'WAN 口',
										description: `接口 ${wanIf}`,
										name: 'public_ip' as const,
										placeholder: '例如 10.0.0.2/24',
										rule: wanCidrRule,
									},
									{
										key: 'lan',
										title: 'LAN 口',
										description: `接口 ${lanIf}`,
										name: 'private_ip' as const,
										placeholder: '例如 192.168.1.1/24',
										rule: lanCidrRule,
									},
								]}
								renderItem={(item) => (
									<List.Item
										key={item.key}
										extra={
											<Form.Item name={item.name} noStyle rules={[item.rule]}>
												<Input
													className="app-settings-list-input"
													placeholder={item.placeholder}
													disabled={saving || (item.key === 'wan' ? !wanPci : !lanPci)}
												/>
											</Form.Item>
										}
									>
										<List.Item.Meta title={item.title} description={item.description} />
									</List.Item>
								)}
							/>
							{error || result.length > 0 ? (
								<div style={{ padding: '12px 20px 16px', borderTop: error || result.length > 0 ? '1px solid var(--app-border)' : undefined }}>
									{error ? (
										<Typography.Paragraph type="danger" style={{ marginTop: 0, marginBottom: result.length > 0 ? 12 : 0 }}>
											{error}
										</Typography.Paragraph>
									) : null}
									{result.length > 0 ? (
										<pre className="app-code-block app-code-block-inset app-code-block-min">{result.join('\n')}</pre>
									) : null}
								</div>
							) : null}
						</Card>
					</ContentBlock>
				</Form>

				<ContentBlock>
					<BlockHeader
						title="辅助网卡"
						action={
							initMode !== 'dhcp' ? (
								<Button type="primary" loading={extraSaving} disabled={!extraHasEditable} onClick={() => void applyExtraLans()}>
									保存并应用
								</Button>
							) : null
						}
					/>
					<Card variant="list">
						{initMode === 'dhcp' ? (
							<Typography.Paragraph type="secondary" style={{ margin: 0, padding: '14px 20px' }}>
								静态模式（三网卡）下才可配置辅助网口。
							</Typography.Paragraph>
						) : extraCandidates.length === 0 ? (
							<Typography.Paragraph type="secondary" style={{ margin: 0, padding: '14px 20px' }}>
								请先在「辅助网卡管理」中扩容接管辅助口后，此处将显示可配置的辅助 LAN 口。
							</Typography.Paragraph>
						) : (
							<>
								<List
									split
									className="app-settings-list"
									dataSource={extraCandidates}
									renderItem={(c) => {
										const label = `NIC#${c.idx}`;
										const statusText = c.ifname ? (c.attached ? '已挂载' : '未挂载') : '未识别接口名';
										const descParts = [`接口 ${c.ifname || '-'}`];
										if (c.currentIp !== '-') descParts.push(`当前 ${c.currentIp}`);
										descParts.push(statusText);
										return (
											<List.Item
												key={`${label}-${c.pci}`}
												extra={
													<Input
														className="app-settings-list-input"
														disabled={!c.attached || !c.ifname || extraSaving}
														placeholder="例如 192.168.10.1/24"
														value={c.ifname ? extraCidrByIfname[c.ifname] ?? '' : ''}
														onChange={(e) => {
															if (!c.ifname) return;
															const v = e.target.value;
															setExtraCidrByIfname((prev) => ({ ...prev, [c.ifname]: v }));
														}}
													/>
												}
											>
												<List.Item.Meta title={label} description={descParts.join(' · ')} />
											</List.Item>
										);
									}}
								/>
								{(extraError || extraResult.length > 0) && (
									<div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--app-border)' }}>
										{extraError ? (
											<Typography.Paragraph type="danger" style={{ marginTop: 0, marginBottom: extraResult.length > 0 ? 12 : 0 }}>
												{extraError}
											</Typography.Paragraph>
										) : null}
										{extraResult.length > 0 ? (
											<pre className="app-code-block app-code-block-inset app-code-block-min">{extraResult.join('\n')}</pre>
										) : null}
									</div>
								)}
							</>
						)}
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
									key: 'nic_roles',
									title: 'nic_roles.conf',
									onClick: nicRolesEditor.openDrawer,
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
				open={nicRolesEditor.open}
				onClose={nicRolesEditor.closeDrawer}
				fileName="nic_roles.conf"
				filePath="/usr/local/src/vrconf/nic_roles.conf"
				hint="一般不需要修改；如无特殊需求请勿改动。"
				loading={nicRolesEditor.loading}
				editing={nicRolesEditor.editing}
				error={nicRolesEditor.error}
				content={nicRolesEditor.content}
				draft={nicRolesEditor.draft}
				onRefresh={() => void nicRolesEditor.reload()}
				onEdit={nicRolesEditor.startEdit}
				onSave={() => void nicRolesEditor.save()}
				onCancelEdit={nicRolesEditor.cancelEdit}
				onDraftChange={nicRolesEditor.setDraft}
			/>
		</>
	);
}
