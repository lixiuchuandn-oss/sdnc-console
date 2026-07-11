import { MoreOutlined } from '@ant-design/icons';
import { Avatar, Button, Dropdown, Layout, Typography } from 'antd';
import type { ReactNode } from 'react';
import { AppSiderNav } from './AppSiderNav.js';
import type { NavSection } from './navTypes.js';

const { Sider, Content } = Layout;

const SIDER_WIDTH = 280;

export type AppDomain = 'device' | 'forward' | 'security';

const DOMAIN_LABELS: Record<AppDomain, string> = {
	device: '设备管理',
	forward: '转发配置',
	security: '安全服务',
};

const DOMAIN_OPTIONS: { value: AppDomain; label: string }[] = [
	{ value: 'device', label: DOMAIN_LABELS.device },
	{ value: 'forward', label: DOMAIN_LABELS.forward },
	{ value: 'security', label: DOMAIN_LABELS.security },
];

export type AppShellUser = {
	sub: string;
	name?: string;
	tenant_name?: string;
	org_name?: string;
};

type AppShellProps = {
	domain: AppDomain;
	onDomainChange: (domain: AppDomain) => void;
	navSections: NavSection[];
	selectedKey: string;
	onNavigate: (path: string) => void;
	user: AppShellUser;
	onLogout: () => void;
	children: ReactNode;
};

function displayName(user: AppShellUser): string {
	const sub = String(user.sub ?? '');
	const name = user.name?.trim();
	if (name && name !== sub) return name;
	return name || sub || '用户';
}

function avatarLabel(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return '?';
	const chars = trimmed.replace(/\s+/g, '');
	if (chars.length >= 2) return chars.slice(-2);
	return chars.slice(0, 1);
}

export function AppShell(props: AppShellProps) {
	const who = displayName(props.user);
	const ctx = [props.user.tenant_name?.trim(), props.user.org_name?.trim()].filter(Boolean).join(' · ');

	return (
		<Layout className="app-shell">
			<Sider className="app-shell-sider" width={SIDER_WIDTH}>
				<div className="app-shell-sider-inner">
					<div className="app-shell-brand">
						<div className="app-shell-brand-text">
							<Typography.Text strong className="app-shell-brand-title">
								IBR
							</Typography.Text>
							<Typography.Text type="secondary" className="app-shell-brand-sub">
								{DOMAIN_LABELS[props.domain]}
							</Typography.Text>
						</div>
						<Dropdown
							trigger={['click']}
							placement="bottomRight"
							overlayClassName="app-shell-domain-menu"
							menu={{
								selectedKeys: [props.domain],
								items: DOMAIN_OPTIONS.map((opt) => ({
									key: opt.value,
									label: opt.label,
									onClick: () => props.onDomainChange(opt.value),
								})),
							}}
						>
							<Button
								type="text"
								size="small"
								className="app-shell-domain-more"
								icon={<MoreOutlined />}
								aria-label="切换功能域"
							/>
						</Dropdown>
					</div>

					<div className="app-shell-menu-wrap">
						<AppSiderNav sections={props.navSections} selectedKey={props.selectedKey} onNavigate={props.onNavigate} />
					</div>

					<div className="app-shell-footer">
						<div className="app-shell-user">
							<Avatar className="app-shell-user-avatar" size={32}>
								{avatarLabel(who)}
							</Avatar>
							<div className="app-shell-user-text">
								<Typography.Text ellipsis className="app-shell-user-name">
									{who}
								</Typography.Text>
								{ctx ? (
									<Typography.Text type="secondary" ellipsis className="app-shell-user-meta">
										{ctx}
									</Typography.Text>
								) : null}
							</div>
							<Dropdown
								trigger={['click']}
								placement="topRight"
								overlayClassName="app-shell-domain-menu"
								menu={{
									items: [{ key: 'logout', label: '退出登录', onClick: props.onLogout }],
								}}
							>
								<Button type="text" size="small" className="app-shell-user-more" icon={<MoreOutlined />} aria-label="账户菜单" />
							</Dropdown>
						</div>
					</div>
				</div>
			</Sider>

			<Layout className="app-shell-main">
				<Content className="app-shell-content">
					<div className="app-shell-content-inner">{props.children}</div>
				</Content>
			</Layout>
		</Layout>
	);
}
