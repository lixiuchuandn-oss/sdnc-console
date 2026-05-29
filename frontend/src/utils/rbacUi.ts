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
  'add',
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

/** 只读账号：隐藏写操作菜单项（保留 divider 清理） */
export function filterMenuItemsForReadOnly<T extends MenuItem>(items: T[], canWrite: boolean): T[] {
  if (canWrite) return items;

  const filtered = items.filter((it) => {
    if (isDividerItem(it)) return true;
    return !WRITE_MENU_ITEM_KEYS.has(menuItemKey(it));
  });

  const out: T[] = [];
  for (const it of filtered) {
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
