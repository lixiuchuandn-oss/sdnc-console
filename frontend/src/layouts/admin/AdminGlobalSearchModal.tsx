/**
 * 顶栏全局搜索弹窗（表现层）：与 `hooks/useGlobalSearch`（Ctrl+K / ↑↓ / Enter / Esc）配套。
 * 仅负责渲染与点选跳转；键盘导航与过滤在 hook 内完成。
 */
import React from 'react';
import { Button, Input, Space, Typography } from 'antd';
import { sidebarForPath, type PageSearchEntry } from './lib/adminLayoutNav';

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  searchText: string;
  setSearchText: (text: string) => void;
  searchActiveIndex: number;
  setSearchActiveIndex: (index: number) => void;
  filteredSearchList: PageSearchEntry[];
  navigateToAdminContent: (path: string) => void;
  setActiveSidebarKey: (key: string) => void;
};

const AdminGlobalSearchModal: React.FC<Props> = ({
  open,
  setOpen,
  searchText,
  setSearchText,
  searchActiveIndex,
  setSearchActiveIndex,
  filteredSearchList,
  navigateToAdminContent,
  setActiveSidebarKey,
}) => {
  if (!open) return null;
  return (
    <div
      onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 3000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: '10%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 720,
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: 16, borderBottom: '1px solid #f0f0f0' }}>
          <Input
            autoFocus
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setSearchActiveIndex(0);
            }}
            placeholder="搜索页面…  快捷键 Ctrl+K / Esc 关闭"
            size="large"
          />
        </div>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {filteredSearchList.length === 0 ? (
            <div style={{ padding: 16 }}>
              <Typography.Text type="secondary">无匹配结果</Typography.Text>
            </div>
          ) : (
            filteredSearchList.map((it: PageSearchEntry, idx: number) => (
              <div
                key={it.path}
                onMouseEnter={() => setSearchActiveIndex(idx)}
                onClick={() => {
                  const path = it.path;
                  const pure = String(path || '').split('?')[0];
                  navigateToAdminContent(path);
                  if (pure !== '/console') {
                    setActiveSidebarKey(sidebarForPath(path));
                  }
                  setOpen(false);
                }}
                style={{
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  background: idx === searchActiveIndex ? '#f0f7ff' : '#fff',
                  borderBottom: '1px solid #f5f5f5',
                }}
              >
                <Space size={10}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: '#f0f5ff',
                    }}
                  >
                    {it.icon}
                  </span>
                  <span style={{ fontSize: 14 }}>{it.label}</span>
                </Space>
                <Typography.Text type="secondary">{it.group}</Typography.Text>
              </div>
            ))
          )}
        </div>
        <div
          style={{
            padding: '10px 16px',
            background: '#fafafa',
            borderTop: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography.Text type="secondary">Enter 打开 · ESC 关闭 · SCROLL 查看更多</Typography.Text>
          <Button type="text" onClick={() => setOpen(false)}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AdminGlobalSearchModal;
