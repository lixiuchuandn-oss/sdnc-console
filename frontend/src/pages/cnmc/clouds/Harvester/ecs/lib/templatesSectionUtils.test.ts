import {
  buildTemplateHarvesterDeletePath,
  buildTemplateNamespaceOptions,
  filterHiddenBaseTemplates,
  filterTemplateListRows,
  getTemplateDisplayName,
  getTemplateName,
  getTemplateNamespace,
  getTemplateScope,
} from './templatesSectionUtils';
import {
  buildTemplateDeleteRequest,
  summarizeBatchTemplateDeleteMessage,
} from './templatesSectionActions';

describe('templatesSectionUtils', () => {
  const tpl = {
    metadata: {
      name: 'my-tpl',
      namespace: 'proj-a',
      annotations: { 'tower.io/template-alias': '我的模板' },
    },
    spec: { description: 'desc' },
    status: { defaultVersion: 1, latestVersion: 2 },
  };

  it('getTemplateDisplayName prefers alias annotations', () => {
    expect(getTemplateDisplayName(tpl)).toBe('我的模板');
  });

  it('getTemplateScope detects public namespace', () => {
    expect(getTemplateScope(tpl, (ns) => ns === 'harvester-public')).toBe('私有模板');
    expect(
      getTemplateScope(
        { metadata: { namespace: 'harvester-public' } },
        (ns) => ns === 'harvester-public',
      ),
    ).toBe('公共模板');
  });

  it('filterHiddenBaseTemplates removes base template names', () => {
    const rows = filterHiddenBaseTemplates([
      tpl,
      { metadata: { name: 'raw-image-base-template' } },
    ]);
    expect(rows).toHaveLength(1);
    expect(getTemplateName(rows[0])).toBe('my-tpl');
  });

  it('filterHiddenBaseTemplates hides all base templates', () => {
    const rows = filterHiddenBaseTemplates([
      { metadata: { name: 'raw-image-base-template', namespace: 'ns-a' } },
    ]);
    expect(rows).toHaveLength(0);
  });

  it('filterTemplateListRows applies keyword and namespace', () => {
    const base = filterHiddenBaseTemplates([
      tpl,
      { metadata: { name: 'other', namespace: 'proj-b' } },
    ]);
    const rows = filterTemplateListRows(base, {
      searchText: '我的',
      selectedNamespace: 'proj-a',
      selectedScope: '',
      isPublicNamespace: () => false,
    });
    expect(rows).toHaveLength(1);
    expect(getTemplateNamespace(rows[0])).toBe('proj-a');
  });

  it('buildTemplateNamespaceOptions dedupes namespaces', () => {
    expect(
      buildTemplateNamespaceOptions([
        tpl,
        { metadata: { namespace: 'proj-a', name: 'x' } },
      ]),
    ).toEqual([{ value: 'proj-a', label: 'proj-a' }]);
  });

  it('buildTemplateHarvesterDeletePath', () => {
    expect(buildTemplateHarvesterDeletePath('ns', 'name')).toContain(
      '/virtualmachinetemplates/name',
    );
  });
});

describe('templatesSectionActions', () => {
  it('summarizeBatchTemplateDeleteMessage', () => {
    expect(
      summarizeBatchTemplateDeleteMessage([
        { ok: true, id: 'a' },
        { ok: false, id: 'b', err: 'x' },
      ]).error,
    ).toContain('b');
  });

  it('buildTemplateDeleteRequest', () => {
    const req = buildTemplateDeleteRequest({
      metadata: { name: 'tpl', namespace: 'ns', annotations: { 'tower.io/template-alias': 'A' } },
    });
    expect(req.label).toBe('A (tpl)');
    expect(req.path).toContain('/virtualmachinetemplates/tpl');
  });
});
