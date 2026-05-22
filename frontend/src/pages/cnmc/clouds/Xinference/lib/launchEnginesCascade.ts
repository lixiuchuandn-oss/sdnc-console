/** Xinference GET /v1/engines/{type}/{name} 解析与级联选项 */

export type EngineCombo = {
  model_name: string;
  model_format: string;
  model_size_in_billions?: string;
  quantizations: string[];
  multimodal_projectors?: string[];
};

export type ParsedEngine = {
  name: string;
  available: boolean;
  reason?: string;
  combos: EngineCombo[];
};

export type ParsedEngines = {
  engines: ParsedEngine[];
};

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function normalizeCombo(raw: unknown): EngineCombo | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const format = String(o.model_format ?? '').trim();
  if (!format) return null;
  const quants = Array.isArray(o.quantizations)
    ? o.quantizations.map((x) => String(x)).filter(Boolean)
    : ['none'];
  const projectors = Array.isArray(o.multimodal_projectors)
    ? o.multimodal_projectors.map((x) => String(x)).filter(Boolean)
    : undefined;
  const sizeRaw = o.model_size_in_billions;
  const size =
    sizeRaw != null && String(sizeRaw).trim() !== '' ? String(sizeRaw).trim() : undefined;
  return {
    model_name: String(o.model_name ?? ''),
    model_format: format,
    model_size_in_billions: size,
    quantizations: quants.length ? quants : ['none'],
    multimodal_projectors: projectors?.length ? projectors : undefined,
  };
}

export function parseEnginesResponse(data: Record<string, unknown>): ParsedEngines {
  const engines: ParsedEngine[] = [];
  for (const [name, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const combos = value.map(normalizeCombo).filter((c): c is EngineCombo => c != null);
      engines.push({ name, available: true, combos });
    } else if (typeof value === 'string') {
      engines.push({ name, available: false, reason: value, combos: [] });
    }
  }
  return { engines };
}

export function combosFor(parsed: ParsedEngines, engineName: string): EngineCombo[] {
  return parsed.engines.find((e) => e.name === engineName)?.combos ?? [];
}

export function firstAvailableEngine(parsed: ParsedEngines): ParsedEngine | undefined {
  return parsed.engines.find((e) => e.available && e.combos.length > 0);
}

export function formatsFor(parsed: ParsedEngines, engineName: string): string[] {
  return unique(combosFor(parsed, engineName).map((c) => c.model_format));
}

export function sizesFor(parsed: ParsedEngines, engineName: string, format: string): string[] {
  return unique(
    combosFor(parsed, engineName)
      .filter((c) => c.model_format === format && c.model_size_in_billions)
      .map((c) => c.model_size_in_billions as string),
  );
}

export function hasSizeDimension(parsed: ParsedEngines, engineName: string, format: string): boolean {
  return sizesFor(parsed, engineName, format).length > 0;
}

function filterCombos(
  parsed: ParsedEngines,
  engineName: string,
  format: string,
  size?: string,
): EngineCombo[] {
  return combosFor(parsed, engineName).filter((c) => {
    if (c.model_format !== format) return false;
    if (size != null && size !== '') {
      return c.model_size_in_billions === size;
    }
    return true;
  });
}

export function quantizationsFor(
  parsed: ParsedEngines,
  engineName: string,
  format: string,
  size?: string,
): string[] {
  return unique(filterCombos(parsed, engineName, format, size).flatMap((c) => c.quantizations));
}

export function projectorsFor(
  parsed: ParsedEngines,
  engineName: string,
  format: string,
  size?: string,
): string[] {
  return unique(
    filterCombos(parsed, engineName, format, size).flatMap((c) => c.multimodal_projectors ?? []),
  );
}

/** 展示：0_5 → 0.5B */
export function displaySize(size: string): string {
  const normalized = size.replace(/_/g, '.');
  return normalized.toLowerCase().endsWith('b') ? normalized : `${normalized}B`;
}

export function selectLabel(value: string, cached?: boolean): string {
  return cached ? `${value}（已缓存）` : value;
}

/** 单选项自动选中；当前值不在列表时返回首项 */
export function coerceSelectValue(options: string[], current: string | undefined): string | undefined {
  if (options.length === 0) return undefined;
  if (current && options.includes(current)) return current;
  return options[0];
}

export function isGgufFamily(format?: string): boolean {
  const f = (format || '').toLowerCase();
  return f === 'ggufv2' || f === 'ggmlv3';
}
