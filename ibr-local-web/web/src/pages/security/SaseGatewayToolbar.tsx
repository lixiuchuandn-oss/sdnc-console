import { Alert } from 'antd';

type Props = {
	stale: boolean;
};

const alertStyle = { marginBottom: 16 } as const;

/** 缓存数据过期时的提示；全页「刷新」在 BlockHeader 的 action */
export function SaseGatewayToolbar({ stale }: Props) {
	if (!stale) return null;

	return (
		<Alert
			type="warning"
			showIcon
			style={alertStyle}
			message="暂时无法获取最新数据"
			description="当前展示的是上次成功加载的内容，请稍后重试或点击刷新。"
		/>
	);
}
