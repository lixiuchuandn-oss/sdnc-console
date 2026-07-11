import { Button, Col, Row, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { BlockHeader } from '../../components/BlockHeader';
import { Card } from '../../components/Card';
import { ContentBlock } from '../../components/ContentBlock';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';

export function RoutingPolicyPage() {
	const [data, setData] = useState<{
		prefix_lists: string[];
		route_maps: string[];
		cloud_prefix_list: unknown[];
		cloud_route_map: unknown[];
	} | null>(null);

	const load = useCallback(async () => {
		try {
			const { data: d } = await api.get<{
				prefix_lists: string[];
				route_maps: string[];
				cloud_prefix_list: unknown[];
				cloud_route_map: unknown[];
			}>('/forwarding/routing-policy');
			setData(d);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	return (
		<PageStack>
			<PageHeader title="路由策略" description="查看路由策略对象（前缀列表、Route-map）。" />

			<ContentBlock>
				<BlockHeader title="策略对象" action={<Button onClick={() => void load()}>刷新</Button>} />
				<Card variant="padded">
					<Row gutter={16}>
						<Col xs={24} md={12}>
							<div className="app-subsection-title">Prefix-list（本地）</div>
							<pre className="app-code-block app-code-block-inset app-code-block-min">{(data?.prefix_lists ?? []).join('\n') || '—'}</pre>
							<div className="app-subsection-title">云配置</div>
							<pre className="app-code-block app-code-block-inset app-code-block-tall-sm">{JSON.stringify(data?.cloud_prefix_list ?? [], null, 2)}</pre>
						</Col>
						<Col xs={24} md={12}>
							<div className="app-subsection-title">Route-map（本地）</div>
							<pre className="app-code-block app-code-block-inset app-code-block-min">{(data?.route_maps ?? []).join('\n') || '—'}</pre>
							<div className="app-subsection-title">云配置</div>
							<pre className="app-code-block app-code-block-inset app-code-block-tall-sm">{JSON.stringify(data?.cloud_route_map ?? [], null, 2)}</pre>
						</Col>
					</Row>
				</Card>
			</ContentBlock>
		</PageStack>
	);
}
