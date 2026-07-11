import { App as AntApp, Button, Spin, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, publicApi, setToken } from './api/client';
import { AppShell, type AppDomain } from './layout/AppShell';
import { DOMAIN_HOME, ROUTE_META } from './layout/routing';
import { useAppNavSections } from './layout/useAppMenus';
import { HomePage } from './pages/device/overview/overview';
import { SetIpPage } from './pages/device/config/SetIpPage';
import { NicInitPage } from './pages/device/config/NicInitPage';
import { DeviceServicePage } from './pages/device/config/DeviceServicePage';
import { HealthPage } from './pages/device/ops/HealthPage';
import { LogsPage } from './pages/device/ops/LogsPage';
import { LoginPage } from './pages/LoginPage';
import { RoutesPage } from './pages/forwarding/RoutesPage';
import { AclPage } from './pages/forwarding/AclPage';
import { NatDnatPage, NatSnatPage, NatStaticPage } from './pages/forwarding/NatPages';
import { CloudConfigPage } from './pages/forwarding/CloudConfigPage';
import { IpsecTunnelPage } from './pages/forwarding/IpsecTunnelPage';
import { IpsecGuardPage } from './pages/forwarding/IpsecGuardPage';
import { BgpPage } from './pages/forwarding/BgpPage';
import { VrfPage } from './pages/forwarding/VrfPage';
import { Ipv6RoutesPage } from './pages/forwarding/Ipv6RoutesPage';
import { VrrpPage } from './pages/forwarding/VrrpPage';
import { RoutingPolicyPage } from './pages/forwarding/RoutingPolicyPage';
import { Srv6Page } from './pages/forwarding/Srv6Page';
import { SubIfPage } from './pages/forwarding/SubIfPage';
import { AgentStatusPage } from './pages/device/ops/AgentStatusPage';
import { AssetListPage } from './pages/security/AssetListPage';
import { AssetScanNowPage } from './pages/security/AssetScanNowPage';
import { SecurityDomainPage } from './pages/security/SecurityDomainPage';
import { SecurityServiceListPage } from './pages/security/SecurityServiceListPage';
import { AiThreatIntelPage } from './pages/security/AiThreatIntelPage';

type MeUser = {
	sub: string;
	name?: string;
	tenant_id?: string;
	org_id?: string;
	tenant_name?: string;
	org_name?: string;
};

function useMe(enabled: boolean) {
	const [user, setUser] = useState<MeUser | null>(null);
	const [loading, setLoading] = useState(enabled);
	const [meError, setMeError] = useState<string | null>(null);
	const [meRetry, setMeRetry] = useState(0);

	useEffect(() => {
		if (!enabled) {
			setLoading(false);
			setUser(null);
			setMeError(null);
			return;
		}
		let cancelled = false;
		setLoading(true);
		(async () => {
			setMeError(null);
			try {
				const meRes = await api.get<MeUser>('/me');
				if (cancelled) return;
				if (meRes.data?.sub) {
					setUser(meRes.data);
				} else {
					setUser(null);
					setMeError('登录已失效，请重新登录');
				}
			} catch (e) {
				if (!cancelled) {
					setUser(null);
					setMeError(e instanceof Error ? e.message : '请求失败');
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [enabled, meRetry]);

	return { user, loading, meError, retryMe: () => setMeRetry((n) => n + 1) };
}

function AppRoutes() {
	return (
		<Routes>
			<Route path="/" element={<HomePage />} />
			<Route path="/init" element={<NicInitPage />} />
			<Route path="/device/ip" element={<SetIpPage />} />
			<Route path="/device/service" element={<DeviceServicePage />} />
			<Route path="/device/nic-reset" element={<Navigate to="/init" replace />} />
			<Route path="/ops/health" element={<HealthPage />} />
			<Route path="/ops/logs" element={<LogsPage />} />
			<Route path="/ops/agent" element={<AgentStatusPage />} />

			<Route path="/forward/routes" element={<RoutesPage />} />
			<Route path="/forward/routes/ipv6" element={<Ipv6RoutesPage />} />
			<Route path="/forward/acl" element={<AclPage />} />
			<Route path="/forward/cloud-config" element={<CloudConfigPage />} />
			<Route path="/forward/bgp" element={<BgpPage />} />
			<Route path="/forward/vrf" element={<VrfPage />} />
			<Route path="/forward/vrrp" element={<VrrpPage />} />
			<Route path="/forward/subif" element={<SubIfPage />} />
			<Route path="/forward/routing-policy" element={<RoutingPolicyPage />} />
			<Route path="/forward/srv6" element={<Srv6Page />} />
			<Route path="/forward/nat/static" element={<NatStaticPage />} />
			<Route path="/forward/nat/snat" element={<NatSnatPage />} />
			<Route path="/forward/nat/dnat" element={<NatDnatPage />} />
			<Route path="/forward/ipsec/tunnel" element={<IpsecTunnelPage />} />
			<Route path="/forward/ipsec/guard" element={<IpsecGuardPage />} />

			<Route path="/security/assets" element={<Navigate to="/security/assets/list" replace />} />
			<Route path="/security/assets/list" element={<AssetListPage />} />
			<Route path="/security/assets/scan" element={<AssetScanNowPage />} />
			<Route path="/security/assets/policy" element={<Navigate to="/security/assets/scan" replace />} />
			<Route path="/security/services" element={<Navigate to="/security/services/domain" replace />} />
			<Route path="/security/services/domain" element={<SecurityDomainPage />} />
			<Route path="/security/services/list" element={<SecurityServiceListPage />} />
			<Route path="/security/aisoc/threats" element={<AiThreatIntelPage />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}

export default function App() {
	const location = useLocation();
	const navigate = useNavigate();
	const onLoginPage = location.pathname === '/login';
	const { user, loading, meError, retryMe } = useMe(!onLoginPage);

	const selectedKey = useMemo(() => {
		if (ROUTE_META.has(location.pathname)) return location.pathname;
		return '/';
	}, [location.pathname]);

	const domain = ROUTE_META.get(selectedKey)?.topKey ?? 'device';
	const navSections = useAppNavSections(domain);

	const handleDomainChange = (next: AppDomain) => {
		if (next === domain) return;
		navigate(DOMAIN_HOME[next]);
	};

	if (onLoginPage) {
		return (
			<LoginPage
				onAuthed={() => {
					retryMe();
					navigate('/', { replace: true });
				}}
			/>
		);
	}

	if (loading) {
		return (
			<div className="app-loading">
				<Spin size="large" tip="加载中…">
					<div style={{ minHeight: 120 }} />
				</Spin>
			</div>
		);
	}

	if (!user) {
		return (
			<AntApp>
				<div className="app-auth-fallback">
					<div className="app-auth-fallback-inner">
						<Typography.Title level={4} style={{ marginTop: 0 }}>
							暂无法验证登录
						</Typography.Title>
						{meError ? (
							<Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
								登录已失效或未登录，请重新登录。
							</Typography.Paragraph>
						) : (
							<Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
								请先前往登录页输入访问令牌。
							</Typography.Paragraph>
						)}
						<Button type="primary" onClick={() => navigate('/login')}>
							去登录
						</Button>
						<Button style={{ marginLeft: 8 }} onClick={retryMe}>
							重试
						</Button>
					</div>
				</div>
			</AntApp>
		);
	}

	return (
		<AntApp>
			<AppShell
				domain={domain}
				onDomainChange={handleDomainChange}
				navSections={navSections}
				selectedKey={selectedKey}
				onNavigate={(path) => navigate(path)}
				user={user}
				onLogout={() => {
					void (async () => {
						try {
							await publicApi.post('/account/logout');
						} catch {
							/* 忽略远端清理失败 */
						}
						setToken(null);
						navigate('/login', { replace: true });
					})();
				}}
			>
				<AppRoutes />
			</AppShell>
		</AntApp>
	);
}
