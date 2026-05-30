import React, { useMemo } from 'react';
import {
  Breadcrumb,
  Button,
  Card,
  Collapse,
  Dropdown,
  Space,
  Tabs,
  theme,
  Tooltip,
  Typography,
} from 'antd';
import { useLocation } from 'react-router-dom';
import { ArrowLeftOutlined, CodeOutlined } from '@ant-design/icons';
import { usePageRouteMeta } from './pageRouteMeta/routeMeta';

export interface PageDetailContainerProps {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  actions?: Array<{
    key: string;
    icon: React.ReactNode;
    onClick?: () => void;
    loading?: boolean;
    disabled?: boolean;
    tooltip?: React.ReactNode;
  }>;
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
  subtitle?: React.ReactNode;
  overviewContent?: React.ReactNode;
  defaultOverviewCollapsed?: boolean;
  tabs?: Array<{
    key: string;
    label: React.ReactNode;
    icon?: React.ReactNode;
    count?: number | React.ReactNode;
    children: React.ReactNode;
  }>;
  activeTabKey?: string;
  defaultActiveTabKey?: string;
  onTabChange?: (key: string) => void;
  tabBarExtraContent?: React.ReactNode;
  breadcrumbs?: Array<{ title: React.ReactNode; href?: string }>;
  rootStyle?: React.CSSProperties;
  contentWrapperStyle?: React.CSSProperties;
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
  subtitle,
  overviewContent,
  defaultOverviewCollapsed = false,
  tabs,
  activeTabKey,
  defaultActiveTabKey,
  onTabChange,
  tabBarExtraContent,
  breadcrumbs,
  rootStyle,
  contentWrapperStyle,
}) => {
  const loc = useLocation();
  const { token } = theme.useToken();

  const { autoCrumbs, displayTitle, displaySubtitle, displayIcon } = usePageRouteMeta(loc.pathname, {
    title,
    icon,
    subtitle,
  });

  const finalBreadcrumbs = useMemo(() => {
    if (breadcrumbs) return breadcrumbs;
    return autoCrumbs.map((item) => ({ title: item.label, href: item.href }));
  }, [breadcrumbs, autoCrumbs]);

  const cardStyle: React.CSSProperties = {
    marginBottom: 16,
    borderRadius: 8,
    boxShadow: elevated ? '0 6px 16px rgba(0,0,0,0.08)' : undefined,
    background: '#fff',
  };

  const rootPad = pagePadding !== undefined ? pagePadding : '24px';

  return (
    <div style={{ padding: rootPad, ...(rootStyle || {}) }}>
      {!hideHeader && <Breadcrumb style={{ marginBottom: 12 }} items={finalBreadcrumbs} />}
      {!hideHeader && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Space size={8} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
            {displayIcon}
            <Typography.Title
              level={titleLevel}
              style={{ margin: 0, lineHeight: 1, display: 'inline-flex', alignItems: 'center', fontSize: 24 }}
            >
              {displayTitle}
            </Typography.Title>
          </Space>
          <div style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', gap: actionsGap }}>
            {onBack || (Array.isArray(moreMenuItems) && moreMenuItems.length > 0) ? (
              <>
                {onBack &&
                  (backTooltip ? (
                    <Tooltip title={backTooltip}>
                      <Button icon={<ArrowLeftOutlined />} onClick={onBack} />
                    </Tooltip>
                  ) : (
                    <Button icon={<ArrowLeftOutlined />} onClick={onBack} />
                  ))}
                {Array.isArray(moreMenuItems) && moreMenuItems.length > 0 && (
                  <Dropdown
                    menu={{
                      items: moreMenuItems,
                      onClick: ({ key }) => onMoreMenuClick && onMoreMenuClick({ key }),
                    }}
                  >
                    <Button icon={moreIcon || <CodeOutlined />} />
                  </Dropdown>
                )}
              </>
            ) : Array.isArray(actions) && actions.length > 0 ? (
              actions.map((act) => {
                const btn = (
                  <Button
                    key={act.key}
                    icon={act.icon}
                    onClick={act.onClick}
                    loading={!!act.loading}
                    disabled={!!act.disabled}
                  />
                );
                return act.tooltip ? (
                  <Tooltip key={`${act.key}.tt`} title={act.tooltip}>
                    {btn}
                  </Tooltip>
                ) : (
                  btn
                );
              })
            ) : (
              extra
            )}
          </div>
        </div>
      )}

      {overviewContent && (
        <div style={{ marginBottom: 10 }}>
          <style>{`.pdc-overview-collapse .ant-collapse-content > .ant-collapse-content-box{padding-top:12px !important;padding-left:0 !important;padding-right:0 !important;padding-bottom:0 !important;background:transparent}.pdc-overview-collapse .ant-collapse-item > .ant-collapse-header{background:transparent !important;padding:0 !important;align-items:center !important}.pdc-overview-collapse .ant-collapse-header-text{flex:none !important}`}</style>
          <Collapse
            className="pdc-overview-collapse"
            ghost
            bordered={false}
            defaultActiveKey={defaultOverviewCollapsed ? [] : ['overview']}
            items={[
              {
                key: 'overview',
                showArrow: false,
                label: displaySubtitle ? (
                  typeof displaySubtitle === 'string' ? (
                    <span style={{ color: token.colorTextSecondary }}>{displaySubtitle}</span>
                  ) : (
                    displaySubtitle
                  )
                ) : (
                  <span style={{ color: token.colorTextSecondary }}>概览</span>
                ),
                children: overviewContent,
              },
            ]}
          />
        </div>
      )}

      {tabs && tabs.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <Tabs
            activeKey={activeTabKey}
            defaultActiveKey={defaultActiveTabKey}
            onChange={onTabChange}
            tabBarExtraContent={tabBarExtraContent}
            items={tabs.map((t) => ({
              key: t.key,
              label: (() => {
                const iconNode = React.isValidElement(t.icon)
                  ? React.cloneElement(t.icon as any, {
                      style: {
                        ...((t.icon as any)?.props?.style || {}),
                        color: 'inherit',
                        marginRight: 4,
                        display: 'inline-flex',
                        alignItems: 'center',
                        lineHeight: 1,
                      },
                    })
                  : t.icon;
                return (
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    {iconNode}
                    <span>{t.label}</span>
                    {t.count !== undefined &&
                      (React.isValidElement(t.count) ? (
                        t.count
                      ) : Number(t.count) > 0 ? (
                        <span style={{ marginLeft: 4, color: 'inherit', fontSize: 12, opacity: 0.8 }}>
                          ({t.count})
                        </span>
                      ) : null)}
                  </span>
                );
              })(),
              children: t.children,
            }))}
          />
          {children}
        </div>
      ) : asCard ? (
        <Card
          size="small"
          variant={bordered ? 'outlined' : 'borderless'}
          style={cardStyle}
          styles={{ body: { padding: contentPadding } }}
        >
          {children}
        </Card>
      ) : (
        <div style={{ margin: 0, ...(contentWrapperStyle || {}) }}>{children}</div>
      )}
    </div>
  );
};

export default PageDetailContainer;
