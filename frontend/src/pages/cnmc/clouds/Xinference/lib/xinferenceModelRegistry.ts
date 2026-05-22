import type {
  XinferenceModelRegistration,
  XinferenceRunningModel,
} from '../../../../../services/xinferenceApi';

/** 与 Xinference UI「模型广场」类型 Tab 对齐 */
export const XINFERENCE_GALLERY_MODEL_TYPES = [
  { key: 'LLM', label: '语言模型' },
  { key: 'embedding', label: '嵌入模型' },
  { key: 'rerank', label: '重排序模型' },
  { key: 'image', label: '图像模型' },
  { key: 'audio', label: '音频模型' },
  { key: 'video', label: '视频模型' },
  { key: 'flexible', label: '自定义模型' },
] as const;

export type XinferenceGalleryModelType = (typeof XINFERENCE_GALLERY_MODEL_TYPES)[number]['key'];

export const ABILITY_LABELS: Record<string, string> = {
  chat: 'chat',
  generate: 'generate',
  reasoning: 'reasoning',
  tools: 'tools',
  vision: 'vision',
  embed: 'embed',
  rerank: 'rerank',
  text2image: 'text2image',
  image2image: 'image2image',
  inpainting: 'inpainting',
  text2video: 'text2video',
  text2audio: 'text2audio',
  speech: 'speech',
  transcription: 'transcription',
};

export function modelTypeLabel(modelType: string): string {
  return XINFERENCE_GALLERY_MODEL_TYPES.find((t) => t.key === modelType)?.label ?? modelType;
}

/** 将运行实例的 model_type 规范为广场 Tab key（大小写不敏感） */
export function normalizeRunningModelTypeKey(raw?: string): XinferenceGalleryModelType | null {
  const s = raw?.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  return XINFERENCE_GALLERY_MODEL_TYPES.find((t) => t.key.toLowerCase() === lower)?.key ?? null;
}

export function filterRunningModelsByType(
  items: XinferenceRunningModel[],
  modelType: XinferenceGalleryModelType,
): XinferenceRunningModel[] {
  return items.filter((m) => {
    const t = normalizeRunningModelTypeKey(m.modelType);
    if (modelType === 'LLM') return t === 'LLM' || t == null;
    return t === modelType;
  });
}

export function filterRunningModelsByKeyword(
  items: XinferenceRunningModel[],
  keyword: string,
): XinferenceRunningModel[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return items;
  return items.filter((m) => {
    const hay = [
      m.modelUid,
      m.modelName,
      m.modelEngine,
      m.modelFormat,
      m.sizeInBillions,
      m.quantization,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(kw);
  });
}

export function fmtContextLength(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M 上下文长度`;
  if (n >= 1000) return `${Math.round(n / 1024)}K 上下文长度`;
  return `${n} 上下文长度`;
}

export type { GalleryFilterState } from './galleryFilters';
export {
  DEFAULT_GALLERY_FILTER,
  filterGalleryRegistrations,
  hasActiveGalleryFilter,
} from './galleryFilters';

export function collectAbilityOptions(items: XinferenceModelRegistration[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    for (const a of item.abilities) set.add(a);
  }
  return Array.from(set).sort();
}
