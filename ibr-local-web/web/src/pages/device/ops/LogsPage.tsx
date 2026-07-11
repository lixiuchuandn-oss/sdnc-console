import { Button, Typography, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { BlockHeader } from '../../../components/BlockHeader';
import { Card } from '../../../components/Card';
import { ContentBlock } from '../../../components/ContentBlock';
import { PageHeader } from '../../../components/PageHeader';
import { PageStack } from '../../../components/PageStack';

export function LogsPage() {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [text, setText] = useState<string>('');

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await api.get('/system/logs', { responseType: 'text' });
			const s = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
			setText(s);
		} catch (e) {
			setError(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text || '');
			message.success('已复制');
		} catch {
			message.error('复制失败');
		}
	};

	return (
		<PageStack>
			<PageHeader title="查看日志" description="查看 VBRAS 服务运行日志。" />

			<ContentBlock>
				<BlockHeader
					title="VBRAS 日志"
					action={
						<>
							<Button onClick={() => void load()} loading={loading}>
								刷新
							</Button>
							<Button onClick={() => void copy()} disabled={!text}>
								复制
							</Button>
						</>
					}
				/>
				<Card variant="padded">
					{error ? (
						<Typography.Paragraph type="danger" style={{ marginTop: 0 }}>
							{error}
						</Typography.Paragraph>
					) : null}
					<pre className="app-code-block app-code-block-inset app-code-block-tall">{loading ? '加载中…' : text || '暂无日志'}</pre>
				</Card>
			</ContentBlock>
		</PageStack>
	);
}
