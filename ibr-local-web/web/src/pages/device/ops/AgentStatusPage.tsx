import { App as AntApp, Button, Descriptions, Space, Spin, Tag, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';

export function AgentStatusPage() {
	const [loading, setLoading] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [status, setStatus] = useState<Record<string, unknown> | null>(null);
	const [csmctlReachable, setCsmctlReachable] = useState(false);
	const [nicsInitialized, setNicsInitialized] = useState(false);
	const { modal } = AntApp.useApp();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [agentRes, statusRes] = await Promise.allSettled([
				api.get<Record<string, unknown>>('/forwarding/agent/status'),
				api.get<{
					nics_initialized?: boolean;
					service_reachability?: { sdnc_csmctl?: boolean | null };
				}>('/status'),
			]);
			if (agentRes.status === 'fulfilled') setStatus(agentRes.value.data);
			else message.error(agentRes.reason instanceof Error ? agentRes.reason.message : '加载失败');
			if (statusRes.status === 'fulfilled') {
				setCsmctlReachable(statusRes.value.data?.service_reachability?.sdnc_csmctl === true);
				setNicsInitialized(Boolean(statusRes.value.data?.nics_initialized));
			}
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	const registrationOnline =
		status?.registration_status === 'ONLINE' || Boolean(status?.registration_finish);
	const canSync = nicsInitialized && csmctlReachable && registrationOnline;

	const syncControllerConfig = useCallback(() => {
		if (!nicsInitialized) {
			message.warning('请先完成网卡初始化');
			return;
		}
		if (!csmctlReachable) {
			message.warning('本机与 SDN CSMCTL 不可达，无法同步');
			return;
		}
		if (!registrationOnline) {
			message.warning('设备未注册（非 ONLINE），无法同步');
			return;
		}
		modal.confirm({
			title: '从控制器同步配置？',
			content: '将清空本机校验和，由 download 在下一轮拉取并应用控制器当前业务配置，可能覆盖本机已改 CLI。',
			okText: '同步',
			cancelText: '取消',
			onOk: async () => {
				setSyncing(true);
				try {
					const { data } = await api.post<{ ok?: boolean; error?: string; message?: string }>(
						'/forwarding/agent/sync-controller-config',
						{},
					);
					if (!data?.ok) {
						message.error(data?.error || '同步失败');
						return;
					}
					message.success(data.message || '已请求从控制器同步配置');
					await load();
				} catch (e) {
					const err = e as { response?: { data?: { error?: string } }; message?: string };
					message.error(err?.response?.data?.error || err?.message || '同步失败');
				} finally {
					setSyncing(false);
				}
			},
		});
	}, [csmctlReachable, load, modal, nicsInitialized, registrationOnline]);

	useEffect(() => {
		void load();
	}, [load]);

	const files = (status?.download_files as string[]) ?? [];

	return (
		<PageStack>
			<PageHeader title="Agent 状态" description="查看 Agent 注册状态与云下发概况。从控制器同步配置会清空本机校验和，由 download 下一轮拉取。" />

			<ContentBlock>
				<BlockHeader
					title="注册与目录"
					action={
						<Space>
							<Button
								onClick={() => syncControllerConfig()}
								loading={syncing}
								disabled={!canSync}
								title={canSync ? undefined : '需网卡已初始化、CSMCTL 可达，且 IBR注册状态为 ONLINE'}
							>
								从控制器同步配置
							</Button>
							<Button onClick={() => void load()}>刷新</Button>
						</Space>
					}
				/>
				<Card variant="padded">
					<Spin spinning={loading}>
						<Descriptions bordered size="small" column={1}>
							<Descriptions.Item label="Agent 目录">{String(status?.agent_base ?? '—')}</Descriptions.Item>
							<Descriptions.Item label="Download 目录">{String(status?.download_dir ?? '—')}</Descriptions.Item>
							<Descriptions.Item label="IBR注册状态">
								{status?.registration_status === 'ONLINE' || status?.registration_finish ? (
									<Tag color="green">ONLINE</Tag>
								) : (
									<Tag>OFFLINE</Tag>
								)}
							</Descriptions.Item>
							<Descriptions.Item label="Download 文件数">{files.length}</Descriptions.Item>
							<Descriptions.Item label="Download 文件">{files.length ? files.join(', ') : '—'}</Descriptions.Item>
						</Descriptions>
					</Spin>
				</Card>
			</ContentBlock>

			<ContentBlock>
				<BlockHeader title="vr_conf" />
				<Card variant="padded">
					<pre className="app-code-block app-code-block-inset app-code-block-tall-sm">{JSON.stringify(status?.vr_conf ?? null, null, 2) || '—'}</pre>
				</Card>
			</ContentBlock>

			<ContentBlock>
				<BlockHeader title="NetJSON 快照" />
				<Card variant="padded">
					<pre className="app-code-block app-code-block-inset app-code-block-tall">{JSON.stringify(status?.netjson ?? null, null, 2) || '（无 conf.json）'}</pre>
				</Card>
			</ContentBlock>
		</PageStack>
	);
}
