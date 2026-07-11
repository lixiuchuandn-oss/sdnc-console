import { Button, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { BlockHeader } from '../../components/BlockHeader';
import { Card } from '../../components/Card';
import { ContentBlock } from '../../components/ContentBlock';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';

export function Srv6Page() {
	const [loading, setLoading] = useState(false);
	const [raw, setRaw] = useState('');
	const [cloud, setCloud] = useState<unknown[]>([]);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ raw: string; cloud: unknown[] }>('/forwarding/srv6');
			setRaw(data.raw ?? '');
			setCloud(data.cloud ?? []);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	return (
		<PageStack>
			<PageHeader title="SRv6" description="查看 SRv6 运行状态与配置。" />

			<ContentBlock>
				<BlockHeader title="云配置" action={<Button loading={loading} onClick={() => void load()}>刷新</Button>} />
				<Card variant="padded">
					<pre className="app-code-block app-code-block-inset app-code-block-tall-sm">{JSON.stringify(cloud, null, 2) || '[]'}</pre>
				</Card>
			</ContentBlock>

			<ContentBlock>
				<BlockHeader title="设备输出" />
				<Card variant="padded">
					<pre className="app-code-block app-code-block-inset app-code-block-tall">{raw.trim() || '—'}</pre>
				</Card>
			</ContentBlock>
		</PageStack>
	);
}
