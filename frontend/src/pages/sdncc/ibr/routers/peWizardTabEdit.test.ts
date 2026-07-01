import { planInventoryTabEdit } from './peWizardTabEdit';

describe('peWizardTabEdit P1', () => {
  it('plan add activates new tab index', () => {
    expect(planInventoryTabEdit('add', '', 2, '0')).toEqual({
      action: 'add',
      nextActiveKey: '2',
    });
  });

  it('plan remove blocks when only one tab', () => {
    expect(planInventoryTabEdit('remove', '0', 1, '0')).toBeNull();
  });

  it('plan remove deletes target and resets active to 0 when needed', () => {
    expect(planInventoryTabEdit('remove', '1', 3, '1')).toEqual({
      action: 'remove',
      removeIndex: 1,
      nextActiveKey: '0',
    });
    expect(planInventoryTabEdit('remove', '1', 3, '0')).toEqual({
      action: 'remove',
      removeIndex: 1,
      nextActiveKey: '0',
    });
  });
});
