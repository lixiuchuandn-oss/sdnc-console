import { Alert, Descriptions, Typography } from 'antd';
import { displayCloudLine } from './saseDisplay';
import type { GatewayInfo } from './saseTypes';

type Props = {
	info: GatewayInfo | null;
};

const alertStyle = { marginBottom: 16 } as const;

function fmtLinkedCsmName(info: GatewayInfo): string {
	const linked = info.linkedCsmSecurityDomain;
	if (linked?.name && String(linked.name).trim()) return String(linked.name).trim();
	if (info.linkedCsmSecurityDomainId && String(info.linkedCsmSecurityDomainId).trim()) {
		return String(info.linkedCsmSecurityDomainId).trim();
	}
	return '—';
}

function fmtProjectionStatus(info: GatewayInfo): string {
	if (info.csmProjectionError) return String(info.csmProjectionError);
	if (info.csmProjectionReady === true) return '已就绪';
	if (info.csmProjectionReady === false) return '未就绪';
	if (info.linkedCsmSecurityDomainId) return '—';
	return '未关联 CSM 安全域';
}

/** 网际路由域摘要（与「安全服务列表」拆分） */
export function SecurityDomainInfo({ info }: Props) {
	if (info?.needsLogin) {
		return (
			<Alert
				type="info"
				showIcon
				style={alertStyle}
				message="请先登录"
				description="登录后可查看网际路由域与 CSM 关联信息。"
			/>
		);
	}

	if (info?.unavailable) {
		return (
			<Alert
				type="info"
				showIcon
				style={alertStyle}
				message="暂时无法加载"
				description="请稍后重试或点击刷新。"
			/>
		);
	}

	return (
		<>
			{info?.gatewayQuerySkipped && info.skipHint ? (
				<Alert type="info" showIcon style={alertStyle} message="暂不可用" description={info.skipHint} />
			) : null}

			{info && !info.gatewayQuerySkipped ? (
				<Descriptions column={1} bordered size="small">
					<Descriptions.Item label="域名称">{info.name ?? '—'}</Descriptions.Item>
					<Descriptions.Item label="网际路由域 ID">{info.id ?? '—'}</Descriptions.Item>
					<Descriptions.Item label="VR UUID">{info.vrUuid ?? '—'}</Descriptions.Item>
					<Descriptions.Item label="CSM 安全域">{fmtLinkedCsmName(info)}</Descriptions.Item>
					<Descriptions.Item label="CSM 资源池 ID">{info.csmCloudId ?? '—'}</Descriptions.Item>
					<Descriptions.Item label="计算云">{displayCloudLine(info)}</Descriptions.Item>
					<Descriptions.Item label="CSM 投影">{fmtProjectionStatus(info)}</Descriptions.Item>
				</Descriptions>
			) : info?.gatewayQuerySkipped ? null : (
				<Typography.Text type="secondary">暂无数据</Typography.Text>
			)}
		</>
	);
}
