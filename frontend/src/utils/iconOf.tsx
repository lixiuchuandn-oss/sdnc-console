/**
 * 路由图标名 → Ant Design 图标组件的中性映射（从 `components/PageContainer` 迁出）。
 *
 * 放在 utils/ 而非组件文件，便于侧栏 / 详情容器 / 导航纯函数等跨层复用，避免「为取图标
 * 反向依赖某个页面组件」。未命中时回退 `AppstoreOutlined`。
 */
import React from 'react';
import {
  AppstoreOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  CloudUploadOutlined,
  DesktopOutlined,
  TeamOutlined,
  UserOutlined,
  UserSwitchOutlined,
  GatewayOutlined,
  FolderOutlined,
  LockOutlined,
  ApiOutlined,
  BranchesOutlined,
  GlobalOutlined,
  EnvironmentOutlined,
  ShareAltOutlined,
  NodeIndexOutlined,
  SecurityScanOutlined,
  SwapOutlined,
  AppstoreAddOutlined,
  BarChartOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  RadarChartOutlined,
  DatabaseOutlined,
  CloudDownloadOutlined,
  SolutionOutlined,
  ClusterOutlined,
  BorderOuterOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  AuditOutlined,
  RocketOutlined,
} from '@ant-design/icons';

/**
 * 图标映射函数：根据图标名称字符串返回对应的 Ant Design 图标组件。
 *
 * @param key - 图标名称（如 `'AppstoreOutlined'`）
 * @returns React 图标组件，未找到则返回默认图标 `AppstoreOutlined`
 */
export const iconOf = (key?: string): React.ReactNode => {
  const m: Record<string, React.ReactNode> = {
    RocketOutlined: <RocketOutlined />,
    AppstoreOutlined: <AppstoreOutlined />,
    DashboardOutlined: <DashboardOutlined />,
    DeploymentUnitOutlined: <DeploymentUnitOutlined />,
    CloudUploadOutlined: <CloudUploadOutlined />,
    DesktopOutlined: <DesktopOutlined />,
    TeamOutlined: <TeamOutlined />,
    UserOutlined: <UserOutlined />,
    UserSwitchOutlined: <UserSwitchOutlined />,
    GatewayOutlined: <GatewayOutlined />,
    FolderOutlined: <FolderOutlined />,
    LockOutlined: <LockOutlined />,
    ApiOutlined: <ApiOutlined />,
    BranchesOutlined: <BranchesOutlined />,
    GlobalOutlined: <GlobalOutlined />,
    EnvironmentOutlined: <EnvironmentOutlined />,
    ShareAltOutlined: <ShareAltOutlined />,
    NodeIndexOutlined: <NodeIndexOutlined />,
    SecurityScanOutlined: <SecurityScanOutlined />,
    SwapOutlined: <SwapOutlined />,
    AppstoreAddOutlined: <AppstoreAddOutlined />,
    BarChartOutlined: <BarChartOutlined />,
    FileTextOutlined: <FileTextOutlined />,
    FundProjectionScreenOutlined: <FundProjectionScreenOutlined />,
    RadarChartOutlined: <RadarChartOutlined />,
    DatabaseOutlined: <DatabaseOutlined />,
    CloudDownloadOutlined: <CloudDownloadOutlined />,
    SolutionOutlined: <SolutionOutlined />,
    ClusterOutlined: <ClusterOutlined />,
    BorderOuterOutlined: <BorderOuterOutlined />,
    SafetyCertificateOutlined: <SafetyCertificateOutlined />,
    SettingOutlined: <SettingOutlined />,
    AuditOutlined: <AuditOutlined />,
  };
  return key ? m[key] || <AppstoreOutlined /> : <AppstoreOutlined />;
};
