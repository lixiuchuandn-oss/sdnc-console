import React, { useMemo } from 'react';
import { AppstoreOutlined } from '@ant-design/icons';
import { Card, theme } from 'antd';
import SharedToolbarComponent from '../SharedToolbar';
import { createChildNormalizer } from './normalizeChildren';
import { buildSectionDisplayIcon, PageDetailSectionHeader } from './SectionHeader';
import type { PageDetailSectionProps } from './types';

export type { PageDetailSectionProps } from './types';
export { LiveSwitch, RowActionsButton } from './extras';

const PageDetailSection: React.FC<PageDetailSectionProps> = ({
  title,
  icon,
  extra,
  actions,
  moreMenuItems,
  onMoreMenuClick,
  moreIcon,
  toolbarLeft,
  toolbarRight,
  toolbarGapLeft = 8,
  toolbarGapRight = 8,
  toolbarStyle,
  children,
  bordered = true,
  elevated = false,
  contentPadding = 0,
  titleLevel = 5,
  asCard = false,
  style,
  contentStyle,
  autoStyleInputs = true,
  keywordWidth = 240,
  selectWidth = 200,
  inputSize = 'middle',
  showHeaderTitle = false,
  onRefresh,
  refreshLoading,
  columnsConfig,
  primaryAction,
  batchActions,
}) => {
  const { token } = theme.useToken();

  const displayIcon = buildSectionDisplayIcon(icon, <AppstoreOutlined />, token.colorPrimary);

  const normalizeChildren = useMemo(
    () =>
      createChildNormalizer({
        autoStyleInputs,
        keywordWidth,
        selectWidth,
        inputSize,
      }),
    [autoStyleInputs, keywordWidth, selectWidth, inputSize],
  );

  const cardStyle: React.CSSProperties = {
    marginBottom: 16,
    borderRadius: 8,
    boxShadow: elevated ? '0 6px 16px rgba(0,0,0,0.08)' : undefined,
    background: '#fff',
  };

  const leftContent = autoStyleInputs && toolbarLeft ? normalizeChildren(toolbarLeft) : toolbarLeft;
  const rightContent = autoStyleInputs && toolbarRight ? normalizeChildren(toolbarRight) : toolbarRight;
  const hasToolbar =
    leftContent || rightContent || onRefresh || columnsConfig || primaryAction || batchActions;

  const contentChildren = autoStyleInputs && children ? normalizeChildren(children) : children;

  return (
    <div style={{ ...style }}>
      <PageDetailSectionHeader
        title={title}
        icon={icon}
        extra={extra}
        actions={actions}
        moreMenuItems={moreMenuItems}
        onMoreMenuClick={onMoreMenuClick}
        moreIcon={moreIcon}
        titleLevel={titleLevel}
        showHeaderTitle={showHeaderTitle}
        displayIcon={displayIcon}
      />
      {hasToolbar && (
        <SharedToolbarComponent
          left={leftContent}
          right={rightContent}
          leftGap={toolbarGapLeft}
          rightGap={toolbarGapRight}
          style={toolbarStyle}
          onRefresh={onRefresh}
          refreshLoading={refreshLoading}
          columnsConfig={columnsConfig}
          primaryAction={primaryAction}
          batchActions={batchActions}
        />
      )}
      {asCard ? (
        <Card
          size="small"
          variant={bordered ? 'outlined' : 'borderless'}
          style={cardStyle}
          styles={{ body: { padding: contentPadding, ...(contentStyle || {}) } }}
        >
          {contentChildren}
        </Card>
      ) : (
        <div style={{ margin: 0, ...(contentStyle || {}) }}>{contentChildren}</div>
      )}
    </div>
  );
};

export default PageDetailSection;
