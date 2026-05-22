import type { XinferenceGalleryModelType } from './xinferenceModelRegistry';

/** 按当前 Tab 类型预填 Xinference 自定义模型注册 JSON（见官方 custom models 文档） */
export function registerModelTemplateJson(modelType: XinferenceGalleryModelType): string {
  const templates: Record<XinferenceGalleryModelType, object> = {
    LLM: {
      version: 1,
      context_length: 8192,
      model_name: 'custom-llm',
      model_lang: ['en', 'zh'],
      model_ability: ['chat', 'generate'],
      model_family: 'other',
      model_description: '',
      model_specs: [
        {
          model_format: 'pytorch',
          model_size_in_billions: 7,
          quantizations: ['none'],
          model_id: 'org/model-on-huggingface',
          model_uri: 'file:///path/to/model',
        },
      ],
    },
    embedding: {
      model_name: 'custom-embedding',
      dimensions: 768,
      max_tokens: 512,
      language: ['en', 'zh'],
      model_id: 'BAAI/bge-base-en-v1.5',
      model_uri: 'file:///path/to/embedding-model',
    },
    rerank: {
      model_name: 'custom-rerank',
      type: 'normal',
      language: ['en', 'zh', 'multilingual'],
      model_id: 'BAAI/bge-reranker-base',
      model_uri: 'file:///path/to/rerank-model',
    },
    image: {
      model_name: 'custom-image',
      model_family: 'stable_diffusion',
      model_specs: [
        {
          model_format: 'pytorch',
          model_uri: 'file:///path/to/image-model',
        },
      ],
    },
    audio: {
      model_name: 'custom-audio',
      model_family: 'whisper',
      multilingual: true,
      model_specs: [
        {
          model_format: 'pytorch',
          model_uri: 'file:///path/to/audio-model',
        },
      ],
    },
    video: {
      model_name: 'custom-video',
      model_family: 'other',
      model_specs: [
        {
          model_format: 'pytorch',
          model_uri: 'file:///path/to/video-model',
        },
      ],
    },
    flexible: {
      model_name: 'custom-flexible',
      model_uri: 'file:///path/to/model',
    },
  };
  return JSON.stringify(templates[modelType], null, 2);
}
