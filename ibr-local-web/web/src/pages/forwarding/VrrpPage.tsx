import { Button, Collapse, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { BlockHeader } from '../../components/BlockHeader';
import { Card } from '../../components/Card';
import { ContentBlock } from '../../components/ContentBlock';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';

export function VrrpPage() {
	const [cloud, setCloud] = useState<unknown[]>([]);
	const [groups, setGroups] = useState<unknown[]>([]);
	const [raw, setRaw] = useState('');

	const load = useCallback(async () => {
		try {
			const { data } = await api.get<{ cloud: unknown[]; groups: unknown[]; raw: string }>('/forwarding/vrrp');
			setCloud(data.cloud ?? []);
			setGroups(data.groups ?? []);
			setRaw(data.raw ?? '');
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	return (
		<PageStack>
			<PageHeader title="VRRP" description="查看 VRRP 组配置与主备状态。" />

			<ContentBlock>
				<BlockHeader title="云配置 VRRP" action={<Button onClick={() => void load()}>刷新</Button>} />
				<Card variant="padded">
					<pre className="app-code-block app-code-block-inset app-code-block-tall-sm">{JSON.stringify(cloud, null, 2) || '[]'}</pre>
				</Card>
			</ContentBlock>

			<ContentBlock>
				<BlockHeader title="本地 running-config 片段" />
				<Card variant="padded">
					<pre className="app-code-block app-code-block-inset app-code-block-tall-sm">{JSON.stringify(groups, null, 2) || '[]'}</pre>
				</Card>
			</ContentBlock>

			<ContentBlock>
				<BlockHeader title="完整配置节选" />
				<Card variant="padded">
					<Collapse
						items={[
							{
								key: 'raw',
								label: '完整 running-config（节选检索）',
								children: <pre className="app-code-block app-code-block-inset app-code-block-tall">{raw.slice(0, 12000)}</pre>,
							},
						]}
					/>
				</Card>
			</ContentBlock>
		</PageStack>
	);
}
