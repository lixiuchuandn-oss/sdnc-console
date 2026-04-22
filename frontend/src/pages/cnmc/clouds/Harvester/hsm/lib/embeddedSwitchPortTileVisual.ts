/**
 * 内嵌交换机 / 物理节点网口：端口状态角标文案。
 * 交换机端口格与物理机同源单槽样式（`hsm.css` · `tp-slot--switch*`、`tp-slot--nic-*`）。
 */
import type { PortStatusKind } from '../../cluster/lib/parseAswCtlInterfaceStdout';

export type SwitchEmbeddedPortVisual = { label: string };

export const SWITCH_EMBEDDED_PORT_VISUAL: Record<PortStatusKind, SwitchEmbeddedPortVisual> = {
  up: { label: 'Up' },
  down: { label: 'Down' },
  admin: { label: 'Admin' },
  unknown: { label: '未知' },
};
