import { Button, Collapse, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { BlockHeader } from '../../components/BlockHeader';
import { Card } from '../../components/Card';
import { ContentBlock } from '../../components/ContentBlock';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { TableBlock } from '../../components/TableBlock';

type Neighbor = Record<string, string>;

export function BgpPage() {
	const [loading, setLoading] = useState(false);
	const [raw, setRaw] = useState('');
	const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
	const [cloud, setCloud] = useState<unknown[]>([]);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ raw: string; neighbors: Neighbor[]; cloud: unknown[] }>('/forwarding/bgp/summary');
			setRaw(data.raw ?? '');
			setNeighbors(data.neighbors ?? []);
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

	const columns: ColumnsType<Neighbor> = [
		{ title: '邻居', dataIndex: 'neighbor' },
		{ title: 'AS', dataIndex: 'as', width: 100 },
		{ title: 'Up/Down', dataIndex: 'up_down', width: 120 },
		{ title: '状态', dataIndex: 'state', ellipsis: true },
	];

	return (
		<PageStack>
			<PageHeader title="BGP" description="查看 BGP 邻居状态与配置。" />

			<TableBlock
				title="BGP 邻居"
				action={<Button onClick={() => void load()}>刷新</Button>}
				loading={loading}
				rowKey="neighbor"
				columns={columns}
				dataSource={neighbors}
				paginated={false}
				scroll={{ x: true }}
			/>

			<ContentBlock>
				<BlockHeader title="云配置 BGP" />
				<Card variant="padded">
					<pre className="app-code-block app-code-block-inset">{JSON.stringify(cloud, null, 2) || '[]'}</pre>
				</Card>
			</ContentBlock>

			<ContentBlock>
				<BlockHeader title="原始输出" />
				<Card variant="padded">
					<Collapse items={[{ key: 'raw', label: 'show bgp summary 原始输出', children: <pre className="app-code-block app-code-block-inset">{raw}</pre> }]} />
				</Card>
			</ContentBlock>
		</PageStack>
	);
}
