import React from 'react';
import { Tooltip } from 'antd';

/** 直通设备列（GPU / 网卡 / USB）超长文案省略展示 */
export function renderVmDevicePassthroughCell(
  items: string[] | string | undefined | null,
): React.ReactNode {
  const list = Array.isArray(items)
    ? items.map((x) => String(x || '').trim()).filter(Boolean)
    : String(items || '').trim()
      ? [String(items).trim()]
      : [];
  if (list.length === 0) return '-';
  const text = list.join(', ');
  return (
    <Tooltip title={text}>
      <div
        style={{
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
    </Tooltip>
  );
}
