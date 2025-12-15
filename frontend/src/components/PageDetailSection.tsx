import React from 'react';
import { Card, Space, Typography, theme, Button, Dropdown, Tooltip } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';
import SharedToolbar from './SharedToolbar';
import { AppstoreOutlined } from '@ant-design/icons';

export type PageDetailSectionProps = {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  actions?: Array<{ key: string; icon?: React.ReactNode; text?: React.ReactNode; onClick?: () => void; loading?: boolean; disabled?: boolean; tooltip?: React.ReactNode }>;
  moreMenuItems?: Array<{ key: string; label: React.ReactNode; danger?: boolean; disabled?: boolean; onClick?: () => void }>;
  onMoreMenuClick?: (info: { key: string }) => void;
  moreIcon?: React.ReactNode;
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  toolbarGapLeft?: number;
  toolbarGapRight?: number;
  toolbarStyle?: React.CSSProperties;
  children?: React.ReactNode;
  bordered?: boolean;
  elevated?: boolean;
  contentPadding?: number | string;
  titleLevel?: 1 | 2 | 3 | 4 | 5;
  asCard?: boolean;
  style?: React.CSSProperties;
  autoStyleInputs?: boolean;
  keywordWidth?: number;
  selectWidth?: number;
  inputSize?: 'small' | 'middle' | 'large';
};

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
  autoStyleInputs = true,
  keywordWidth = 240,
  selectWidth = 200,
  inputSize = 'middle',
}) => {
  const { token } = theme.useToken();
  const styledIcon = (node: React.ReactNode, size: number, color: string) => {
    return React.isValidElement(node)
      ? React.cloneElement(node as any, { style: { ...((node as any).props?.style || {}), fontSize: size, color, display: 'inline-block', verticalAlign: 'middle', lineHeight: 1 } })
      : node;
  };
  const displayIcon = styledIcon(icon ?? <AppstoreOutlined />, 18, token.colorPrimary);

  const cardStyle: React.CSSProperties = {
    marginBottom: 16,
    borderRadius: 8,
    boxShadow: elevated ? '0 6px 16px rgba(0,0,0,0.08)' : undefined,
    background: '#fff',
  };

  const normalizeNode = (node: React.ReactNode): React.ReactNode => {
    if (!React.isValidElement(node)) return node;
    const anyType: any = (node as any).type;
    const name = String(anyType?.displayName || anyType?.name || '').toLowerCase();
    const props: any = (node as any).props || {};
    const style: React.CSSProperties = props.style || {};
    const nextProps: any = { ...props };
    const hasWidth = style && (style as any).width !== undefined;
    const setWidth = (w: number) => { if (!hasWidth) nextProps.style = { ...style, width: w }; };
    const setSize = () => { if (props.size === undefined) nextProps.size = inputSize; };
    const ph = String(props.placeholder || '').toLowerCase();
    const isKeywordInput = name === 'search' || (name === 'input' && (ph.includes('关键字') || ph.includes('搜索') || ph.includes('keyword')));
    if (isKeywordInput) {
      setWidth(keywordWidth);
      setSize();
      if (nextProps.allowClear === undefined) nextProps.allowClear = true;
      if (name === 'search' && nextProps.enterButton !== undefined) nextProps.enterButton = false;
    }
    else if (name === 'select') { setWidth(selectWidth); setSize(); }
    if (props.children) {
      const origArr = React.Children.toArray(props.children);
      const newArr = origArr.map((child) => normalizeNode(child));
      nextProps.children = (origArr.length === 1) ? (newArr[0] as any) : newArr;
    }
    return React.cloneElement(node as any, nextProps);
  };
  const normalizeChildren = (children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children as any, normalizeNode);
  };

  const header = (title || extra || (Array.isArray(actions) && actions.length > 0) || (Array.isArray(moreMenuItems) && moreMenuItems.length > 0)) ? (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <Space size={8} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
        {icon ? displayIcon : null}
        {title ? (<Typography.Title level={titleLevel} style={{ margin: 0, lineHeight: 1 }}>{title}</Typography.Title>) : null}
      </Space>
      <div style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', gap: 8 }}>
        {Array.isArray(actions) && actions.length > 0 ? actions.map(act => {
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
          return act.tooltip ? (<Tooltip key={`${act.key}.tt`} title={act.tooltip}>{btn}</Tooltip>) : btn;
        }) : extra}
        {(Array.isArray(moreMenuItems) && moreMenuItems.length > 0) && (
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
                if (item && item.onClick) { try { item.onClick(); } catch {} }
                if (onMoreMenuClick) onMoreMenuClick({ key });
              },
            }}
          >
            <Button icon={moreIcon || <EllipsisOutlined />} />
          </Dropdown>
        )}
      </div>
    </div>
  ) : null;

  const leftContent = autoStyleInputs && toolbarLeft ? normalizeChildren(toolbarLeft) : toolbarLeft;
  const rightContent = autoStyleInputs && toolbarRight ? normalizeChildren(toolbarRight) : toolbarRight;
  const toolbar = (leftContent || rightContent) ? (
    <SharedToolbar left={leftContent} right={rightContent} leftGap={toolbarGapLeft} rightGap={toolbarGapRight} style={toolbarStyle} />
  ) : null;

  const content = asCard ? (
    <Card size="small" variant="outlined" bordered={bordered} style={cardStyle} styles={{ body: { padding: contentPadding } }}>
      {children}
    </Card>
  ) : (
    <div style={{ margin: 0 }}>{children}</div>
  );

  return (
    <div style={{ ...style }}>
      {header}
      {toolbar}
      {content}
    </div>
  );
};

export default PageDetailSection;
