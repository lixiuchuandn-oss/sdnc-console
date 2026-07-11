import { ExportOutlined } from '@ant-design/icons';
import { Alert, Button, List, Space, Tag, Typography } from 'antd';
import { listSecurityServiceItems, securityServiceDescription } from './saseDisplay';
import type { GatewayInfo } from './saseTypes';

type Props = {
	info: GatewayInfo | null;
	onOpenSso: (serviceId: string | number) => void;
};

const alertStyle = { marginBottom: 16 } as const;
function hasServiceId(sid: unknown): sid is string | number {
	return sid !== null && sid !== undefined && String(sid) !== '';
}

function nonEmptyTag(text: unknown, color?: 'success' | 'default' | 'processing' | 'error' | 'warning') {
	const s = text == null ? '' : String(text).trim();
	if (!s) return null;
	return <Tag color={color}>{s}</Tag>;
}

/** 列表区；外层由 SecurityServiceListPage 的 Card 包一层 */
export function SecurityServiceListSection({ info, onOpenSso }: Props) {
	if (info?.needsLogin) {
		return (
			<Alert type="info" showIcon style={alertStyle} message="请先登录" description="登录后可查看 CSM 安全服务。" />
		);
	}

	if (info?.unavailable) {
		return (
			<Alert type="info" showIcon style={alertStyle} message="暂时无法加载" description="请稍后重试或点击刷新。" />
		);
	}

	if (info?.gatewayQuerySkipped && info.skipHint) {
		return <Alert type="info" showIcon style={alertStyle} message="暂不可用" description={info.skipHint} />;
	}

	const items = listSecurityServiceItems(info);

	if (items.length === 0) {
		const hint = !info?.linkedCsmSecurityDomainId
			? '网际路由域尚未关联 CSM 安全域，服务列表为空。'
			: info.csmProjectionError
				? String(info.csmProjectionError)
				: 'CSM 投影暂无安全服务。';
		return <Typography.Text type="secondary">{hint}</Typography.Text>;
	}

	return (
		<List
			dataSource={items}
			renderItem={(item, index) => {
				const sid = item.id;
				const canOpen = hasServiceId(sid);
				const desc = securityServiceDescription(item);
				return (
					<List.Item
						key={`${String(sid ?? 'svc')}-${index}`}
						actions={[
							<Button
								key="sso"
								type="link"
								icon={<ExportOutlined />}
								disabled={!canOpen}
								onClick={() => canOpen && void onOpenSso(sid as string | number)}
							>
								进入控制台
							</Button>,
						]}
					>
						<List.Item.Meta
							title={
								<Space>
									<strong>{item.name ?? `服务 ${String(sid ?? '')}`}</strong>
									{nonEmptyTag(item.source)}
									{nonEmptyTag(item.status, item.status === 'active' ? 'success' : 'default')}
								</Space>
							}
							{...(desc ? { description: desc } : {})}
						/>
					</List.Item>
				);
			}}
		/>
	);
}
