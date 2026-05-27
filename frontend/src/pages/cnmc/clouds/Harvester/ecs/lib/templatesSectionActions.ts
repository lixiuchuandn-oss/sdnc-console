import {
  buildTemplateHarvesterDeletePath,
  getTemplateAlias,
  getTemplateDeleteLabel,
  getTemplateName,
  getTemplateNamespace,
  getTemplateRowKey,
} from './templatesSectionUtils';

export type BatchTemplateResult = { ok: boolean; id: string; err?: string };

function getTemplateBatchResultId(tpl: any): string {
  const ns = getTemplateNamespace(tpl);
  const name = getTemplateName(tpl);
  const alias = getTemplateAlias(tpl);
  return alias ? `${alias} (${ns}/${name})` : `${ns}/${name}`;
}

export async function mapBatchTemplateDelete(
  targets: any[],
  deleteOne: (tpl: any) => Promise<void>,
): Promise<BatchTemplateResult[]> {
  const results: BatchTemplateResult[] = [];
  for (const tpl of targets) {
    const id = getTemplateBatchResultId(tpl);
    try {
      await deleteOne(tpl);
      results.push({ ok: true, id });
    } catch (e: any) {
      results.push({ ok: false, id, err: e?.message || String(e) });
    }
  }
  return results;
}

export function summarizeBatchTemplateDeleteMessage(results: BatchTemplateResult[]): {
  success?: string;
  error?: string;
} {
  const ok = results.filter((x) => x.ok).length;
  const fail = results.filter((x) => !x.ok);
  return {
    success: ok > 0 ? `删除成功 ${ok} 个模板` : undefined,
    error:
      fail.length > 0
        ? `删除失败 ${fail.length} 个：${fail.map((f) => f.id).join(', ')}`
        : undefined,
  };
}

export function selectTemplatesByRowKeys(templates: any[], selectedRowKeys: Array<string | number>): any[] {
  return templates.filter((t: any) => selectedRowKeys.includes(getTemplateRowKey(t)));
}

export function buildTemplateDeleteRequest(tpl: any): { path: string; label: string } {
  const ns = getTemplateNamespace(tpl);
  const name = getTemplateName(tpl);
  return {
    path: buildTemplateHarvesterDeletePath(ns, name),
    label: getTemplateDeleteLabel(tpl),
  };
}
