import type { MenuProps } from 'antd';

/** 无 write 权限时从行操作/批量菜单中移除的 key */
export const WRITE_MENU_ITEM_KEYS = new Set([
  'edit',
  'editLabels',
  'edit_acl',
  'restore',
  'suspend',
  'createSubnet',
  'create_vm',
  'attach',
  'detach',
  'export',
  'snapshot',
  'clone',
  'force_delete',
  'batchDelete',
  'delete',
  'del',
  'bulkDelete',
  'setFavorite',
  'unsetFavorite',
  'assign',
  'create',
  'test',
  /** USB 直通：claim / unclaim */
  'claim',
  'unclaim',
]);

export function readActionToWrite(readAction: string): string {
  if (readAction.endsWith(':read')) {
    return `${readAction.slice(0, -':read'.length)}:write`;
  }
  return readAction;
}

type MenuItem = NonNullable<MenuProps['items']>[number];

function isDividerItem(item: MenuItem): boolean {
  return !!item && typeof item === 'object' && 'type' in item && item.type === 'divider';
}

function menuItemKey(item: MenuItem): string {
  if (!item || typeof item !== 'object' || !('key' in item)) return '';
  return String(item.key ?? '');
}

/** 清理菜单首尾与连续 divider */
export function compactActionMenuItems<T extends MenuItem>(items: T[]): T[] {
  const out: T[] = [];
  for (const it of items) {
    if (isDividerItem(it)) {
      if (!out.length || isDividerItem(out[out.length - 1])) continue;
      out.push(it);
      continue;
    }
    out.push(it);
  }
  while (out.length && isDividerItem(out[out.length - 1])) {
    out.pop();
  }
  return out;
}

/** 有写权限时纳入菜单项，否则不展示（隐藏，勿用 disabled 置灰） */
export function writeMenuItemIf<T extends MenuItem>(canWrite: boolean, item: T): T[] {
  return canWrite ? [item] : [];
}

/** 只读账号：隐藏写操作菜单项（保留 divider 清理） */
export function filterMenuItemsForReadOnly<T extends MenuItem>(items: T[], canWrite: boolean): T[] {
  if (canWrite) return compactActionMenuItems(items);

  const filtered = items.filter((it) => {
    if (isDividerItem(it)) return true;
    return !WRITE_MENU_ITEM_KEYS.has(menuItemKey(it));
  });

  return compactActionMenuItems(filtered);
}
