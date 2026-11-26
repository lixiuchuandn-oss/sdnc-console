/** HUB_PE / LAN Form.List · editable-card Tab 增删规划（P1） */

export type InventoryTabEditPlan =
  | { action: 'add'; nextActiveKey: string }
  | { action: 'remove'; removeIndex: number; nextActiveKey: string };

export function planInventoryTabEdit(
  action: 'add' | 'remove',
  targetKey: string | number,
  fieldCount: number,
  activeKey: string,
  opts?: { removeBlockedIndexes?: ReadonlySet<number> | number[] },
): InventoryTabEditPlan | null {
  if (action === 'add') {
    return { action: 'add', nextActiveKey: String(fieldCount) };
  }
  if (fieldCount <= 1) return null;
  const key = String(targetKey);
  const removeIndex = Number(key);
  if (!Number.isFinite(removeIndex)) return null;
  const blocked = opts?.removeBlockedIndexes;
  if (blocked) {
    const set = blocked instanceof Set ? blocked : new Set(blocked);
    if (set.has(removeIndex)) return null;
  }
  return {
    action: 'remove',
    removeIndex,
    nextActiveKey: activeKey === key ? '0' : activeKey,
  };
}
