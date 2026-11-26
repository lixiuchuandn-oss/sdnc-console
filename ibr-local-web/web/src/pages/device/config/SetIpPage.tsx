import { RightOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Form, Input, List, Space, Spin, Typography } from 'antd';
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
	pciToVbrasIfname,
	resolveNicDisplayIpByFamily,
	resolveWanLanPci,
	splitIpFamilies,
	type NicRoleRowLike,
} from './nicRoleResolve';

const SET_IP_PAGE_DESC =
	'配置 WAN、LAN 及辅助网口地址。新机首次可用本页修正；已由 SDNC 下发业务配置后，口地址以 SDNC 为准，本地再改可能与控制器不一致，需拉平时请到仪表板「从控制器同步配置」。';

type NicRoleRow = NicRoleRowLike & {
	name?: string;
	attached?: boolean;
	os?: { name?: string; ip?: string; state?: string };
	vbras?: { name?: string; ip?: string; ipv6?: string; state?: string; gateway?: string | null };
};

type StatusResp = {
	init_mode?: 'static' | 'dhcp';
	pci_nics?: Array<{ pci?: string; ifnames?: string[]; macs?: string[]; driver?: string; vpp_ifname?: string }>;
	mgmt_pci?: string | null;
	wan_pci?: string | null;
	lan_pci?: string | null;
	os_nic_attach_pci?: string[] | null;
	net_overview?: {
		wan?: { name: string; ip: string; source: 'os' | 'vpp'; attached: boolean; gateway?: string | null; identity_missing?: boolean };
		lan?: { name: string; ip: string; source: 'os' | 'vpp'; attached: boolean; gateway?: string | null; identity_missing?: boolean };
	};
	net_init_ok?: boolean;
	last_apply?: {
		public_ip?: string;
		public_ipv6?: string;
		public_gw?: string | null;
		private_ip?: string;
		private_ipv6?: string;
	} | null;
	extra_lans?: Array<{ ifname: string; cidr?: string; ipv6?: string }> | null;
	nic_roles?: { roles?: NicRoleRow[] } | null;
};

export function SetIpPage() {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const { message } = AntApp.useApp();
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState<StatusResp | null>(null);
	const [extraSaving, setExtraSaving] = useState(false);
	const [extraError, setExtraError] = useState<string | null>(null);
	const [extraCidrByIfname, setExtraCidrByIfname] = useState<Record<string, string>>({});
	const [extraIpv6ByIfname, setExtraIpv6ByIfname] = useState<Record<string, string>>({});

	const [form] = Form.useForm<{
		public_ip?: string;
		public_ipv6?: string;
		private_ip?: string;
		private_ipv6?: string;
	}>();

	const hydrateFromStatus = (data: StatusResp) => {
		setStatus(data);
		const initMode = data.init_mode === 'dhcp' ? 'dhcp' : 'static';
		const roles = Array.isArray(data.nic_roles?.roles) ? data.nic_roles?.roles ?? [] : [];
		const { wanPci, lanPci } = resolveWanLanPci({ wanPci: data.wan_pci, lanPci: data.lan_pci });
		const wanRow = findNicRoleByPci(roles, wanPci);
		const lanRow = findNicRoleByPci(roles, lanPci);
		form.setFieldsValue({
			public_ip:
				resolveNicDisplayIpByFamily('v4', data.net_overview?.wan?.ip, wanRow?.vbras?.ip, data.last_apply?.public_ip) ||
				undefined,
			public_ipv6:
				resolveNicDisplayIpByFamily(
					'v6',
					data.net_overview?.wan?.ip,
					wanRow?.vbras?.ipv6,
					wanRow?.vbras?.ip,
					data.last_apply?.public_ipv6,
				) || undefined,
			private_ip:
				resolveNicDisplayIpByFamily('v4', data.net_overview?.lan?.ip, lanRow?.vbras?.ip, data.last_apply?.private_ip) ||
				undefined,
			private_ipv6:
				resolveNicDisplayIpByFamily(
					'v6',
					data.net_overview?.lan?.ip,
					lanRow?.vbras?.ipv6,
					lanRow?.vbras?.ip,
					data.last_apply?.private_ipv6,
				) || undefined,
		});
		setExtraError(null);
		if (initMode === 'static') {
			const mgmt = String(data.mgmt_pci ?? '').trim();
			const attach = Array.isArray(data.os_nic_attach_pci)
				? data.os_nic_attach_pci.map((x) => String(x).trim()).filter(Boolean)
				: [];
			const extraRows = roles
				.filter((r) => {
					const pci = typeof r?.pci === 'string' ? r.pci.trim() : '';
					if (!pci || pci === wanPci || pci === lanPci || pci === mgmt) return false;
					if (attach.length > 0 && !attach.includes(pci)) return false;
					return !!r?.attached;
				})
				.slice(0, 5);
			const nextV4: Record<string, string> = {};
			const nextV6: Record<string, string> = {};
			for (const r of extraRows) {
				const pci = typeof r?.pci === 'string' ? r.pci.trim() : '';
				if (!pci) continue;
				const ifname = pciToVbrasIfname(pci);
				if (!ifname) continue;
				const fromIp = splitIpFamilies(r?.vbras?.ip);
				const v4 = fromIp.v4 || normalizeIp(r?.vbras?.ip);
				const v6 = normalizeIp(r?.vbras?.ipv6) || fromIp.v6;
				if (v4 && !v4.includes(':')) nextV4[ifname] = v4.split(',')[0]!.trim();
				if (v6) nextV6[ifname] = v6.split(',')[0]!.trim();
			}
			setExtraCidrByIfname(nextV4);
			setExtraIpv6ByIfname(nextV6);
		} else {
			setExtraCidrByIfname({});
			setExtraIpv6ByIfname({});
		}
	};

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
			hydrateFromStatus(nextStatus);
		},
	});

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			setError(null);
			try {
				const { data } = await api.get<StatusResp>('/status');
				if (cancelled) return;
				hydrateFromStatus(data);
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
				<PageHeader title="设置网口IP" description={SET_IP_PAGE_DESC} />
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
				<PageHeader title="设置网口IP" description={SET_IP_PAGE_DESC} />
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
			const fromIp = splitIpFamilies(r?.vbras?.ip);
			const currentIp = fromIp.v4 || '-';
			const currentIpv6 = normalizeIp(r?.vbras?.ipv6) || fromIp.v6 || '-';
			return { idx: i + 4, pci, ifname, attached, currentIp, currentIpv6 };
		})
		.filter((x) => !!x.pci);
	const extraHasEditable = identityReady && extraCandidates.some((x) => x.attached && !!x.ifname);

	const applyExtraLans = async () => {
		setExtraSaving(true);
		setExtraError(null);
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
					const ipv6 = ifname ? String(extraIpv6ByIfname[ifname] ?? '').trim() : '';
					// 空地址也要提交，后端据此清除旧配置；勿因空串丢弃整口
					if (!attached || !ifname) return null;
					return { ifname, cidr, ipv6 };
				})
				.filter((x): x is { ifname: string; cidr: string; ipv6: string } => !!x);
			const { data } = await api.post<{ ok: boolean; logs?: string[]; error?: string }>('/extra_lans/apply', { items });
			if (!data?.ok) throw new Error(data?.error || '配置失败');
			message.success('辅助网卡 IP 已应用');
			const { data: nextStatus } = await api.get<StatusResp>('/status');
			hydrateFromStatus(nextStatus);
		} catch (e) {
			setExtraError(e instanceof Error ? e.message : '配置失败');
		} finally {
			setExtraSaving(false);
		}
	};

	const optionalV4Rule = {
		validator: async (_: unknown, value: string) => {
			const t = String(value ?? '').trim();
			if (!t) return;
			if (!/^\d+\.\d+\.\d+\.\d+\/\d{1,2}$/.test(t)) throw new Error('示例：10.0.0.2/24');
		},
	};
	const optionalV6Rule = {
		validator: async (_: unknown, value: string) => {
			const t = String(value ?? '').trim();
			if (!t) return;
			if (!/^[0-9a-fA-F:]+\/\d{1,3}$/.test(t) || t.includes('.')) throw new Error('示例：2100::100/64');
		},
	};

	return (
		<>
			<PageStack>
				<PageHeader title="设置网口IP" description={SET_IP_PAGE_DESC} />

				<Form
					form={form}
					component={false}
					onFinish={async (values) => {
						setSaving(true);
						setError(null);
						try {
							const { data } = await api.post<{ ok: boolean; logs?: string[]; error?: string }>('/apply', {
								scope: 'all',
								public_ip: values.public_ip,
								public_ipv6: values.public_ipv6,
								private_ip: values.private_ip,
								private_ipv6: values.private_ipv6,
							});
							if (!data?.ok) throw new Error(data?.error || '配置失败');
							message.success('已保存并应用网卡 IP');
							const { data: nextStatus } = await api.get<StatusResp>('/status');
							hydrateFromStatus(nextStatus);
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
									尚未写入 WAN/LAN 身份，请先完成「初始化网卡」后再设置 IP（禁止按下标猜口）。
								</Typography.Paragraph>
							) : status.net_init_ok ? null : (
								<Typography.Paragraph type="warning" style={{ margin: 0, padding: '12px 20px 0' }}>
									请先完成网卡初始化并确保数据面正常启动。
								</Typography.Paragraph>
							)}
							<List
								split
								className="app-settings-list"
								dataSource={[
									{
										key: 'wan4',
										title: 'WAN IPv4',
										description: `接口 ${wanIf}`,
										name: 'public_ip' as const,
										placeholder: '例如 10.0.0.2/24',
										rule: optionalV4Rule,
										disabled: !wanPci,
									},
									{
										key: 'wan6',
										title: 'WAN IPv6',
										description: `接口 ${wanIf}`,
										name: 'public_ipv6' as const,
										placeholder: '例如 2100::100/64',
										rule: optionalV6Rule,
										disabled: !wanPci,
									},
									{
										key: 'lan4',
										title: 'LAN IPv4',
										description: `接口 ${lanIf}`,
										name: 'private_ip' as const,
										placeholder: '例如 192.168.1.1/24',
										rule: optionalV4Rule,
										disabled: !lanPci,
									},
									{
										key: 'lan6',
										title: 'LAN IPv6',
										description: `接口 ${lanIf}`,
										name: 'private_ipv6' as const,
										placeholder: '例如 2100::1/64',
										rule: optionalV6Rule,
										disabled: !lanPci,
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
													disabled={saving || item.disabled}
												/>
											</Form.Item>
										}
									>
										<List.Item.Meta title={item.title} description={item.description} />
									</List.Item>
								)}
							/>
							{error ? (
								<div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--app-border)' }}>
									<Typography.Paragraph type="danger" style={{ margin: 0 }}>
										{error}
									</Typography.Paragraph>
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
										if (c.currentIp !== '-') descParts.push(`IPv4 ${c.currentIp}`);
										if (c.currentIpv6 !== '-') descParts.push(`IPv6 ${c.currentIpv6}`);
										descParts.push(statusText);
										return (
											<List.Item
												key={`${label}-${c.pci}`}
												extra={
													<Space direction="vertical" size={6} style={{ width: 280 }}>
														<Input
															className="app-settings-list-input"
															disabled={!c.attached || !c.ifname || extraSaving}
															placeholder="IPv4 例如 192.168.10.1/24"
															value={c.ifname ? extraCidrByIfname[c.ifname] ?? '' : ''}
															onChange={(e) => {
																if (!c.ifname) return;
																const v = e.target.value;
																setExtraCidrByIfname((prev) => ({ ...prev, [c.ifname]: v }));
															}}
														/>
														<Input
															className="app-settings-list-input"
															disabled={!c.attached || !c.ifname || extraSaving}
															placeholder="IPv6 例如 2100::10/64"
															value={c.ifname ? extraIpv6ByIfname[c.ifname] ?? '' : ''}
															onChange={(e) => {
																if (!c.ifname) return;
																const v = e.target.value;
																setExtraIpv6ByIfname((prev) => ({ ...prev, [c.ifname]: v }));
															}}
														/>
													</Space>
												}
											>
												<List.Item.Meta title={label} description={descParts.join(' · ')} />
											</List.Item>
										);
									}}
								/>
								{extraError ? (
									<div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--app-border)' }}>
										<Typography.Paragraph type="danger" style={{ margin: 0 }}>
											{extraError}
										</Typography.Paragraph>
									</div>
								) : null}
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
