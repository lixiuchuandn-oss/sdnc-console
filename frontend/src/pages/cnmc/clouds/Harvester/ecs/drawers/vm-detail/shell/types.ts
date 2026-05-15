/**
 * 虚拟机详情抽屉 · 对外 props（实现见 VmDetailDrawer.tsx / shell/*）
 */

export interface VmDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  record: any;
  cloudId?: string;
  namespaces?: any[];
  volumes?: any[];
  images?: any[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  onRefresh?: (force?: boolean) => void;
  onBackup?: (vm: any) => void;
  onSnapshot?: (vm: any) => void;
  onClone?: (vm: any) => void;
  onMigrate?: (vm: any) => void;
  onDelete?: (vm: any) => void;
}
