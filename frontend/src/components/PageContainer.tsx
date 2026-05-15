/**
 * ============================================================================
 * PageContainer 组件 - 页面容器组件
 * ============================================================================
 * 
 * 【功能概述】
 * 这是一个通用的页面容器组件，为整个应用提供统一的页面布局和结构。
 * 它负责：
 * 1. 页面头部（标题、图标、面包屑导航）
 * 2. 工具栏（左侧工具栏、右侧操作按钮）
 * 3. 内容区域（支持卡片模式或直接渲染）
 * 4. 表格集成（自动渲染标准样式的表格）
 * 5. Tab 标签页支持
 * 6. 列控制器（表格列显示/隐藏控制）
 * 
 * 【主要特性】
 * - 自动生成面包屑导航（基于路由配置）
 * - 支持自定义标题、图标、副标题
 * - 支持工具栏和操作按钮
 * - 支持表格自动渲染和列控制
 * - 支持 Tab 标签页
 * - 支持卡片模式或直接渲染模式
 * - 支持可折叠的额外内容区域
 * 
 * 【使用示例】
 * ```tsx
 * <PageContainer
 *   title="用户管理"
 *   icon={<UserOutlined />}
 *   primaryAction={{ text: '新增用户', onClick: handleAdd }}
 *   onRefresh={handleRefresh}
 * >
 *   <UserList />
 * </PageContainer>
 * ```
 * ============================================================================
 */

import React, { useMemo, useState } from 'react';
import { Breadcrumb, Card, Space, Typography, theme, Button, Dropdown, Divider, Table, TableProps, Popover, Checkbox, Tabs } from 'antd';
import { useLocation } from 'react-router-dom';
import { routeSpecs } from '../routes/RouteSpec';
import { isSdnccPagePath } from '../routes/adminRouteMatch';
import { HomeOutlined, AppstoreOutlined, DeploymentUnitOutlined, CloudUploadOutlined, DesktopOutlined, TeamOutlined, UserOutlined, UserSwitchOutlined, GatewayOutlined, LockOutlined, ApiOutlined, BranchesOutlined, GlobalOutlined, EnvironmentOutlined, CodeOutlined, ArrowLeftOutlined, ShareAltOutlined, NodeIndexOutlined, SecurityScanOutlined, SwapOutlined, SettingOutlined, EllipsisOutlined, AppstoreAddOutlined, BarChartOutlined, DashboardOutlined, FileTextOutlined, FundProjectionScreenOutlined, RadarChartOutlined, DatabaseOutlined, CloudDownloadOutlined, SolutionOutlined, ClusterOutlined, BorderOuterOutlined, SafetyCertificateOutlined, ReloadOutlined, AuditOutlined, RocketOutlined } from '@ant-design/icons';

/**
 * 图标映射函数
 * 根据图标名称字符串返回对应的 Ant Design 图标组件
 * 
 * @param key - 图标名称（如 'AppstoreOutlined'）
 * @returns React 图标组件，如果未找到则返回默认图标 AppstoreOutlined
 * 
 * 【使用场景】
 * - 从路由配置中读取图标名称并转换为实际图标组件
 * - 支持动态图标渲染
 */
export const iconOf = (key?: string) => {
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
  return key ? (m[key] || <AppstoreOutlined />) : <AppstoreOutlined />;
};

/**
 * PageContainer 组件的属性接口
 * 
 * @template T - 表格数据类型（当使用 tableProps 时）
 */
export interface PageContainerProps<T = any> {
  /** 自定义 CSS 类名 */
  className?: string;
  /** 自定义样式对象 */
  style?: React.CSSProperties;
  
  // ========== 页面头部相关 ==========
  /** 页面标题（如果未提供，将从路由配置中自动获取） */
  title?: React.ReactNode;
  /** 页面图标（如果未提供，将从路由配置中自动获取） */
  icon?: React.ReactNode;
  /** 自定义面包屑导航（如果未提供，将根据路由配置自动生成） */
  breadcrumb?: Array<{ label: React.ReactNode; href?: string }>;
  /** 标题右侧额外内容 */
  extra?: React.ReactNode;
  /**
   * 标题行内、主标题之后的内容（与图标、主标题同一行）。
   * 用于可用区/资源池等筛选，避免占用 toolbar 单独换行。
   */
  headerTrailing?: React.ReactNode;
  /** 页面副标题（如果未提供，将从路由配置中自动获取） */
  subtitle?: React.ReactNode;
  /** 标题级别（h1-h5），默认 4 */
  titleLevel?: 1 | 2 | 3 | 4 | 5;
  /** 隐藏页面头部（标题/副标题/面包屑） */
  hideHeader?: boolean;
  /** 返回按钮点击回调 */
  onBack?: () => void;
  
  // ========== 内容区域相关 ==========
  /** 页面主要内容 */
  children?: React.ReactNode;
  /** 可折叠的额外内容区域（显示在副标题下方） */
  collapsibleChildren?: React.ReactNode;
  /** 当为 false 时，不使用卡片包裹内容，直接渲染 children */
  asCard?: boolean;
  /** 页面内边距，默认 '24px 36px' */
  pagePadding?: number | string;
  /** 内容区域内边距（当使用卡片模式时），默认 16 */
  contentPadding?: number | string;
  /** 卡片边框样式，默认 true（使用 'outlined'） */
  bordered?: boolean;
  /** 卡片阴影效果，默认 true */
  elevated?: boolean;
  
  // ========== 工具栏相关 ==========
  /** 工具栏左侧内容 */
  toolbarLeft?: React.ReactNode;
  /** 工具栏右侧内容（如果未提供，将根据其他属性自动生成） */
  toolbarRight?: React.ReactNode;
  /** 工具栏左侧元素间距，默认 8 */
  toolbarGapLeft?: number;
  /** 工具栏右侧元素间距，默认 8 */
  toolbarGapRight?: number;
  /** 工具栏自定义样式 */
  toolbarStyle?: React.CSSProperties;
  /** 工具栏是否固定（sticky），默认 false */
  toolbarSticky?: boolean;
  
  // ========== 操作按钮相关 ==========
  /** 主要操作按钮配置 */
  primaryAction?: { 
    text: string; 
    onClick: () => void; 
    disabled?: boolean; 
    type?: 'primary' | 'default'; 
    icon?: React.ReactNode 
  };
  /** 次要操作按钮（显示在主要操作按钮左侧） */
  secondaryActions?: React.ReactNode;
  /** 更多操作菜单项（将显示为下拉菜单） */
  moreMenuItems?: Array<{ 
    key: string; 
    label: React.ReactNode; 
    danger?: boolean; 
    disabled?: boolean; 
    onClick?: () => void 
  }>;
  /** 操作按钮尺寸，默认 'middle' */
  actionsSize?: 'small' | 'middle' | 'large';
  /** 刷新操作回调（将显示刷新按钮）；点击时始终传入 `true` 作为第一参，与 `PageDetailSection`/`SharedToolbar` 一致，便于与「强制拉列表」约定对齐；无参包装函数会忽略该实参。 */
  onRefresh?: (force?: boolean) => void;
  
  // ========== 表格相关 ==========
  /** 标准表格属性，传入此属性将自动渲染标准样式的表格 */
  tableProps?: TableProps<T>;
  /** 默认隐藏的列 keys（用于表格列控制器） */
  defaultHiddenColumns?: string[];
  /**
   * 为 true 时：表格列完全由外部传入（如 useTableColumnSettings 的 displayColumns），
   * 不再走内置「列展示」过滤与去 width 逻辑，且不显示齿轮列设置按钮。
   */
  externalColumnControl?: boolean;

  // ========== Tab 标签页相关 ==========
  /** Tab 列表 */
  tabList?: Array<{ key: string; tab: React.ReactNode }>;
  /** 当前激活的 Tab key */
  tabActiveKey?: string;
  /** Tab 切换回调 */
  onTabChange?: (key: string) => void;
  /** Tab 栏右侧内容 */
  tabBarExtraContent?: React.ReactNode;
  
  // ========== 其他 ==========
  /** 强制隐藏分隔线（标题下方的分隔线） */
  hideDivider?: boolean;
}

/**
 * PageContainer 组件主函数
 * 
 * @template T - 表格数据类型
 * @param props - 组件属性
 * @returns React 组件
 */
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
  // ============================================================================
  // 【Hooks 和状态管理】
  // ============================================================================
  const loc = useLocation(); // 获取当前路由位置
  const { token } = theme.useToken(); // 获取 Ant Design 主题 token
  const [collapsed, setCollapsed] = useState(false); // 可折叠内容区域的展开/收起状态
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(defaultHiddenColumns || []); // 表格隐藏列的 keys

  // ============================================================================
  // 【计算属性】
  // ============================================================================
  
  /**
   * 确定是否使用卡片模式
   * - 如果显式设置了 propsAsCard，使用该值
   * - 如果使用了 tableProps，默认不使用卡片（表格需要全宽显示）
   * - 否则默认使用卡片模式
   */
  const asCard = propsAsCard !== undefined ? propsAsCard : (tableProps ? false : true);

  /**
   * 过滤后的表格列（排除隐藏的列）
   * 
   * 【处理逻辑】
   * 1. 根据 hiddenColumns 过滤掉隐藏的列
   * 2. 移除所有列的 width 属性（符合设计规范：禁止添加列宽）
   * 
   * 【依赖】
   * - tableProps?.columns: 原始列配置
   * - hiddenColumns: 隐藏列的 keys
   */
  const filteredColumns = useMemo(() => {
    if (!tableProps?.columns) return undefined;
    if (externalColumnControl) {
      return tableProps.columns;
    }
    return tableProps.columns
      .filter((c: any) => {
        const k = String(c.key || c.dataIndex || '');
        return !hiddenColumns.includes(k);
      })
      .map((c: any) => {
        // 强制移除列宽，符合设计规范 "禁止添加列宽"
        const { width, ...rest } = c;
        return rest;
      });
  }, [tableProps?.columns, hiddenColumns, externalColumnControl]);

  /**
   * 列控制器弹窗内容
   * 
   * 【功能】
   * - 显示所有可用的表格列
   * - 通过复选框控制列的显示/隐藏
   * - 支持滚动（当列数较多时）
   * 
   * 【布局】
   * - 标题："列展示"
   * - 内容：复选框列表，支持换行显示
   * - 最大高度：300px，超出可滚动
   */
  const columnControllerContent = useMemo(() => (
    <div style={{ padding: '4px 0', width: 500 }}>
      <div style={{ marginBottom: 8, padding: '0 12px', fontWeight: 600 }}>列展示</div>
      <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 12px' }}>
        {tableProps?.columns?.map((c: any, idx) => {
          const k = String(c.key || c.dataIndex || '');
          const title = typeof c.title === 'string' ? c.title : (k || `列 ${idx + 1}`);
          return (
            <div key={k || idx} style={{ minWidth: 100 }}>
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

  // ============================================================================
  // 【工具函数】
  // ============================================================================
  
  /**
   * 为图标添加样式
   * 
   * @param node - React 节点（图标组件）
   * @param size - 图标大小（字体大小）
   * @param color - 图标颜色
   * @returns 添加了样式的图标组件
   * 
   * 【样式设置】
   * - fontSize: 指定大小
   * - color: 指定颜色
   * - display: inline-block
   * - verticalAlign: middle
   * - lineHeight: 1（避免行高影响对齐）
   */
  const styledIcon = (node: React.ReactNode, size: number, color: string) => {
    return React.isValidElement(node)
      ? React.cloneElement(node as any, { style: { ...((node as any).props?.style || {}), fontSize: size, color, display: 'inline-block', verticalAlign: 'middle', lineHeight: 1 } })
      : node;
  };

  /**
   * 规范化路径（移除末尾的斜杠）
   * 
   * @param p - 路径字符串
   * @returns 规范化后的路径
   * 
   * 【示例】
   * - '/admin/users/' -> '/admin/users'
   * - '/admin/users' -> '/admin/users'
   * - '' -> '/'
   */
  const normalize = (p: string) => String(p || '').replace(/\/+$/, '') || '/';
  
  /**
   * 路径匹配函数
   * 支持精确匹配和参数化路由匹配（如 /users/:id）
   * 
   * @param specPath - 路由规范路径（可能包含参数，如 /users/:id）
   * @param curPath - 当前路径
   * @returns 是否匹配
   * 
   * 【匹配规则】
   * 1. 精确匹配：路径完全相同
   * 2. 参数匹配：将 :param 替换为 [^/]+ 进行正则匹配
   * 
   * 【示例】
   * - pathMatch('/users/:id', '/users/123') -> true
   * - pathMatch('/users/:id', '/users/123/posts') -> false
   */
  const pathMatch = (specPath: string, curPath: string) => {
    const a = normalize(specPath);
    const b = normalize(curPath);
    if (a === b) return true; // 精确匹配
    // 参数化路由匹配：将 :param 替换为 [^/]+
    const re = new RegExp('^' + a.replace(/:[^/]+/g, '[^/]+') + '$');
    return re.test(b);
  };
  
  /**
   * 根据路径查找对应的路由规范
   * 
   * @param p - 路径字符串
   * @returns 匹配的路由规范对象，如果未找到则返回 undefined
   */
  const findSpec = (p: string) => routeSpecs.find(s => pathMatch(s.path, p));
  
  /**
   * 当前路由对应的路由规范
   * 用于自动获取标题、图标、面包屑等信息
   */
  const currentSpec = useMemo(() => findSpec(loc.pathname), [loc.pathname]);

  /** SDN 控制台：内嵌 Table 默认无边框；显式传 tableProps.bordered 仍可打开。 */
  const resolvedTableBordered = useMemo(() => {
    if (!tableProps) return undefined as boolean | undefined;
    if (tableProps.bordered !== undefined) return tableProps.bordered;
    return !isSdnccPagePath(loc.pathname);
  }, [tableProps, loc.pathname]);
  /**
   * 自动生成的面包屑导航
   * 
   * 【生成逻辑】
   * 1. 如果提供了自定义 breadcrumb，直接使用
   * 2. 如果未找到路由规范，只显示首页
   * 3. 否则根据路由规范自动生成：
   *    - 首页（HomeOutlined）
   *    - 平台（如果存在，如 CNMC/SDNCC）
   *    - 分组（如果存在，如 "资源管理"）
   *    - 父级路由（如果存在 parentId）
   *    - 当前页面
   * 
   * 【依赖】
   * - breadcrumb: 自定义面包屑（如果提供）
   * - loc.pathname: 当前路径
   * - currentSpec: 当前路由规范
   */
  const autoCrumbs = useMemo(() => {
    if (breadcrumb) return breadcrumb; // 使用自定义面包屑
    if (!currentSpec) return [{ label: <HomeOutlined />, href: '/' }]; // 未找到路由规范，只显示首页
    
    const lbl = currentSpec.breadcrumbLabel || currentSpec.title || currentSpec.id;
    const parent = currentSpec.parentId ? routeSpecs.find(s => s.id === currentSpec.parentId) : undefined;
    
    const items: Array<{ label: React.ReactNode; href?: string }> = [
      { label: <HomeOutlined />, href: '/' }, // 首页
    ];
    
    // 添加平台层级（如果存在）
    if (currentSpec.platform) items.push({ label: currentSpec.platform });
    // 添加分组层级（如果存在）
    if (currentSpec.group) items.push({ label: currentSpec.group });
    // 添加父级路由（如果存在）
    if (parent) items.push({ label: parent.breadcrumbLabel || parent.title || parent.id, href: parent.path });
    // 添加当前页面
    items.push({ label: lbl });
    
    return items;
  }, [loc.pathname, currentSpec, breadcrumb]);

  /**
   * 显示的标题（优先级：props.title > 路由规范.title > 路由规范.breadcrumbLabel）
   */
  const displayTitle = title || currentSpec?.title || currentSpec?.breadcrumbLabel || '';
  
  /**
   * 显示的副标题（优先级：props.subtitle > 路由规范.subtitle）
   */
  const displaySubtitle = subtitle || currentSpec?.subtitle || '';
  
  /**
   * 显示的图标（优先级：props.icon > 路由规范.icon）
   * 如果从路由规范获取，会应用默认样式（大小 22，主题色）
   */
  const displayIcon = icon || styledIcon(iconOf(currentSpec?.icon), 22, token.colorPrimary);

  /**
   * 卡片样式配置
   * - marginBottom: 16px（卡片之间的间距）
   * - borderRadius: 8px（圆角）
   * - boxShadow: 根据 elevated 属性决定是否显示阴影
   * - background: #fff（白色背景）
   */
  const cardStyle: React.CSSProperties = {
    marginBottom: 16,
    borderRadius: 8,
    boxShadow: elevated ? '0 6px 16px rgba(0,0,0,0.08)' : undefined,
    background: '#fff',
  };

  /**
   * 工具栏右侧操作节点
   * 
   * 【生成逻辑】
   * 1. 如果提供了 toolbarRight，直接使用
   * 2. 否则根据以下条件自动生成：
   *    - secondaryActions: 次要操作按钮
   *    - primaryAction: 主要操作按钮
   *    - moreMenuItems: 更多操作菜单（下拉菜单）
   *    - tableProps: 表格列控制器按钮
   *    - onRefresh: 刷新按钮
   * 
   * 【更多菜单处理】
   * - 自动在危险操作和非危险操作之间插入分隔线
   * - 支持禁用状态
   * - 支持点击回调
   */
  const actionsNode = toolbarRight ?? (
    (primaryAction || (moreMenuItems && moreMenuItems.length > 0) || tableProps || secondaryActions || onRefresh) ? (
      <Space>
        {/* 次要操作按钮 */}
        {secondaryActions}
        
        {/* 主要操作按钮 */}
        {primaryAction && (
          <Button
            type={primaryAction.type || 'primary'}
            size={actionsSize}
            disabled={primaryAction.disabled}
            onClick={primaryAction.onClick}
          >
            {primaryAction.text}
          </Button>
        )}
        
        {/* 更多操作菜单（下拉菜单） */}
        {(moreMenuItems && moreMenuItems.length > 0) && (
          <Dropdown
            menu={{
              items: moreMenuItems.flatMap((m, idx) => {
                const items: any[] = [];
                // 如果当前是危险操作，且前一个不是，插入分隔线
                // 这样可以将危险操作和非危险操作分开显示
                if (idx > 0 && m.danger && !moreMenuItems[idx - 1].danger) {
                  items.push({ type: 'divider' });
                }
                items.push({
                  key: m.key,
                  label: m.label,
                  danger: m.danger,
                  disabled: m.disabled,
                  onClick: m.onClick ? () => m.onClick?.() : undefined,
                });
                return items;
              }),
            }}
          >
            <Button size={actionsSize} icon={<EllipsisOutlined />} />
          </Dropdown>
        )}
        
        {/* 表格列控制器按钮（仅在提供 tableProps 且未使用外部列控制时显示） */}
        {tableProps && !externalColumnControl && (
          <Popover trigger="click" placement="bottomRight" content={columnControllerContent}>
            <Button size={actionsSize} icon={<SettingOutlined />} />
          </Popover>
        )}
        
        {/* 刷新按钮（仅在提供 onRefresh 时显示） */}
        {onRefresh && (
          <Button
            size={actionsSize}
            icon={<ReloadOutlined />}
            onClick={() => {
              (onRefresh as (force?: boolean) => void)(true);
            }}
          />
        )}
      </Space>
    ) : null
  );

  // ============================================================================
  // 【主渲染】
  // ============================================================================
  
  return (
    <div 
      className={className} 
      style={{ 
        padding: pagePadding !== undefined ? pagePadding : '24px 36px', // 默认内边距
        maxHeight: '100%', 
        display: 'flex', 
        flexDirection: 'column', // 垂直布局
        ...style 
      }}
    >
      {/* ========== 面包屑导航 ========== */}
      {!hideHeader && autoCrumbs.length > 0 && (
        <Breadcrumb
          style={{ marginBottom: 12 }}
          items={autoCrumbs.map((item) => ({ title: item.label, href: item.href }))}
        />
      )}

      {/* ========== 页面头部：标题 + 图标 + 右侧操作 ========== */}
      {!hideHeader && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          {/* 左侧：图标 + 标题 */}
          <Space size={8} style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 8 }}>
            {displayIcon}
            <Typography.Title 
              level={titleLevel} 
              style={{ 
                margin: 0, 
                lineHeight: 1, 
                display: 'inline-flex', 
                alignItems: 'center', 
                fontSize: 24 
              }}
            >
              {displayTitle}
            </Typography.Title>
            {headerTrailing}
          </Space>
          
          {/* 右侧：额外内容 + 返回按钮 */}
          <Space>
            {extra}
            {onBack && <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button>}
          </Space>
        </div>
      )}

      {/* ========== 副标题（可点击展开/收起可折叠内容） ========== */}
      {!hideHeader && displaySubtitle && (
        <Typography.Text 
          type="secondary" 
          style={{ 
            display: 'block', 
            marginBottom: tabList ? 12 : 16, 
            cursor: 'pointer' 
          }} 
          onClick={() => setCollapsed(!collapsed)}
        >
          {displaySubtitle}
        </Typography.Text>
      )}
      
      {/* ========== 可折叠的额外内容区域 ========== */}
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
          {/* 使用 ref 动态计算内容高度，实现平滑的展开/收起动画 */}
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
      
      {/* ========== 分隔线（仅在未使用 Tab 且未隐藏时显示） ========== */}
      {!hideHeader && !tabList && !hideDivider && (
        <Divider style={{ margin: '0 0 16px 0' }} />
      )}

      {/* ========== Tab 标签页（如果存在，替换分隔线） ========== */}
      {tabList && tabList.length > 0 && (
        <Tabs
          activeKey={tabActiveKey}
          onChange={onTabChange}
          tabBarExtraContent={tabBarExtraContent}
          items={tabList.map(t => ({ key: t.key, label: t.tab }))}
        />
      )}

      {/* ========== 工具栏（左侧工具栏 + 右侧操作按钮） ========== */}
      {(toolbarLeft || actionsNode) && (
        <div
          className="page-container-toolbar"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-start',
            marginBottom: 16,
            // 如果启用 sticky，工具栏将固定在顶部
            ...(toolbarSticky ? { position: 'sticky', top: 0, zIndex: 1, background: '#fff' } : {}),
            ...(toolbarStyle || {}),
          }}
        >
          {/* 左侧；minWidth:0 与右侧 marginLeft:'auto' 成对，避免无筛选或换行时操作区贴左 */}
          <Space size={toolbarGapLeft} wrap style={{ minWidth: 0 }}>
            {toolbarLeft}
          </Space>

          {/* 右侧操作按钮 */}
          <Space size={toolbarGapRight} wrap style={{ marginLeft: 'auto' }}>
            {actionsNode}
          </Space>
        </div>
      )}

      {/* ========== 内容容器：可选择使用卡片或直接渲染 ========== */}
      {asCard ? (
        // 卡片模式：使用 Card 组件包裹内容
        <Card 
          variant={bordered ? 'outlined' : 'borderless'} 
          style={cardStyle} 
          styles={{ body: { padding: contentPadding } }}
        >
          {children}
        </Card>
      ) : (
        // 直接渲染模式：不使用卡片包裹
        <div style={{ margin: 0, flex: 1 }}>
          {/* 如果提供了 tableProps，自动渲染标准样式的表格 */}
          {tableProps && (
            <Table
              {...tableProps}
              bordered={resolvedTableBordered}
              className={`page-container-table ${tableProps.className || ''}`}
              columns={filteredColumns || tableProps.columns} // 使用过滤后的列（排除隐藏的列）
              pagination={tableProps.pagination !== false ? {
                 size: 'default',
                 showSizeChanger: true, // 显示每页条数选择器
                 showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`, // 显示总数
                 ...(typeof tableProps.pagination === 'object' ? tableProps.pagination : {}),
                 showQuickJumper: false, // 强制禁用快速跳转，符合设计规范
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
