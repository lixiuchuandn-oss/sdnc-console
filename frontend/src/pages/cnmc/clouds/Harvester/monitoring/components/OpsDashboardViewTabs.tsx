/**
 * 运维监控大盘 · 可拖拽排序的视图 Tab（超出主栏上限的视图收入「更多监控视图」）
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowDownOutlined, ArrowUpOutlined, DownOutlined, HolderOutlined, UndoOutlined } from '@ant-design/icons';
import { Button, Dropdown, InputNumber, Popover, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  OPS_DASHBOARD_TOOLBAR_SPACE_SIZE,
  opsDashboardTagStyle,
} from '../lib/opsDashboardLayout';
import {
  clampOpsDashboardVisibleTabMax,
  DEFAULT_OPS_DASHBOARD_VISIBLE_TAB_MAX,
  loadOpsDashboardVisibleTabMax,
  MAX_OPS_DASHBOARD_VISIBLE_TAB_MAX,
  MIN_OPS_DASHBOARD_VISIBLE_TAB_MAX,
  saveOpsDashboardVisibleTabMax,
  splitOpsDashboardViewsByVisibleMax,
} from '../lib/opsDashboardViewDisplay';
import {
  moveOpsDashboardView,
  reorderOpsDashboardViews,
  resetOpsDashboardViewOrder,
  saveOpsDashboardViewOrder,
} from '../lib/opsDashboardViewOrder';
import type { OpsDashboardView, OpsDashboardViewDef } from '../lib/opsDashboardViews';

export interface OpsDashboardViewTabsProps {
  views: OpsDashboardViewDef[];
  activeView: OpsDashboardView;
  onActiveViewChange: (key: OpsDashboardView) => void;
  onViewsOrderChange: (views: OpsDashboardViewDef[]) => void;
}

const OpsDashboardViewTabs: React.FC<OpsDashboardViewTabsProps> = ({
  views,
  activeView,
  onActiveViewChange,
  onViewsOrderChange,
}) => {
  const [draggingKey, setDraggingKey] = useState<OpsDashboardView | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<OpsDashboardView | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [visibleTabMax, setVisibleTabMax] = useState(() => loadOpsDashboardVisibleTabMax());
  const didDragRef = useRef(false);

  const { primaryViews, overflowViews } = useMemo(
    () => splitOpsDashboardViewsByVisibleMax(views, visibleTabMax),
    [views, visibleTabMax],
  );

  const isOverflowActive = useMemo(
    () => overflowViews.some((v) => v.key === activeView),
    [overflowViews, activeView],
  );

  const persistOrder = useCallback(
    (next: OpsDashboardViewDef[]) => {
      onViewsOrderChange(next);
      saveOpsDashboardViewOrder(next);
    },
    [onViewsOrderChange],
  );

  const handleVisibleTabMaxChange = useCallback((raw: number | null) => {
    const next = clampOpsDashboardVisibleTabMax(raw ?? DEFAULT_OPS_DASHBOARD_VISIBLE_TAB_MAX);
    setVisibleTabMax(next);
    saveOpsDashboardVisibleTabMax(next);
  }, []);

  const handleDragStart = useCallback((key: OpsDashboardView) => {
    didDragRef.current = false;
    setDraggingKey(key);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingKey(null);
    setDropTargetKey(null);
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
  }, []);

  const overflowMenu: MenuProps = useMemo(
    () => ({
      items: overflowViews.map((view) => ({ key: view.key, label: view.label })),
      selectable: true,
      selectedKeys: isOverflowActive ? [activeView] : [],
      onClick: ({ key }) => onActiveViewChange(key as OpsDashboardView),
    }),
    [overflowViews, isOverflowActive, activeView, onActiveViewChange],
  );

  const renderDraggableViewTag = (view: OpsDashboardViewDef) => {
    const isActive = activeView === view.key;
    const isDragging = draggingKey === view.key;
    const isDropTarget = dropTargetKey === view.key && draggingKey != null && draggingKey !== view.key;
    return (
      <span
        key={view.key}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', view.key);
          handleDragStart(view.key);
        }}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (draggingKey && draggingKey !== view.key) {
            setDropTargetKey(view.key);
          }
        }}
        onDragLeave={() => {
          if (dropTargetKey === view.key) setDropTargetKey(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const from = (e.dataTransfer.getData('text/plain') || draggingKey) as OpsDashboardView;
          if (!from || from === view.key) return;
          didDragRef.current = true;
          persistOrder(reorderOpsDashboardViews(views, from, view.key));
          setDraggingKey(null);
          setDropTargetKey(null);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          opacity: isDragging ? 0.45 : 1,
          outline: isDropTarget ? '2px dashed #1677ff' : undefined,
          outlineOffset: 2,
          borderRadius: 16,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        <HolderOutlined
          style={{ marginRight: 4, color: 'rgba(0,0,0,.25)', fontSize: 12, pointerEvents: 'none' }}
        />
        <Tag.CheckableTag
          checked={isActive}
          onChange={() => {
            if (didDragRef.current) return;
            onActiveViewChange(view.key);
          }}
          style={{
            ...opsDashboardTagStyle(isActive),
            cursor: isDragging ? 'grabbing' : 'pointer',
          }}
        >
          {view.label}
        </Tag.CheckableTag>
      </span>
    );
  };

  const sortPopover = (
    <div style={{ width: 300 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        拖拽标签或使用上下箭头调整顺序；顺序保存在本浏览器。
      </Typography.Text>
      <div style={{ marginTop: 12 }}>
        <Typography.Text style={{ fontSize: 13 }}>主栏显示标签数</Typography.Text>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <InputNumber
            min={MIN_OPS_DASHBOARD_VISIBLE_TAB_MAX}
            max={MAX_OPS_DASHBOARD_VISIBLE_TAB_MAX}
            value={visibleTabMax}
            onChange={handleVisibleTabMaxChange}
            style={{ width: 88 }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1 }}>
            默认 {DEFAULT_OPS_DASHBOARD_VISIBLE_TAB_MAX}；超出部分收入「更多监控视图」
          </Typography.Text>
        </div>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {views.map((view, idx) => (
          <div
            key={view.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '4px 0',
            }}
          >
            <Typography.Text ellipsis style={{ flex: 1 }}>
              {view.label}
              {idx >= visibleTabMax ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {' '}
                  (更多)
                </Typography.Text>
              ) : null}
            </Typography.Text>
            <Space size={0}>
              <Button
                type="text"
                size="small"
                icon={<ArrowUpOutlined />}
                disabled={idx === 0}
                aria-label={`${view.label} 上移`}
                onClick={() => persistOrder(moveOpsDashboardView(views, view.key, 'up'))}
              />
              <Button
                type="text"
                size="small"
                icon={<ArrowDownOutlined />}
                disabled={idx === views.length - 1}
                aria-label={`${view.label} 下移`}
                onClick={() => persistOrder(moveOpsDashboardView(views, view.key, 'down'))}
              />
            </Space>
          </div>
        ))}
      </div>
      <Button
        type="link"
        size="small"
        icon={<UndoOutlined />}
        style={{ padding: 0, marginTop: 8, height: 'auto' }}
        onClick={() => {
          const next = resetOpsDashboardViewOrder();
          persistOrder(next);
          handleVisibleTabMaxChange(DEFAULT_OPS_DASHBOARD_VISIBLE_TAB_MAX);
        }}
      >
        恢复默认顺序与显示数量
      </Button>
    </div>
  );

  return (
    <Space size={OPS_DASHBOARD_TOOLBAR_SPACE_SIZE} wrap align="center">
      {primaryViews.map((view) => renderDraggableViewTag(view))}
      {overflowViews.length > 0 ? (
        <Dropdown menu={overflowMenu} trigger={['click']}>
          <Tag.CheckableTag
            checked={isOverflowActive}
            onChange={() => {}}
            style={{
              ...opsDashboardTagStyle(isOverflowActive),
              display: 'inline-flex',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            更多监控视图
            <DownOutlined style={{ fontSize: 10, marginLeft: 6 }} />
          </Tag.CheckableTag>
        </Dropdown>
      ) : null}
      <Popover
        open={sortOpen}
        onOpenChange={setSortOpen}
        trigger="click"
        placement="bottomLeft"
        title="调整视图顺序"
        content={sortPopover}
      >
        <Button type="text" size="small" style={{ color: 'rgba(0,0,0,.45)' }}>
          排序
        </Button>
      </Popover>
    </Space>
  );
};

export default OpsDashboardViewTabs;
