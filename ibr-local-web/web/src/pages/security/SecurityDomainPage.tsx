import { ReloadOutlined } from '@ant-design/icons';
import { Button, Spin } from 'antd';
import { BlockHeader } from '../../components/BlockHeader';
import { Card } from '../../components/Card';
import { ContentBlock } from '../../components/ContentBlock';
import { PageHeader } from '../../components/PageHeader';
import { PageStack } from '../../components/PageStack';
import { SaseDomainPageDescription } from './sasePageIntro';
import { SaseGatewayToolbar } from './SaseGatewayToolbar';
import { SecurityDomainInfo } from './SecurityDomainInfo';
import { useSaseGatewayInfo } from './useSaseGatewayInfo';

export function SecurityDomainPage() {
	const { loading, info, load } = useSaseGatewayInfo();

	return (
		<PageStack>
			<PageHeader title="网际路由域" description={<SaseDomainPageDescription />} />
			<ContentBlock>
				<BlockHeader
					title="域信息"
					action={
						<Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
							刷新
						</Button>
					}
				/>
				<Card variant="padded">
					<Spin spinning={loading}>
						<SaseGatewayToolbar stale={Boolean(info?.stale)} />
						<SecurityDomainInfo info={info} />
					</Spin>
				</Card>
			</ContentBlock>
		</PageStack>
	);
}
