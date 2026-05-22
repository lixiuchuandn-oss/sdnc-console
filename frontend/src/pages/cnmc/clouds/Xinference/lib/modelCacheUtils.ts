/** Xinference GET /v1/cache/models 版本串解析与匹配 */

export function buildModelCacheVersionKey(
  modelName: string,
  size?: string,
  format?: string,
  quantization?: string,
): string {
  if (!format || !quantization) return '';
  const sizePart = size ? `${size.replace(/\./g, '_')}B` : '';
  return [modelName, sizePart, format, quantization].filter(Boolean).join('--');
}

export function modelNameHasAnyCache(modelName: string, cachedVersions: string[]): boolean {
  if (!modelName || !cachedVersions.length) return false;
  return cachedVersions.some((v) => v === modelName || v.startsWith(`${modelName}--`));
}

export function isCacheVersionMatch(
  version: string,
  modelName: string,
  size?: string,
  format?: string,
  quantization?: string,
): boolean {
  if (!version.trim()) return false;
  const key = buildModelCacheVersionKey(modelName, size, format, quantization);
  if (key && (version === key || version.includes(key))) return true;
  if (!format || !quantization) {
    return version.startsWith(`${modelName}--`);
  }
  return (
    version.startsWith(`${modelName}--`) &&
    version.includes(`--${format}--`) &&
    (version.endsWith(`--${quantization}`) || version.includes(`--${quantization}`))
  );
}

export function rowHasCachedWeights(
  row: {
    modelName: string;
    sizeInBillions?: string;
    modelFormat?: string;
    quantization?: string;
  },
  cachedVersions: string[],
): boolean {
  if (!cachedVersions.length) return false;
  return cachedVersions.some((v) =>
    isCacheVersionMatch(
      v,
      row.modelName,
      row.sizeInBillions,
      row.modelFormat,
      row.quantization,
    ),
  );
}

export function cachedVersionCountForModel(modelName: string, cachedVersions: string[]): number {
  return cachedVersions.filter((v) => v === modelName || v.startsWith(`${modelName}--`)).length;
}

export function selectLabel(value: string, cached?: boolean): string {
  return cached ? `${value}（已缓存）` : value;
}
