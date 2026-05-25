import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';

/** 从模板快速创建 VM：输入框 placeholder 与空值校验提示须一致 */
export const QUICK_CREATE_VM_NAME_HINT = '请输入云主机名称（支持中文）';

/** 临时：按模板 metadata.name 隐藏系统/底座模板（前端硬编码，后续可删） */
export const HIDDEN_VM_TEMPLATE_NAMES = new Set([
  'windows-raw-image-base-template',
  'windows-iso-image-base-template',
  'iso-image-base-template',
  'raw-image-base-template',
]);

export function getTemplateNamespace(tpl: any): string {
  return tpl?.metadata?.namespace || tpl?.namespace || '';
}

export function getTemplateName(tpl: any): string {
  return tpl?.metadata?.name || tpl?.name || '';
}

export function getTemplateDescription(tpl: any): string {
  return tpl?.spec?.description || tpl?.metadata?.annotations?.description || '';
}

export function getTemplateDisplayName(tpl: any): string {
  return (
    tpl?.spec?.displayName ||
    tpl?.metadata?.annotations?.['tower.io/template-alias'] ||
    tpl?.metadata?.annotations?.['field.cattle.io/displayName'] ||
    tpl?.metadata?.annotations?.['tower.io/alias'] ||
    getTemplateName(tpl)
  );
}

export function getTemplateAlias(tpl: any): string {
  return (
    tpl?.spec?.displayName ||
    tpl?.metadata?.annotations?.['tower.io/template-alias'] ||
    tpl?.metadata?.annotations?.['field.cattle.io/displayName'] ||
    tpl?.metadata?.annotations?.['tower.io/alias'] ||
    ''
  );
}

export function getTemplateScope(
  tpl: any,
  isPublicNs: (name: string) => boolean,
): '全部' | '公共模板' | '私有模板' {
  if (!tpl) return '全部';
  const ns = getTemplateNamespace(tpl);
  return isPublicNs(ns) ? '公共模板' : '私有模板';
}

export function getTemplateDefaultVersion(tpl: any): string {
  if (tpl?.status?.defaultVersion) return `v${tpl.status.defaultVersion}`;
  if (tpl?.spec?.defaultVersionId) {
    const parts = tpl.spec.defaultVersionId.split('/');
    return `v${parts[parts.length - 1]}`;
  }
  return '-';
}

export function getTemplateLatestVersion(tpl: any): string {
  if (tpl?.status?.latestVersion) return `v${tpl.status.latestVersion}`;
  return '-';
}

export function getTemplateRowKey(tpl: any): string {
  return tpl?.metadata?.uid || tpl?.metadata?.name || getTemplateName(tpl);
}

export function buildTemplateHarvesterDeletePath(ns: string, name: string): string {
  return `/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachinetemplates/${name}`;
}

export function getTemplateDeleteLabel(tpl: any): string {
  const name = getTemplateName(tpl);
  const alias = getTemplateAlias(tpl);
  return alias ? `${alias} (${name})` : name;
}

export function filterHiddenBaseTemplates(templates: any[]): any[] {
  return (templates || []).filter(
    (t: any) => !HIDDEN_VM_TEMPLATE_NAMES.has(getTemplateName(t)),
  );
}

export function buildTemplateNamespaceOptions(templates: any[]): { value: string; label: string }[] {
  const nsSet = new Set<string>();
  templates.forEach((t: any) => {
    const ns = getTemplateNamespace(t);
    if (ns && !isSystemNamespace(ns)) nsSet.add(ns);
  });
  return Array.from(nsSet).map((ns) => ({ value: ns, label: ns }));
}

export type TemplateListFilters = {
  searchText: string;
  selectedNamespace: string;
  selectedScope: '' | 'public' | 'private';
  isPublicNamespace: (name: string) => boolean;
};

export function filterTemplateListRows(templates: any[], filters: TemplateListFilters): any[] {
  const { searchText, selectedNamespace, selectedScope, isPublicNamespace } = filters;
  return templates.filter((t: any) => {
    const ns = getTemplateNamespace(t);
    if (selectedNamespace && ns !== selectedNamespace) return false;
    if (selectedScope === 'public' && !isPublicNamespace(ns)) return false;
    if (selectedScope === 'private' && isPublicNamespace(ns)) return false;
    if (searchText) {
      return getTemplateDisplayName(t).toLowerCase().includes(searchText.toLowerCase());
    }
    return true;
  });
}

export function buildTemplateYamlRecord(tpl: any): any {
  const ns = getTemplateNamespace(tpl);
  const name = getTemplateName(tpl);
  const viewLink = buildTemplateHarvesterDeletePath(ns, name);
  return {
    ...tpl,
    kind: tpl?.kind || 'VirtualMachineTemplate',
    links: {
      ...(tpl?.links || {}),
      view: viewLink,
    },
  };
}
