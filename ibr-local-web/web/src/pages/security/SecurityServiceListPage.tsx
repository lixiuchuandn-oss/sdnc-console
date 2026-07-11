import { ReloadOutlined } from '@ant-design/icons';
import { Button, Spin } from 'antd';
import { BlockHeader } from '../../components/BlockHeader';
import { Card } from '../../components/Card';
import { ContentBlock } from '../../components/ContentBlock';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { SaseListPageDescription } from './sasePageIntro';
import { SaseGatewayToolbar } from './SaseGatewayToolbar';
import { SecurityServiceListSection } from './SecurityServiceListSection';
import { useSaseGatewayInfo } from './useSaseGatewayInfo';

export function SecurityServiceListPage() {
	const { loading, info, load, openSso } = useSaseGatewayInfo();

	return (
		<PageStack>
			<PageHeader title="安全服务" description={<SaseListPageDescription />} />
			<ContentBlock>
				<BlockHeader
					title="服务列表"
					action={
						<Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
							刷新
						</Button>
					}
				/>
				<Card variant="padded">
					<Spin spinning={loading}>
						<SaseGatewayToolbar stale={Boolean(info?.stale)} />
						<SecurityServiceListSection info={info} onOpenSso={openSso} />
					</Spin>
				</Card>
			</ContentBlock>
		</PageStack>
	);
}
