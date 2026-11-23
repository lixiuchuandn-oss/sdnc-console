/**
 * 专家模式片段：list 字段启用后空文本视为清空意图（[]），须写入 payload，不得省略 key。
 */

export const EMPTY_LIST_JSON = '[]';

export const isEmptySectionText = (text: string | undefined): boolean =>
  String(text ?? '').trim() === '';

/** 启用 list 字段：无内容时填 `[]`，已有文本保持不变。 */
export const textAfterEnableListSection = (current: string | undefined): string =>
  isEmptySectionText(current) ? EMPTY_LIST_JSON : String(current);

/**
 * 已启用片段解析结果：空文本 + list → `[]`（清空）；空文本 + 非 list 仍省略。
 */
export const resolvedEnabledSectionValue = (
  parsed: unknown,
  opts: { isList: boolean },
): unknown | undefined => {
  if (typeof parsed !== 'undefined') return parsed;
  if (opts.isList) return [];
  return undefined;
};
