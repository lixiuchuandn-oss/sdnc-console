/**
 * 凹槽左上角 LLDP 小角标（物理机网口、交换机口共用，样式 hsm.css `.cloudmap-dc-tp-lldp-mark`）
 */
import { ApiOutlined } from '@ant-design/icons';
import React from 'react';

export function LldpCornerBadge({ title }: { title: string }) {
  return (
    <span className="cloudmap-dc-tp-lldp-mark" title={title} aria-hidden>
      <ApiOutlined className="cloudmap-dc-tp-lldp-mark__icon" />
    </span>
  );
}
