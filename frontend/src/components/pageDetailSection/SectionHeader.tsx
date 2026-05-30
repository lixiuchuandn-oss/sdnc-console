import React from 'react';
import { Button, Dropdown, Space, Tooltip, Typography } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';
import type { PageDetailSectionProps } from './types';
import { styledSectionIcon } from './normalizeChildren';

type SectionHeaderProps = Pick<
  PageDetailSectionProps,
  | 'title'
  | 'icon'
  | 'extra'
  | 'actions'
  | 'moreMenuItems'
  | 'onMoreMenuClick'
  | 'moreIcon'
  | 'titleLevel'
  | 'showHeaderTitle'
> & {
  displayIcon: React.ReactNode;
};

export function PageDetailSectionHeader({
  title,
  icon,
  extra,
  actions,
  moreMenuItems,
  onMoreMenuClick,
  moreIcon,
  titleLevel = 5,
  showHeaderTitle = false,
  displayIcon,
}: SectionHeaderProps) {
  const showHeader =
    (showHeaderTitle && title) ||
    extra ||
    (Array.isArray(actions) && actions.length > 0) ||
    (Array.isArray(moreMenuItems) && moreMenuItems.length > 0);

  if (!showHeader) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      {showHeaderTitle && title ? (
        <Space size={8} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
          {icon ? displayIcon : null}
          <Typography.Title level={titleLevel} style={{ margin: 0, lineHeight: 1 }}>
            {title}
          </Typography.Title>
        </Space>
      ) : (
        <span />
      )}
      <div style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', gap: 8 }}>
        {Array.isArray(actions) && actions.length > 0
          ? actions.map((act) => {
              const btn = (
                <Button
                  key={act.key}
                  icon={act.icon}
                  onClick={act.onClick}
                  loading={!!act.loading}
                  disabled={!!act.disabled}
                >
                  {act.text}
                </Button>
              );
              return act.tooltip ? (
                <Tooltip key={`${act.key}.tt`} title={act.tooltip}>
                  {btn}
                </Tooltip>
              ) : (
                btn
              );
            })
          : extra}
        {Array.isArray(moreMenuItems) && moreMenuItems.length > 0 && (
          <Dropdown
            menu={{
              items: moreMenuItems.map((m) => ({
                key: m.key,
                label: m.label,
                danger: m.danger,
                disabled: m.disabled,
              })),
              onClick: ({ key }) => {
                const item = (moreMenuItems || []).find((m) => m.key === key);
                if (item?.onClick) {
                  try {
                    item.onClick();
                  } catch {
                    /* ignore */
                  }
                }
                onMoreMenuClick?.({ key });
              },
            }}
          >
            <Button icon={moreIcon || <EllipsisOutlined />} />
          </Dropdown>
        )}
      </div>
    </div>
  );
}

export function buildSectionDisplayIcon(
  icon: React.ReactNode | undefined,
  fallbackIcon: React.ReactNode,
  colorPrimary: string,
) {
  return styledSectionIcon(icon ?? fallbackIcon, 18, colorPrimary);
}
