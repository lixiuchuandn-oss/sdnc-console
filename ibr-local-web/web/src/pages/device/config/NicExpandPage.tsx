import { Alert, App as AntApp, Button, Form, List, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
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

type NicRoleRow = NicRoleRowLike & { pci?: string; role?: string };

type StatusResp = {
	init_mode: 'static' | 'dhcp';
	pci_nics: PciNicBrief[];
	mgmt_pci: string | null;
	wan_pci?: string | null;
	lan_pci?: string | null;
	nics_initialized: boolean;
	os_nic_attach_pci: string[] | null;
	nic_roles?: { roles?: NicRoleRow[] } | null;
};

type Caps = {
	vpp_hot_attach?: boolean;
	conditional_vbras_restart?: boolean;
	expand_requires_vbras_restart?: boolean | null;
	remove_requires_vbras_restart?: boolean | null;
	remove_return_to_os?: boolean;
};

function resolveProtectedFromStatus(status: StatusResp | null): { wan: string | null; lan: string | null; protectedPcis: Set<string> } {
	const wan = String(status?.wan_pci ?? '').trim() || null;
	const lan = String(status?.lan_pci ?? '').trim() || null;
	return { wan, lan, protectedPcis: new Set([wan, lan].filter((x): x is string => !!x)) };
}

export function NicExpandPage() {
	const navigate = useNavigate();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<StatusResp | null>(null);
	const [caps, setCaps] = useState<Caps | null>(null);
	const [previewOpen, setPreviewOpen] = useState(false);
	const [previewContent, setPreviewContent] = useState('');
	const [previewNote, setPreviewNote] = useState('');
	const [previewKind, setPreviewKind] = useState<'expand' | 'remove'>('expand');
	const [previewNeedsRestart, setPreviewNeedsRestart] = useState(true);
	const [pendingPcis, setPendingPcis] = useState<string[]>([]);
	const [pciSelectOpen, setPciSelectOpen] = useState(false);
	const [form] = Form.useForm<{ add_pcis: string[] }>();
	const { message } = AntApp.useApp();

	const reload = async () => {
		const [st, cap] = await Promise.all([
			api.get<StatusResp>('/status'),
			api.get<Caps & { ok?: boolean }>('/nics/capabilities').catch(() => ({ data: {} as Caps })),
		]);
		setStatus(st.data);
		setCaps(cap.data);
	};

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			setError(null);
			try {
				await reload();
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const mgmtPci = status?.mgmt_pci ?? null;
	const roles = status?.nic_roles?.roles ?? [];
	const { wan, lan, protectedPcis } = useMemo(() => resolveProtectedFromStatus(status), [status]);
	const identityReady = Boolean(wan && (status?.init_mode === 'dhcp' ? true : lan));
	const candidates = useMemo(
		() =>
			buildUnattachedPciSelectOptions({
				pciNics: status?.pci_nics,
				mgmtPci,
				attachedPcis: status?.os_nic_attach_pci,
				roles,
			}),
		[status, mgmtPci, roles],
	);

	const attachedRows = useMemo(() => {
		return (status?.os_nic_attach_pci ?? []).map((pci) => {
			let kind: 'wan' | 'lan' | 'aux' = 'aux';
			if (pci === wan) kind = 'wan';
			else if (pci === lan) kind = 'lan';
			else if (protectedPcis.has(pci)) kind = pci === wan ? 'wan' : 'lan';
			return { pci, kind, removable: kind === 'aux' };
		});
	}, [status, wan, lan, protectedPcis]);

	const needsRestart = previewNeedsRestart;

	if (loading) {
		return (
			<PageStack>
				<PageHeader title="辅助网卡管理" description="扩容或删除辅助口；WAN/LAN 不可删。" />
				<ContentBlock>
					<Card variant="padded">
						<Spin />
					</Card>
				</ContentBlock>
			</PageStack>
		);
	}

	if (!status?.nics_initialized || !identityReady) {
		return (
			<PageStack>
				<PageHeader title="辅助网卡管理" description="扩容或删除辅助口。" />
				<ContentBlock>
					<Card variant="padded">
						<Alert
							type="warning"
							showIcon
							message="尚未完成网卡初始化"
							description="请先完成「初始化网卡」后再管理辅助口。"
							action={
								<Button type="primary" onClick={() => navigate('/init')}>
									去初始化
								</Button>
							}
						/>
					</Card>
				</ContentBlock>
			</PageStack>
		);
	}

	return (
		<>
			<PageStack>
				<PageHeader title="辅助网卡管理" description="扩容登记辅助口；删除辅助口时退回操作系统。" />

				<ContentBlock>
					<BlockHeader title="已接管业务口" />
					<Card variant="list">
						<div style={{ padding: '12px 20px 0' }}>
							<Space wrap>
								<Tag>已接管 {(status.os_nic_attach_pci ?? []).length} 块</Tag>
								{caps?.vpp_hot_attach === true ? <Tag color="success">支持热添加</Tag> : null}
							</Space>
						</div>
						{attachedRows.length === 0 ? (
							<Typography.Paragraph type="secondary" style={{ margin: 0, padding: '14px 20px' }}>
								无已接管业务口。
							</Typography.Paragraph>
						) : (
							<List
								split
								className="app-settings-list"
								dataSource={attachedRows}
								renderItem={(row) => (
									<List.Item
										key={row.pci}
										actions={
											row.removable
												? [
														<Button
															key="rm"
															danger
															size="small"
															loading={saving}
															onClick={async () => {
																setSaving(true);
																setError(null);
																setPendingPcis([row.pci]);
																setPreviewKind('remove');
																try {
																	const { data } = await api.post<{
																		ok: boolean;
																		config_content?: string;
																		preview_note?: string;
																		requires_vbras_restart?: boolean;
																		error?: string;
																	}>('/nics/remove_preview', {
																		remove_pcis: [row.pci],
																		return_to_os: true,
																	});
																	if (!data?.ok) throw new Error(data?.error || '预览失败');
																	setPreviewContent(String(data.config_content ?? ''));
																	setPreviewNote(String(data.preview_note ?? ''));
																	setPreviewNeedsRestart(Boolean(data.requires_vbras_restart));
																	setPreviewOpen(true);
																} catch (e) {
																	setError(e instanceof Error ? e.message : '预览失败');
																} finally {
																	setSaving(false);
																}
															}}
														>
															删除辅助口
														</Button>,
													]
												: [
														<Tag key="lock" color="warning">
															{row.kind === 'wan' ? 'WAN' : 'LAN'}（不可删）
														</Tag>,
													]
										}
									>
										<List.Item.Meta
											title={formatPciNicSelectLabel(
												(status.pci_nics ?? []).find((x) => String(x.pci ?? '').trim() === row.pci) ?? { pci: row.pci },
												findNicRoleByPci(roles, row.pci),
											)}
											description={row.removable ? '辅助口' : '主业务口'}
										/>
									</List.Item>
								)}
							/>
						)}
						{error ? (
							<div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--app-border)' }}>
								<Typography.Paragraph type="danger" style={{ margin: 0 }}>
									{error}
								</Typography.Paragraph>
							</div>
						) : null}
					</Card>
				</ContentBlock>

				<ContentBlock>
					<BlockHeader title="扩容辅助口" />
					<Card variant="padded">
						<Form
							form={form}
							layout="vertical"
							onFinish={async (values) => {
								const list = Array.isArray(values.add_pcis) ? values.add_pcis.map(String) : [];
								if (list.length === 0) {
									setError('请至少选择一块网卡');
									return;
								}
								setSaving(true);
								setError(null);
								setPendingPcis(list);
								setPreviewKind('expand');
								try {
									const { data } = await api.post<{
										ok: boolean;
										config_content?: string;
										preview_note?: string;
										requires_vbras_restart?: boolean;
										error?: string;
									}>('/nics/expand_preview', { add_pcis: list });
									if (!data?.ok) throw new Error(data?.error || '预览失败');
									setPreviewContent(String(data.config_content ?? ''));
									setPreviewNote(String(data.preview_note ?? ''));
									setPreviewNeedsRestart(Boolean(data.requires_vbras_restart));
									setPreviewOpen(true);
								} catch (e) {
									setError(e instanceof Error ? e.message : '预览失败');
								} finally {
									setSaving(false);
								}
							}}
						>
							<Form.Item
								label="待扩容 PCI（最多补齐至 6 块）"
								name="add_pcis"
								rules={[{ required: true, message: '请选择 PCI' }]}
							>
								<Select
									mode="multiple"
									placeholder={candidates.length ? '选择未接管网卡' : '无可用网卡'}
									options={candidates}
									disabled={candidates.length === 0}
									optionFilterProp="label"
									showSearch
									open={pciSelectOpen}
									onDropdownVisibleChange={setPciSelectOpen}
									onSelect={() => setPciSelectOpen(false)}
								/>
							</Form.Item>
							<Space>
								<Button type="primary" htmlType="submit" loading={saving} disabled={candidates.length === 0}>
									预览并扩容
								</Button>
							</Space>
						</Form>
					</Card>
				</ContentBlock>
			</PageStack>

			<Modal
				title={previewKind === 'expand' ? '扩容预览' : '删除辅助口预览'}
				open={previewOpen}
				okText={needsRestart ? '应用并重启 VBRAS' : '应用'}
				okButtonProps={{ loading: saving, danger: needsRestart }}
				cancelText="取消"
				onCancel={() => setPreviewOpen(false)}
				onOk={async () => {
					setSaving(true);
					setError(null);
					try {
						if (previewKind === 'expand') {
							const { data } = await api.post<{ ok: boolean; logs?: string[]; error?: string }>('/nics/expand_apply', {
								add_pcis: pendingPcis,
							});
							if (!data?.ok) throw new Error(data?.error || '扩容失败');
							message.success('扩容完成');
						} else {
							const { data } = await api.post<{ ok: boolean; logs?: string[]; error?: string }>('/nics/remove_apply', {
								remove_pcis: pendingPcis,
								return_to_os: true,
							});
							if (!data?.ok) throw new Error(data?.error || '删除失败');
							message.success('已删除并退回操作系统');
						}
						setPreviewOpen(false);
						await reload();
						form.resetFields();
					} catch (e) {
						setError(e instanceof Error ? e.message : '操作失败');
					} finally {
						setSaving(false);
					}
				}}
			>
				<Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
					{previewNote || '确认后应用。'}
				</Typography.Paragraph>
				<pre className="app-code-block app-code-block-inset app-code-block-tall">{previewContent || '(空)'}</pre>
			</Modal>
		</>
	);
}
