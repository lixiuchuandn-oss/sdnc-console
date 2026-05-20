export const ENGINE_OPTIONS = [
  { label: 'vLLM', value: 'vllm' },
  { label: 'SGLang', value: 'sglang' },
  { label: 'llama.cpp', value: 'llama.cpp' },
  { label: 'Transformers', value: 'transformers' },
  { label: 'MLX', value: 'MLX' },
];

export const FORMAT_OPTIONS = [
  { label: 'pytorch', value: 'pytorch' },
  { label: 'ggufv2', value: 'ggufv2' },
  { label: 'gptq', value: 'gptq' },
  { label: 'awq', value: 'awq' },
];

export type LaunchFormValues = {
  model_type: string;
  model_name: string;
  model_engine?: string;
  model_size_in_billions?: string;
  model_format?: string;
  quantization?: string;
  model_uid?: string;
  n_gpu?: string;
  replica?: number;
};

function pickStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x)).filter(Boolean);
}

export function hintsFromRegistrationDetail(detail: Record<string, unknown>) {
  const specs = Array.isArray(detail.model_specs) ? detail.model_specs : [];
  const first = specs[0] && typeof specs[0] === 'object' ? (specs[0] as Record<string, unknown>) : null;
  return {
    model_engine: pickStringList(first?.model_engines ?? detail.model_engines)[0],
    model_format: pickStringList(first?.model_formats ?? detail.model_formats)[0],
    model_size_in_billions: pickStringList(first?.model_sizes_in_billions ?? detail.model_sizes_in_billions)[0],
  };
}
