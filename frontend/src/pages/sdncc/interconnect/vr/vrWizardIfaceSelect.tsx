import React from 'react';
import { Space, Tag } from 'antd';

/** 纯文本（用于 filter、镜像表单项等） */
export function formatIfaceWizardOptionLabel(ifaceName: string, usedFor?: string): string {
  const name = String(ifaceName ?? '').trim();
  const tag = String(usedFor ?? '').trim();
  if (!name) return String(ifaceName ?? '');
  if (!tag) return name;
  return `${name} · 已用于${tag}`;
}

/** 下拉项：接口名 + 橙色标签，便于一眼看到「已被别处选用」 */
export function renderIfaceWizardSelectLabel(ifaceName: string, usedFor?: string): React.ReactNode {
  const name = String(ifaceName ?? '').trim();
  const t = String(usedFor ?? '').trim();
  if (!name) return String(ifaceName ?? '');
  if (!t) return name;
  return (
    <Space size={6} wrap align="center">
      <span>{name}</span>
      <Tag color="volcano" style={{ marginInlineEnd: 0 }}>
        已用于{t}
      </Tag>
    </Space>
  );
}
