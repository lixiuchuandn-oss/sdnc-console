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
	const [instancesRaw, setInstancesRaw] = useState('');
	const [groupsRaw, setGroupsRaw] = useState('');

	const load = useCallback(async () => {
		try {
			const { data } = await api.get<{
				cloud: unknown[];
				instancesRaw?: string;
				groupsRaw?: string;
			}>('/forwarding/vrrp');
			setCloud(data.cloud ?? []);
			setInstancesRaw(String(data.instancesRaw || ''));
			setGroupsRaw(String(data.groupsRaw || ''));
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	return (
		<PageStack>
			<PageHeader title="VRRP" description="查看 VRRP 云配置与 keepalived 运行状态。" />

			<ContentBlock>
				<BlockHeader title="云配置 VRRP" action={<Button onClick={() => void load()}>刷新</Button>} />
				<Card variant="padded">
					<pre className="app-code-block app-code-block-inset app-code-block-tall-sm">{JSON.stringify(cloud, null, 2) || '[]'}</pre>
				</Card>
			</ContentBlock>

			<ContentBlock>
				<BlockHeader title="运行状态（do show vrrp）" />
				<Card variant="padded">
					<Collapse
						defaultActiveKey={['instances', 'groups']}
						items={[
							{
								key: 'instances',
								label: 'do show vrrp instances',
								children: (
									<pre className="app-code-block app-code-block-inset app-code-block-tall">
										{instancesRaw.slice(0, 12000) || '（无输出）'}
									</pre>
								),
							},
							{
								key: 'groups',
								label: 'do show vrrp groups',
								children: (
									<pre className="app-code-block app-code-block-inset app-code-block-tall">
										{groupsRaw.slice(0, 12000) || '（无输出）'}
									</pre>
								),
							},
						]}
					/>
				</Card>
			</ContentBlock>
		</PageStack>
	);
}
