import { buildRecycledVmNamespaceOptions } from './recycleBinSectionUtils';

describe('buildRecycledVmNamespaceOptions', () => {
  it('去重并过滤系统命名空间', () => {
    const options = buildRecycledVmNamespaceOptions([
      { metadata: { namespace: 'proj-a' } },
      { metadata: { namespace: 'proj-a' } },
      { metadata: { namespace: 'kube-system' } },
      { namespace: 'proj-b' },
    ]);
    expect(options).toEqual([
      { value: 'proj-a', label: 'proj-a' },
      { value: 'proj-b', label: 'proj-b' },
    ]);
  });

  it('空列表返回空数组', () => {
    expect(buildRecycledVmNamespaceOptions([])).toEqual([]);
  });
});
