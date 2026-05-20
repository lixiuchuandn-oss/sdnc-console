import type { XinferenceModelRegistration } from '../../../../../services/xinferenceApi';

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

export function fmtContextLength(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M 上下文长度`;
  if (n >= 1000) return `${Math.round(n / 1024)}K 上下文长度`;
  return `${n} 上下文长度`;
}

export type GalleryFilterState = {
  keyword: string;
  ability: string | null;
  status: 'all' | 'running' | 'idle';
};

export function filterGalleryRegistrations(
  items: XinferenceModelRegistration[],
  runningModelNames: Set<string>,
  filter: GalleryFilterState,
): XinferenceModelRegistration[] {
  const kw = filter.keyword.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.ability && !item.abilities.includes(filter.ability)) return false;
    const running = runningModelNames.has(item.modelName);
    if (filter.status === 'running' && !running) return false;
    if (filter.status === 'idle' && running) return false;
    if (!kw) return true;
    const hay = `${item.modelName} ${item.description ?? ''}`.toLowerCase();
    return hay.includes(kw);
  });
}

export function collectAbilityOptions(items: XinferenceModelRegistration[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    for (const a of item.abilities) set.add(a);
  }
  return Array.from(set).sort();
}
