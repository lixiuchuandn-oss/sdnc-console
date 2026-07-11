import { Button, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { TableBlock } from '../../components/TableBlock';

type VrfRow = { name: string; source: string };

export function VrfPage() {
	const [loading, setLoading] = useState(false);
	const [vrfs, setVrfs] = useState<VrfRow[]>([]);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await api.get<{ vrfs: VrfRow[] }>('/forwarding/vrf');
			setVrfs(data.vrfs ?? []);
		} catch (e) {
			message.error(e instanceof Error ? e.message : '加载失败');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const columns: ColumnsType<VrfRow> = [
		{ title: 'VRF 名称/ID', dataIndex: 'name' },
		{
			title: '来源',
			dataIndex: 'source',
			render: (s: string) => {
				const label = s === 'cloud' ? '云平台' : s === 'both' ? '云+本地' : '本地';
				const color = s === 'cloud' ? 'blue' : s === 'both' ? 'purple' : 'default';
				return <Tag color={color}>{label}</Tag>;
			},
		},
	];

	return (
		<PageStack>
			<PageHeader title="VRF" description="查看设备上的 VRF 实例列表。" />
			<TableBlock
				title="VRF 列表"
				action={<Button onClick={() => void load()}>刷新</Button>}
				loading={loading}
				rowKey="name"
				columns={columns}
				dataSource={vrfs}
				paginated={false}
			/>
		</PageStack>
	);
}
