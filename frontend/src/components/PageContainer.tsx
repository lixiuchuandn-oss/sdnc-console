import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Breadcrumb, Card, Space, Typography, theme, Button, Dropdown, Divider, Table, TableProps, Popover, Checkbox, Tabs } from 'antd';
import { useLocation } from 'react-router-dom';
import { routeSpecs } from '../routes/RouteSpec';
import { HomeOutlined, AppstoreOutlined, DeploymentUnitOutlined, CloudUploadOutlined, DesktopOutlined, TeamOutlined, UserOutlined, UserSwitchOutlined, GatewayOutlined, LockOutlined, ApiOutlined, BranchesOutlined, GlobalOutlined, EnvironmentOutlined, CodeOutlined, ArrowLeftOutlined, ShareAltOutlined, NodeIndexOutlined, SecurityScanOutlined, SwapOutlined, SettingOutlined, EllipsisOutlined, AppstoreAddOutlined, BarChartOutlined, DashboardOutlined, FileTextOutlined, FundProjectionScreenOutlined, RadarChartOutlined, DatabaseOutlined, CloudDownloadOutlined, SolutionOutlined, ClusterOutlined, BorderOuterOutlined, SafetyCertificateOutlined } from '@ant-design/icons';

export const iconOf = (key?: string) => {
  const m: Record<string, React.ReactNode> = {
    AppstoreOutlined: <AppstoreOutlined />,
    DashboardOutlined: <DashboardOutlined />,
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
  };
  return key ? (m[key] || <AppstoreOutlined />) : <AppstoreOutlined />;
};

export interface PageContainerProps<T = any> {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  breadcrumb?: Array<{ label: React.ReactNode; href?: string }>;
  extra?: React.ReactNode;
  children?: React.ReactNode;
  collapsibleChildren?: React.ReactNode;
  bordered?: boolean;
  elevated?: boolean;
  contentPadding?: number | string;
  titleLevel?: 1 | 2 | 3 | 4 | 5;
  subtitle?: React.ReactNode;
  /** 当为 false 时，不使用卡片包裹内容，直接渲染 children */
  asCard?: boolean;
  pagePadding?: number | string;
  /** 隐藏页面头部（标题/副标题/面包屑） */
  hideHeader?: boolean;
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  toolbarGapLeft?: number;
  toolbarGapRight?: number;
  toolbarStyle?: React.CSSProperties;
  toolbarSticky?: boolean;
  primaryAction?: { text: string; onClick: () => void; disabled?: boolean; type?: 'primary' | 'default'; icon?: React.ReactNode };
  secondaryActions?: React.ReactNode;
  moreMenuItems?: Array<{ key: string; label: React.ReactNode; danger?: boolean; disabled?: boolean; onClick?: () => void }>;
  actionsSize?: 'small' | 'middle' | 'large';
  onBack?: () => void;
  /** 标准表格属性，传入此属性将自动渲染标准样式的表格 */
  tableProps?: TableProps<T>;
  /** Tab 列表 */
  tabList?: Array<{ key: string; tab: React.ReactNode }>;
  /** 当前激活的 Tab key */
  tabActiveKey?: string;
  /** Tab 切换回调 */
  onTabChange?: (key: string) => void;
  /** Tab 栏右侧内容 */
  tabBarExtraContent?: React.ReactNode;
  /** 默认隐藏的列 keys */
  defaultHiddenColumns?: string[];
}

const PageContainer = <T extends Record<string, any> = any>({
  title,
  icon,
  breadcrumb,
  extra,
  children,
  collapsibleChildren,
  bordered = true,
  elevated = true,
  contentPadding = 16,
  titleLevel = 4,
  subtitle,
  asCard: propsAsCard,
  pagePadding,
  hideHeader = false,
  toolbarLeft,
  toolbarRight,
  toolbarGapLeft = 8,
  toolbarGapRight = 8,
  toolbarStyle,
  toolbarSticky = false,
  primaryAction,
  secondaryActions,
  moreMenuItems,
  actionsSize = 'middle',
  onBack,
  tableProps,
  tabList,
  tabActiveKey,
  onTabChange,
  tabBarExtraContent,
  defaultHiddenColumns,
}: PageContainerProps<T>) => {
  const loc = useLocation();
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(defaultHiddenColumns || []);

  // 如果使用了 tableProps，默认 asCard 为 false，除非显式设置为 true
  const asCard = propsAsCard !== undefined ? propsAsCard : (tableProps ? false : true);

  const filteredColumns = useMemo(() => {
    if (!tableProps?.columns) return undefined;
    return tableProps.columns.filter((c: any) => {
      const k = String(c.key || c.dataIndex || '');
      return !hiddenColumns.includes(k);
    });
  }, [tableProps?.columns, hiddenColumns]);

  const columnControllerContent = useMemo(() => (
    <div style={{ padding: '4px 0', minWidth: 150 }}>
      <div style={{ marginBottom: 8, padding: '0 12px', fontWeight: 600 }}>列展示</div>
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {tableProps?.columns?.map((c: any, idx) => {
          const k = String(c.key || c.dataIndex || '');
          const title = typeof c.title === 'string' ? c.title : (k || `列 ${idx + 1}`);
          return (
            <div key={k || idx} style={{ padding: '4px 12px' }}>
              <Checkbox
                checked={!hiddenColumns.includes(k)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setHiddenColumns(prev => prev.filter(x => x !== k));
                  } else {
                    setHiddenColumns(prev => [...prev, k]);
                  }
                }}
              >
                {title}
              </Checkbox>
            </div>
          );
        })}
      </div>
    </div>
  ), [tableProps?.columns, hiddenColumns]);

  

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

  const displayTitle = title || currentSpec?.title || currentSpec?.breadcrumbLabel || '';
  const displaySubtitle = subtitle || currentSpec?.subtitle || '';
  const displayIcon = icon || styledIcon(iconOf(currentSpec?.icon), 22, token.colorPrimary);

  const cardStyle: React.CSSProperties = {
    marginBottom: 16,
    borderRadius: 8,
    boxShadow: elevated ? '0 6px 16px rgba(0,0,0,0.08)' : undefined,
    background: '#fff',
  };

  const actionsNode = toolbarRight ?? (
    (primaryAction || (moreMenuItems && moreMenuItems.length > 0) || tableProps || secondaryActions) ? (
      <Space>
        {secondaryActions}
        {primaryAction && (
          <Button
            type={primaryAction.type || 'primary'}
            size={actionsSize}
            icon={primaryAction.icon}
            disabled={primaryAction.disabled}
            onClick={primaryAction.onClick}
          >
            {primaryAction.text}
          </Button>
        )}
        {(moreMenuItems && moreMenuItems.length > 0) && (
          <Dropdown
            menu={{
              items: moreMenuItems.map((m) => ({
                key: m.key,
                label: m.label,
                danger: m.danger,
                disabled: m.disabled,
                onClick: m.onClick ? () => m.onClick?.() : undefined,
              })),
            }}
          >
            <Button size={actionsSize} icon={<EllipsisOutlined />} />
          </Dropdown>
        )}
        {tableProps && (
          <Popover trigger="click" placement="bottomRight" content={columnControllerContent}>
            <Button size={actionsSize} icon={<SettingOutlined />} />
          </Popover>
        )}
      </Space>
    ) : null
  );

  return (
    <div style={{ padding: pagePadding !== undefined ? pagePadding : '24px 36px', maxHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {!hideHeader && (
        <Breadcrumb
          style={{ marginBottom: 12 }}
          items={autoCrumbs.map((item) => ({ title: item.label, href: item.href }))}
        />
      )}

      {/* 页面头部：标题 + 右侧操作，置于卡片外 */}
      {!hideHeader && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Space size={8} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
            {displayIcon}
            <Typography.Title level={titleLevel} style={{ margin: 0, lineHeight: 1, display: 'inline-flex', alignItems: 'center', fontSize: 24 }}>
              {displayTitle}
            </Typography.Title>
          </Space>
          <Space>
            {extra}
            {onBack && <Button icon={<ArrowLeftOutlined />} onClick={onBack} />}
          </Space>
        </div>
      )}

      {!hideHeader && displaySubtitle && (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: tabList ? 12 : 16, cursor: 'pointer' }} onClick={() => setCollapsed(!collapsed)}>
          {displaySubtitle}
        </Typography.Text>
      )}
      {!hideHeader && collapsibleChildren && (
        <div
          style={{
            marginBottom: collapsed ? 0 : 16,
            height: collapsed ? 0 : undefined,
            overflow: collapsed ? 'hidden' : 'visible',
            transition: 'height 200ms ease, opacity 200ms ease, margin 200ms ease',
            opacity: collapsed ? 0 : 1,
          }}
        >
          <div
            ref={(el) => {
              if (!el) return;
              const h = el.scrollHeight;
              const parent = el.parentElement;
              if (!parent) return;
              if (!collapsed) {
                parent.style.height = h ? h + 'px' : 'auto';
              }
            }}
          >
            {collapsibleChildren}
          </div>
        </div>
      )}
      
      {!hideHeader && !tabList && (
        <Divider style={{ margin: '0 0 16px 0' }} />
      )}

      {/* Tabs 如果存在，替换 Divider */}
      {tabList && tabList.length > 0 && (
        <Tabs
          activeKey={tabActiveKey}
          onChange={onTabChange}
          tabBarExtraContent={tabBarExtraContent}
          items={tabList.map(t => ({ key: t.key, label: t.tab }))}
        />
      )}

      {(toolbarLeft || actionsNode) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            marginBottom: 16,
            ...(toolbarSticky ? { position: 'sticky', top: 0, zIndex: 1, background: '#fff' } : {}),
            ...(toolbarStyle || {}),
          }}
        >
          <Space size={toolbarGapLeft} wrap>
            {toolbarLeft}
          </Space>
          <Space size={toolbarGapRight} wrap>
            {actionsNode}
          </Space>
        </div>
      )}

      {/* 内容容器：可选择使用卡片或直接渲染 */}
      {asCard ? (
        <Card variant={bordered ? 'outlined' : 'borderless'} style={cardStyle} styles={{ body: { padding: contentPadding } }}>
          {children}
        </Card>
      ) : (
        <div style={{ margin: 0, flex: 1 }}>
          {tableProps && (
            <Table
              bordered
              size="middle"
              {...tableProps}
              columns={filteredColumns || tableProps.columns}
              pagination={tableProps.pagination !== false ? {
                 size: 'default',
                 showSizeChanger: true,
                 showQuickJumper: true,
                 showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
                 ...(typeof tableProps.pagination === 'object' ? tableProps.pagination : {})
              } : false}
            />
          )}
          {children}
        </div>
      )}
    </div>
  );
};

export default PageContainer;
