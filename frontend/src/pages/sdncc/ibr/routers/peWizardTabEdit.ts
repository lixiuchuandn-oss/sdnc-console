/** HUB_PE / LAN Form.List · editable-card Tab 增删规划（P1） */

export type InventoryTabEditPlan =
  | { action: 'add'; nextActiveKey: string }
  | { action: 'remove'; removeIndex: number; nextActiveKey: string };

export function planInventoryTabEdit(
  action: 'add' | 'remove',
  targetKey: string | number,
  fieldCount: number,
  activeKey: string,
): InventoryTabEditPlan | null {
  if (action === 'add') {
    return { action: 'add', nextActiveKey: String(fieldCount) };
  }
  if (fieldCount <= 1) return null;
  const key = String(targetKey);
  return {
    action: 'remove',
    removeIndex: Number(key),
    nextActiveKey: activeKey === key ? '0' : activeKey,
  };
}
