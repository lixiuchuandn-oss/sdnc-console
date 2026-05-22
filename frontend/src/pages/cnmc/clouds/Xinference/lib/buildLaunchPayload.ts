import type { XinferenceLaunchModelPayload } from '../../../../../services/xinferenceApi';
import type { LaunchFormValues } from './launchModelForm';

const LAUNCH_PAYLOAD_KEYS = new Set([
  'model_uid',
  'model_name',
  'model_type',
  'model_engine',
  'model_format',
  'model_size_in_billions',
  'quantization',
  'n_worker',
  'n_gpu',
  'n_gpu_layers',
  'replica',
  'request_limits',
  'worker_ip',
  'gpu_idx',
  'download_hub',
  'model_path',
  'reasoning_content',
  'gguf_quantization',
  'gguf_model_path',
  'lightning_version',
  'lightning_model_path',
  'cpu_offload',
  'peft_model_config',
  'quantization_config',
  'enable_thinking',
  'multimodal_projector',
  'enable_virtual_env',
  'virtual_env_packages',
  'envs',
]);

function normalizeNGpu(raw: string | number | undefined): string | number | null | undefined {
  if (raw == null || raw === '') return 'auto';
  const s = String(raw).trim();
  if (s === 'CPU') return null;
  if (s === 'auto' || s === 'GPU') return 'auto';
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 'auto';
}

/** 按 Xinference 官方 UI 规则组装启动 payload */
export function buildLaunchPayload(
  modelName: string,
  modelType: string,
  values: LaunchFormValues,
): XinferenceLaunchModelPayload {
  const payload: Record<string, unknown> = {
    model_name: modelName,
    model_type: modelType,
  };

  if (values.model_engine) payload.model_engine = values.model_engine;
  if (values.model_format) payload.model_format = values.model_format;
  if (values.model_size_in_billions) payload.model_size_in_billions = values.model_size_in_billions;
  if (values.quantization) payload.quantization = values.quantization;
  if (values.multimodal_projector) payload.multimodal_projector = values.multimodal_projector;

  const uid = values.model_uid?.trim();
  if (uid) payload.model_uid = uid;

  const nGpu = normalizeNGpu(values.n_gpu);
  if (nGpu !== undefined) payload.n_gpu = nGpu;

  if (values.n_gpu_layers != null && values.n_gpu_layers >= 0) {
    payload.n_gpu_layers = values.n_gpu_layers;
  }

  if (values.replica != null) payload.replica = values.replica;
  if (values.request_limits != null && values.request_limits > 0) {
    payload.request_limits = values.request_limits;
  }

  const hub = values.download_hub?.trim();
  if (hub && hub !== 'none') payload.download_hub = hub;

  const modelPath = values.model_path?.trim();
  if (modelPath) payload.model_path = modelPath;

  if (values.enable_thinking != null) payload.enable_thinking = values.enable_thinking;
  if (values.reasoning_content != null) payload.reasoning_content = values.reasoning_content;

  const gpuIdx = values.gpu_idx?.trim();
  if (gpuIdx) {
    payload.gpu_idx = gpuIdx
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n));
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (!LAUNCH_PAYLOAD_KEYS.has(key)) continue;
    if (val === undefined || val === null || val === '') continue;
    cleaned[key] = val;
  }

  return cleaned as XinferenceLaunchModelPayload;
}
