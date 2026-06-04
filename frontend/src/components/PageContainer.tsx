/**
 * PageContainer — 通用列表/管理页壳层（标题、面包屑、工具栏、表格集成）。
 * 子模块见 `./pageContainer/`。
 */
import React, { useState } from 'react';
import { Breadcrumb, Card, Divider, Space, Table, Tabs, Typography, Button } from 'antd';
import { useLocation } from 'react-router-dom';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { iconOf } from '../utils/iconOf';
import type { PageContainerProps } from './pageContainer/types';
import { usePageRouteMeta } from './pageRouteMeta/routeMeta';
import {
  useColumnControllerContent,
  useFilteredTableColumns,
  usePageContainerToolbarActions,
} from './pageContainer/tableAndToolbar';

export type { PageContainerProps } from './pageContainer/types';
export { iconOf };

const PageContainer = <T extends Record<string, any> = any>({
  title,
  icon,
  breadcrumb,
  extra,
  headerTrailing,
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
  onRefresh,
  tableProps,
  tabList,
  tabActiveKey,
  onTabChange,
  tabBarExtraContent,
  defaultHiddenColumns,
  externalColumnControl,
  hideDivider,
  className,
  style,
}: PageContainerProps<T>) => {
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(defaultHiddenColumns || []);

  const asCard = propsAsCard !== undefined ? propsAsCard : tableProps ? false : true;

  const filteredColumns = useFilteredTableColumns(tableProps, hiddenColumns, externalColumnControl);
  const columnControllerContent = useColumnControllerContent(tableProps, hiddenColumns, setHiddenColumns);

  const { autoCrumbs, displayTitle, displaySubtitle, displayIcon, resolvedTableBordered } =
    usePageRouteMeta(loc.pathname, { title, icon, subtitle, breadcrumb, tableProps });

  const cardStyle: React.CSSProperties = {
    marginBottom: 16,
    borderRadius: 8,
    boxShadow: elevated ? '0 6px 16px rgba(0,0,0,0.08)' : undefined,
    background: '#fff',
  };

  const actionsNode = usePageContainerToolbarActions({
    toolbarRight,
    primaryAction,
    secondaryActions,
    moreMenuItems,
    actionsSize,
    tableProps,
    externalColumnControl,
    columnControllerContent,
    onRefresh,
  });

  return (
    <div
      className={className}
      style={{
        padding: pagePadding !== undefined ? pagePadding : '24px 36px',
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {!hideHeader && autoCrumbs.length > 0 && (
        <Breadcrumb
          style={{ marginBottom: 12 }}
          items={autoCrumbs.map((item) => ({ title: item.label, href: item.href }))}
        />
      )}

      {!hideHeader && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Space size={8} style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 8 }}>
            {displayIcon}
            <Typography.Title
              level={titleLevel}
              style={{
                margin: 0,
                lineHeight: 1,
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: 24,
              }}
            >
              {displayTitle}
            </Typography.Title>
            {headerTrailing}
          </Space>
          <Space>
            {extra}
            {onBack && (
              <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
                返回
              </Button>
            )}
          </Space>
        </div>
      )}

      {!hideHeader && displaySubtitle && (
        <Typography.Text
          type="secondary"
          style={{
            display: 'block',
            marginBottom: tabList ? 12 : 16,
            cursor: 'pointer',
          }}
          onClick={() => setCollapsed(!collapsed)}
        >
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

      {!hideHeader && !tabList && !hideDivider && <Divider style={{ margin: '0 0 16px 0' }} />}

      {tabList && tabList.length > 0 && (
        <Tabs
          className="page-container-tab-bar-only"
          activeKey={tabActiveKey}
          onChange={onTabChange}
          tabBarExtraContent={tabBarExtraContent}
          items={tabList.map((t) => ({ key: t.key, label: t.tab }))}
        />
      )}

      {(toolbarLeft || actionsNode) && (
        <div
          className="page-container-toolbar"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-start',
            marginBottom: 16,
            ...(toolbarSticky ? { position: 'sticky', top: 0, zIndex: 1, background: '#fff' } : {}),
            ...(toolbarStyle || {}),
          }}
        >
          <Space size={toolbarGapLeft} wrap style={{ minWidth: 0 }}>
            {toolbarLeft}
          </Space>
          <Space size={toolbarGapRight} wrap style={{ marginLeft: 'auto' }}>
            {actionsNode}
          </Space>
        </div>
      )}

      {asCard ? (
        <Card
          variant={bordered ? 'outlined' : 'borderless'}
          style={cardStyle}
          styles={{ body: { padding: contentPadding } }}
        >
          {children}
        </Card>
      ) : (
        <div style={{ margin: 0, flex: 1 }}>
          {tableProps && (
            <Table
              {...tableProps}
              bordered={resolvedTableBordered}
              className={`page-container-table ${tableProps.className || ''}`}
              columns={filteredColumns || tableProps.columns}
              pagination={
                tableProps.pagination !== false
                  ? {
                      size: 'default',
                      showSizeChanger: true,
                      showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
                      ...(typeof tableProps.pagination === 'object' ? tableProps.pagination : {}),
                      showQuickJumper: false,
                    }
                  : false
              }
            />
          )}
          {children}
        </div>
      )}
    </div>
  );
};

export default PageContainer;
