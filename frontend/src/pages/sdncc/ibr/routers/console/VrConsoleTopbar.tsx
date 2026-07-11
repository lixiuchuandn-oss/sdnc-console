import React from 'react';
import { Button, Space, Tooltip, Typography } from 'antd';
import { CloseOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { buildIbrLocalWebUrl } from '../../lib/ibrLocalWebUrl';

export type VrConsoleTopbarProps = {
	name: string;
	uuid: string;
	role: string;
	managementIp: string;
	version?: string;
	refreshing: boolean;
	onBack: () => void;
	onRefresh: () => void;
};

const TopbarDivider: React.FC = () => <span className="ibr-console-topbar-divider" aria-hidden />;

export const VrConsoleTopbar: React.FC<VrConsoleTopbarProps> = ({
	name,
	uuid,
	role,
	managementIp,
	version,
	refreshing,
	onBack,
	onRefresh,
}) => {
	const uuidShort = uuid.length > 28 ? `${uuid.slice(0, 14)}…${uuid.slice(-10)}` : uuid;
	const mgmt = managementIp.trim();
	const localWebUrl = mgmt ? buildIbrLocalWebUrl({ management_ip: mgmt }) : null;
	const ver = String(version || '').trim();

	return (
		<header className="ibr-console-topbar">
			<div className="ibr-console-topbar-left">
				<span className="ibr-console-topbar-brand">IBR Console</span>
				<TopbarDivider />
				<Typography.Text className="ibr-console-topbar-name" ellipsis={{ tooltip: name }}>
					{name}
				</Typography.Text>
				{role ? <span className="ibr-console-topbar-tag">{role}</span> : null}
				{ver ? (
					<Tooltip title="软件版本">
						<span className="ibr-console-topbar-meta">v{ver}</span>
					</Tooltip>
				) : null}
				{mgmt ? (
					<Tooltip title="点击复制管理 IP">
						<Typography.Text copyable={{ text: mgmt.split('/')[0]!.trim() }} className="ibr-console-topbar-meta">
							{mgmt.split('/')[0]!.trim()}
						</Typography.Text>
					</Tooltip>
				) : (
					<span className="ibr-console-topbar-meta is-muted">管理 IP 未上报</span>
				)}
				{uuid ? (
					<Tooltip title={uuid}>
						<Typography.Text copyable={{ text: uuid }} className="ibr-console-topbar-uuid">
							{uuidShort}
						</Typography.Text>
					</Tooltip>
				) : null}
			</div>
			<Space size={4} className="ibr-console-topbar-right">
				{localWebUrl ? (
					<Tooltip title="本机 Console">
						<Button
							type="text"
							className="ibr-console-topbar-icon-btn"
							icon={<LinkOutlined />}
							href={localWebUrl}
							target="_blank"
							rel="noopener noreferrer"
						/>
					</Tooltip>
				) : null}
				<Tooltip title={refreshing ? '同步中…' : '刷新缓存'}>
					<Button
						type="text"
						className="ibr-console-topbar-icon-btn"
						icon={<ReloadOutlined spin={refreshing} />}
						onClick={onRefresh}
						disabled={refreshing}
						aria-label="刷新缓存"
					/>
				</Tooltip>
				<Tooltip title="关闭">
					<Button
						type="text"
						className="ibr-console-topbar-icon-btn"
						icon={<CloseOutlined />}
						onClick={onBack}
						aria-label="关闭"
					/>
				</Tooltip>
			</Space>
		</header>
	);
};
