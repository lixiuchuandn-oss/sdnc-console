import React, { useMemo } from 'react';
import { Breadcrumb, Card, Space, Typography, theme, Tooltip, Button, Dropdown } from 'antd';
import { useLocation } from 'react-router-dom';
import { routeSpecs } from '../routes/RouteSpec';
import { HomeOutlined, AppstoreOutlined, DeploymentUnitOutlined, CloudUploadOutlined, DesktopOutlined, TeamOutlined, UserOutlined, UserSwitchOutlined, GatewayOutlined, LockOutlined, ApiOutlined, BranchesOutlined, GlobalOutlined, EnvironmentOutlined, UnorderedListOutlined, ArrowLeftOutlined } from '@ant-design/icons';

export interface PageDetailContainerProps {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  actions?: Array<{ key: string; icon: React.ReactNode; onClick?: () => void; loading?: boolean; disabled?: boolean; tooltip?: React.ReactNode }>;
  onBack?: () => void;
  backTooltip?: React.ReactNode;
  moreMenuItems?: Array<{ key: string; label: React.ReactNode }>;
  onMoreMenuClick?: (info: { key: string }) => void;
  moreIcon?: React.ReactNode;
  children?: React.ReactNode;
  bordered?: boolean;
  elevated?: boolean;
  contentPadding?: number | string;
  titleLevel?: 1 | 2 | 3 | 4 | 5;
  asCard?: boolean;
  pagePadding?: number | string;
  hideHeader?: boolean;
  actionsGap?: number | string;
}

const PageDetailContainer: React.FC<PageDetailContainerProps> = ({
  title,
  icon,
  extra,
  actions,
  onBack,
  backTooltip,
  moreMenuItems,
  onMoreMenuClick,
  moreIcon,
  children,
  bordered = true,
  elevated = true,
  contentPadding = 16,
  titleLevel = 4,
  asCard = true,
  pagePadding,
  hideHeader = false,
  actionsGap = 8,
}) => {
  const loc = useLocation();
  const { token } = theme.useToken();

  const iconOf = (key?: string) => {
    const m: Record<string, React.ReactNode> = {
      AppstoreOutlined: <AppstoreOutlined />,
      DeploymentUnitOutlined: <DeploymentUnitOutlined />,
      CloudUploadOutlined: <CloudUploadOutlined />,
      DesktopOutlined: <DesktopOutlined />,
      TeamOutlined: <TeamOutlined />,
      UserOutlined: <UserOutlined />,
      UserSwitchOutlined: <UserSwitchOutlined />,
      GatewayOutlined: <GatewayOutlined />,
      LockOutlined: <LockOutlined />,
      ApiOutlined: <ApiOutlined />,
      BranchesOutlined: <BranchesOutlined />,
      GlobalOutlined: <GlobalOutlined />,
      EnvironmentOutlined: <EnvironmentOutlined />,
    };
    return key ? (m[key] || <AppstoreOutlined />) : <AppstoreOutlined />;
  };

  const styledIcon = (node: React.ReactNode, size: number, color: string) => {
    return React.isValidElement(node)
      ? React.cloneElement(node as any, { style: { ...((node as any).props?.style || {}), fontSize: size, color, display: 'inline-block', verticalAlign: 'middle', lineHeight: 1 } })
      : node;
  };

  const normalize = (p: string) => String(p || '').replace(/\/+$/, '') || '/';
  const pathMatch = (specPath: string, curPath: string) => {
    const a = normalize(specPath);
    const b = normalize(curPath);
    if (a === b) return true;
    const re = new RegExp('^' + a.replace(/:[^/]+/g, '[^/]+') + '$');
    return re.test(b);
  };
  const findSpec = (p: string) => routeSpecs.find(s => pathMatch(s.path, p));
  const currentSpec = useMemo(() => findSpec(loc.pathname), [loc.pathname]);

  const autoCrumbs = useMemo(() => {
    if (!currentSpec) return [{ label: <HomeOutlined />, href: '/' }];
    const lbl = currentSpec.breadcrumbLabel || currentSpec.title || currentSpec.id;
    const parent = currentSpec.parentId ? routeSpecs.find(s => s.id === currentSpec.parentId) : undefined;
    const items: Array<{ label: React.ReactNode; href?: string }> = [
      { label: <HomeOutlined />, href: '/' },
    ];
    if (currentSpec.platform) items.push({ label: currentSpec.platform });
    if (currentSpec.group) items.push({ label: currentSpec.group });
    if (parent) items.push({ label: parent.breadcrumbLabel || parent.title || parent.id, href: parent.path });
    items.push({ label: lbl });
    return items;
  }, [loc.pathname, currentSpec]);

  const displayTitle = title ?? currentSpec?.title ?? currentSpec?.breadcrumbLabel ?? '';
  const displayIcon = styledIcon(icon ?? iconOf(currentSpec?.icon), 22, token.colorPrimary);

  const cardStyle: React.CSSProperties = {
    marginBottom: 16,
    borderRadius: 8,
    boxShadow: elevated ? '0 6px 16px rgba(0,0,0,0.08)' : undefined,
    background: '#fff',
  };

  return (
    <div style={{ padding: pagePadding !== undefined ? pagePadding : '24px 36px' }}>
      {!hideHeader && (
        <Breadcrumb style={{ marginBottom: 12 }} items={autoCrumbs.map((item) => ({ title: item.label, href: item.href }))} />
      )}
      {!hideHeader && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Space size={8} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
            {displayIcon}
            <Typography.Title level={titleLevel} style={{ margin: 0, lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}>
              {displayTitle}
            </Typography.Title>
        </Space>
          <div style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', gap: actionsGap }}>
            {onBack || (Array.isArray(moreMenuItems) && moreMenuItems.length > 0) ? (
              <>
                {onBack && (
                  backTooltip ? (
                    <Tooltip title={backTooltip}>
                      <Button icon={<ArrowLeftOutlined />} onClick={onBack} />
                    </Tooltip>
                  ) : (
                    <Button icon={<ArrowLeftOutlined />} onClick={onBack} />
                  )
                )}
                {(Array.isArray(moreMenuItems) && moreMenuItems.length > 0) && (
                  <Dropdown
                    menu={{ items: moreMenuItems, onClick: ({ key }) => onMoreMenuClick && onMoreMenuClick({ key }) }}
                  >
                    <Button icon={moreIcon || <UnorderedListOutlined />} />
                  </Dropdown>
                )}
              </>
            ) : Array.isArray(actions) && actions.length > 0 ? actions.map(act => {
              const btn = (
                <Button
                  key={act.key}
                  icon={act.icon}
                  onClick={act.onClick}
                  loading={!!act.loading}
                  disabled={!!act.disabled}
                />
              );
              return act.tooltip ? (<Tooltip key={`${act.key}.tt`} title={act.tooltip}>{btn}</Tooltip>) : btn;
            }) : extra}
          </div>
        </div>
      )}
      
      {asCard ? (
        <Card size="small" variant="outlined" bordered={bordered} style={cardStyle} styles={{ body: { padding: contentPadding } }}>
          {children}
        </Card>
      ) : (
        <div style={{ margin: 0 }}>{children}</div>
      )}
    </div>
  );
};

export default PageDetailContainer;
