export type LaunchFormValues = {
  model_type: string;
  model_name: string;
  model_engine?: string;
  model_size_in_billions?: string;
  model_format?: string;
  quantization?: string;
  multimodal_projector?: string;
  model_uid?: string;
  n_gpu?: string;
  n_gpu_layers?: number;
  replica?: number;
  download_hub?: string;
  request_limits?: number;
  model_path?: string;
  enable_thinking?: boolean;
  reasoning_content?: boolean;
  gpu_idx?: string;
};

export const DOWNLOAD_HUB_OPTIONS = [
  { label: 'ModelScope', value: 'modelscope' },
  { label: 'Hugging Face', value: 'huggingface' },
  { label: 'CSGHub', value: 'csghub' },
  { label: '不指定', value: 'none' },
];

export function totalClusterGpuCount(
  workerDetails: { gpuCount: number }[],
  workersSummaryGpu: number,
  supervisorGpu: number,
): number {
  const fromNodes = workerDetails.reduce((s, w) => s + (w.gpuCount || 0), 0);
  return Math.max(fromNodes, workersSummaryGpu, supervisorGpu, 0);
}

export function buildNGpuOptions(gpuCount: number): { label: string; value: string }[] {
  const opts: { label: string; value: string }[] = [{ label: 'auto', value: 'auto' }];
  const max = gpuCount > 0 ? gpuCount : 8;
  for (let i = 1; i <= max; i++) {
    opts.push({ label: String(i), value: String(i) });
  }
  return opts;
}

export function defaultLaunchFormValues(modelType: string, modelName: string): LaunchFormValues {
  return {
    model_type: modelType,
    model_name: modelName,
    n_gpu: 'auto',
    replica: 1,
    download_hub: 'modelscope',
    n_gpu_layers: -1,
    enable_thinking: true,
    reasoning_content: false,
  };
}
