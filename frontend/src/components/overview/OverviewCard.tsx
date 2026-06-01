import React from 'react';
import { Card } from 'antd';
import './overview.css';

type Props = {
  /** 标题文本；不传则不渲染标题区 */
  title?: React.ReactNode;
  /** 标题区图标（已渲染节点） */
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  /** 提供后整卡可点击（含键盘可达性） */
  onClick?: () => void;
  children: React.ReactNode;
};

/** 概览类界面统一卡片外壳（标题区图标槽 + 统一阴影/圆角） */
const OverviewCard: React.FC<Props> = ({
  title,
  icon,
  extra,
  className,
  style,
  bodyStyle,
  onClick,
  children,
}) => (
  <Card
    size="small"
    className={`overview-card${className ? ` ${className}` : ''}`}
    title={
      title != null ? (
        <span className="overview-card-title">
          {icon ? (
            <span className="overview-card-title-icon">{icon}</span>
          ) : null}
          <span className="overview-card-title-text">{title}</span>
        </span>
      ) : undefined
    }
    extra={extra}
    style={{ ...(onClick ? { cursor: 'pointer' } : null), ...style }}
    styles={bodyStyle ? { body: bodyStyle } : undefined}
    onClick={onClick}
    onKeyDown={
      onClick
        ? (e) => {
            if (e.key === 'Enter') onClick();
          }
        : undefined
    }
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
  >
    {children}
  </Card>
);

export default OverviewCard;
