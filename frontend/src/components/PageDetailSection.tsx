import React from 'react';
import { Card, Space, Typography, theme, Button, Dropdown, Tooltip, Switch } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';
import SharedToolbarComponent, { ColumnOption } from './SharedToolbar';
import { AppstoreOutlined } from '@ant-design/icons';

/**
 * PageDetailSection 组件属性定义
 * 用于定义详情页面的各个分块区域（Section）
 */
export type PageDetailSectionProps = {
  /** 区域标题 */
  title?: React.ReactNode;
  /** 标题前的图标 */
  icon?: React.ReactNode;
  /** 
   * 标题右侧的额外内容（通常用于简单的操作按钮）
   * 如果提供了 actions，extra 会被 actions 替代
   */
  extra?: React.ReactNode;
  /** 
   * 标题右侧的操作按钮列表
   * 会自动渲染为一组按钮，支持 loading、disabled 和 tooltip
   */
  actions?: Array<{ 
    key: string; 
    icon?: React.ReactNode; 
    text?: React.ReactNode; 
    onClick?: () => void; 
    loading?: boolean; 
    disabled?: boolean; 
    tooltip?: React.ReactNode 
  }>;
  /** 
   * 更多菜单项（下拉菜单）
   * 会在操作按钮右侧显示一个 "..." 按钮
   */
  moreMenuItems?: Array<{ 
    key: string; 
    label: React.ReactNode; 
    danger?: boolean; 
    disabled?: boolean; 
    onClick?: () => void 
  }>;
  /** 更多菜单点击回调 */
  onMoreMenuClick?: (info: { key: string }) => void;
  /** 自定义更多菜单的图标，默认为 EllipsisOutlined */
  moreIcon?: React.ReactNode;
  
  /** 
   * 工具栏左侧内容
   * 通常放置搜索框、筛选器等
   */
  toolbarLeft?: React.ReactNode;
  /** 
   * 工具栏右侧内容
   * 通常放置刷新按钮、列配置等
   */
  toolbarRight?: React.ReactNode;
  /** 工具栏左侧间距，默认 8 */
  toolbarGapLeft?: number;
  /** 工具栏右侧间距，默认 8 */
  toolbarGapRight?: number;
  /** 工具栏样式 */
  toolbarStyle?: React.CSSProperties;
  
  /** 
   * 区域主要内容
   * 通常是表格、表单或描述列表
   */
  children?: React.ReactNode;
  
  /** 是否显示边框（当 asCard=true 时生效），默认 true */
  bordered?: boolean;
  /** 是否显示阴影（当 asCard=true 时生效），默认 false */
  elevated?: boolean;
  /** 内容区域内边距，默认 0 */
  contentPadding?: number | string;
  /** 标题级别 (h1-h5)，默认 5 */
  titleLevel?: 1 | 2 | 3 | 4 | 5;
  /** 是否作为 Antd Card 组件渲染，默认 false */
  asCard?: boolean;
  /** 容器样式 */
  style?: React.CSSProperties;
  /** 主内容区容器样式（非 asCard 时为包裹 children 的 div；asCard 时合并到 Card body） */
  contentStyle?: React.CSSProperties;
  
  /** 
   * 是否自动样式化输入框和表格
   * 如果为 true，会自动统一 Input/Select 的宽度和 Table 的样式
   * 默认 true
   */
  autoStyleInputs?: boolean;
  /** 搜索框/关键字输入框的宽度，默认 240 */
  keywordWidth?: number;
  /** 下拉选择框的宽度，默认 200 */
  selectWidth?: number;
  /** 输入控件的尺寸，默认 'middle' */
  inputSize?: 'small' | 'middle' | 'large';
  /** 是否显示头部标题区域，默认 false（通常只有在有 actions 或明确要求显示标题时才开启） */
  showHeaderTitle?: boolean;

  // --- 新增 SharedToolbar 相关属性 ---
  /** 刷新回调函数，如果存在，会显示刷新按钮 */
  onRefresh?: (force?: boolean) => void;
  /** 刷新按钮的 loading 状态 */
  refreshLoading?: boolean;
  /** 
   * 列配置选项
   * 用于控制表格列的显示/隐藏
   */
  columnsConfig?: {
    value: string[]; // 当前选中的列 key
    options: ColumnOption[]; // 所有可用列选项
    onChange: (values: string[]) => void; // 变更回调
    tooltip?: React.ReactNode; // 按钮提示
  };
  /** 
   * 主要操作按钮（高亮显示）
   * 通常用于 "创建" 或 "添加" 动作
   */
  primaryAction?: {
    label: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
    danger?: boolean;
    tooltip?: React.ReactNode;
  };
  /** 
   * 批量操作菜单
   * 当选中表格行时启用的批量操作
   */
  batchActions?: {
    items: any[]; // 菜单项配置
    onMenuClick?: (key: string) => void;
    disabled?: boolean;
    tooltip?: React.ReactNode;
  };
};

/**
 * PageDetailSection
 * 
 * 详情页面的通用区块组件。
 * 封装了统一的标题样式、操作栏布局、工具栏布局以及内容容器。
 * 提供了自动样式化子组件（如 Input, Select, Table）的能力，保持 UI 一致性。
 */
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

  // 辅助函数：为图标添加统一的样式（大小、颜色、对齐）
  const styledIcon = (node: React.ReactNode, size: number, color: string) => {
    return React.isValidElement(node)
      ? React.cloneElement(node as any, { style: { ...((node as any).props?.style || {}), fontSize: size, color, display: 'inline-block', verticalAlign: 'middle', lineHeight: 1 } })
      : node;
  };
  const displayIcon = styledIcon(icon ?? <AppstoreOutlined />, 18, token.colorPrimary);

  // Card 容器样式
  const cardStyle: React.CSSProperties = {
    marginBottom: 16,
    borderRadius: 8,
    boxShadow: elevated ? '0 6px 16px rgba(0,0,0,0.08)' : undefined, // 浮起效果
    background: '#fff',
  };

  /**
   * 核心逻辑：标准化 React 节点
   * 自动处理 Input, Search, Select, Table 等组件的样式和属性
   * 确保整个应用中这些组件的宽度、尺寸和风格一致
   */
  const normalizeNode = (node: React.ReactNode): React.ReactNode => {
    if (!React.isValidElement(node)) return node;
    const anyType: any = (node as any).type;
    // 获取组件名称，转小写用于匹配
    const name = String(anyType?.displayName || anyType?.name || '').toLowerCase();
    const props: any = (node as any).props || {};
    const style: React.CSSProperties = props.style || {};
    const nextProps: any = { ...props };
    
    // 辅助：设置宽度
    const hasWidth = style && (style as any).width !== undefined;
    const setWidth = (w: number) => { if (!hasWidth) nextProps.style = { ...style, width: w }; };
    
    // 辅助：设置尺寸
    const setSize = () => { if (props.size === undefined) nextProps.size = inputSize; };
    
    // 识别是否为关键字搜索框
    const ph = String(props.placeholder || '').toLowerCase();
    const isKeywordInput = name === 'search' || (name === 'input' && (ph.includes('关键字') || ph.includes('搜索') || ph.includes('keyword')));
    
    if (isKeywordInput) {
      setWidth(keywordWidth);
      setSize();
      if (nextProps.allowClear === undefined) nextProps.allowClear = true;
      // 搜索框默认不显示巨大的搜索按钮，保持简洁
      if (name === 'search' && nextProps.enterButton !== undefined) nextProps.enterButton = false;
    }
    else if (name === 'select') { 
      setWidth(selectWidth); 
      setSize(); 
    }
    
    // 自动处理表格样式
    if (name.includes('table')) {
      if (nextProps.size === undefined) nextProps.size = 'middle';
      if (nextProps.bordered === undefined) nextProps.bordered = true;
      if (nextProps.tableLayout === undefined) nextProps.tableLayout = 'auto';
      
      // 添加自定义 CSS 类 vr-table 以支持特定样式覆盖
      const cls: string = String(props.className || '').trim();
      const wantMiddle = String(nextProps.size || '').toLowerCase() !== 'small';
      const classes = [cls, wantMiddle ? 'vr-table vr-table--middle' : ''].filter(Boolean).join(' ');
      nextProps.className = classes;
    }
    
    if (props.children !== undefined) {
      const c = props.children as any;
      if (typeof c === 'function') {
        nextProps.children = c;
      } else if (Array.isArray(c)) {
        nextProps.children = React.Children.map(c, (child: any) => normalizeNode(child));
      } else {
        nextProps.children = normalizeNode(c);
      }
    }
    return React.cloneElement(node as any, nextProps);
  };

  // 对所有子元素应用标准化处理
  const normalizeChildren = (children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children as any, normalizeNode);
  };

  // --- 渲染头部区域 (Header) ---
  // 当需要显示标题、有操作按钮或更多菜单时渲染
  const header = ((showHeaderTitle && title) || extra || (Array.isArray(actions) && actions.length > 0) || (Array.isArray(moreMenuItems) && moreMenuItems.length > 0)) ? (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      {/* 标题部分 */}
      {showHeaderTitle && title ? (
        <Space size={8} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
          {icon ? displayIcon : null}
          <Typography.Title level={titleLevel} style={{ margin: 0, lineHeight: 1 }}>{title}</Typography.Title>
        </Space>
      ) : <span />}
      
      {/* 操作按钮部分 */}
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
        
        {/* 更多下拉菜单 */}
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

  // 标准化工具栏内容
  const leftContent = autoStyleInputs && toolbarLeft ? normalizeChildren(toolbarLeft) : toolbarLeft;
  const rightContent = autoStyleInputs && toolbarRight ? normalizeChildren(toolbarRight) : toolbarRight;
  
  const hasToolbar = leftContent || rightContent || onRefresh || columnsConfig || primaryAction || batchActions;
  
  // --- 渲染工具栏 (Toolbar) ---
  const toolbar = hasToolbar ? (
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
  ) : null;

  // 标准化主要内容
  const contentChildren = autoStyleInputs && children ? normalizeChildren(children) : children;
  
  // --- 渲染内容区域 (Content) ---
  const content = asCard ? (
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

/**
 * 实时刷新开关组件
 * 简单封装了 Switch 和文本标签
 */
export const LiveSwitch: React.FC<{ checked?: boolean; onChange?: (v: boolean) => void; label?: React.ReactNode }> = ({ checked, onChange, label }) => {
  const containerStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid #d9d9d9',
    borderRadius: 6,
    height: 32,
    padding: '0 10px',
  };

  const labelStyle: React.CSSProperties = {
    marginLeft: 8,
    color: '#555',
  };

  return (
    <span style={containerStyle}>
      <Switch 
        size="small" 
        checked={!!checked} 
        onChange={() => onChange && onChange(!checked)} 
      />
      <span style={labelStyle}>
        {label ?? '实时刷新'}
      </span>
    </span>
  );
};

/**
 * 表格行操作按钮组件
 * 封装了 Dropdown 和 "..." 按钮，用于表格行的更多操作
 */
export const RowActionsButton: React.FC<{ items: any[]; onClick?: (info: { key: string }) => void; buttonProps?: any }> = ({ items, onClick, buttonProps }) => {
  return (
    <Dropdown
      menu={{
        items,
        onClick: ({ key }) => {
          if (onClick) onClick({ key });
        },
      }}
    >
      <Button type="link" icon={<EllipsisOutlined />} {...buttonProps} />
    </Dropdown>
  );
};
