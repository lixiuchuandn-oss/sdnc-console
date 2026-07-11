import { Button, Descriptions, Spin, Tag, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';

export function AgentStatusPage() {
	const [loading, setLoading] = useState(false);
	const [status, setStatus] = useState<Record<string, unknown> | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<Record<string, unknown>>('/forwarding/agent/status');
			setStatus(data);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const files = (status?.download_files as string[]) ?? [];

	return (
		<PageStack>
			<PageHeader title="Agent 状态" description="查看 Agent 注册状态与云下发概况。" />

			<ContentBlock>
				<BlockHeader title="注册与目录" action={<Button onClick={() => void load()}>刷新</Button>} />
				<Card variant="padded">
					<Spin spinning={loading}>
						<Descriptions bordered size="small" column={1}>
							<Descriptions.Item label="Agent 目录">{String(status?.agent_base ?? '—')}</Descriptions.Item>
							<Descriptions.Item label="Download 目录">{String(status?.download_dir ?? '—')}</Descriptions.Item>
							<Descriptions.Item label="注册完成">
								{status?.registration_finish ? <Tag color="green">是</Tag> : <Tag>否</Tag>}
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
