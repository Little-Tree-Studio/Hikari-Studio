import type { AiModelCategory, AiModelInfo } from '../types';

export const MODEL_CATEGORY_ORDER: AiModelCategory[] = ['reasoning', 'general', 'vision', 'fast', 'unknown'];

export const MODEL_CATEGORY_LABEL: Record<AiModelCategory, string> = {
  reasoning: '推理模型',
  general: '通用文本',
  vision: '视觉模型',
  fast: '快速低成本',
  unknown: '未识别模型',
};

export function groupModels(models: AiModelInfo[]): Array<{ category: AiModelCategory; models: AiModelInfo[] }> {
  return MODEL_CATEGORY_ORDER
    .map((category) => ({ category, models: models.filter((model) => model.category === category) }))
    .filter((group) => group.models.length > 0);
}

export function recommendedModelId(models: AiModelInfo[], upstreamRecommendation?: string): string | undefined {
  if (upstreamRecommendation && models.some((model) => model.id === upstreamRecommendation)) return upstreamRecommendation;
  const marked = models.find((model) => model.recommended)?.id;
  if (marked) return marked;
  const healthy = models.find((model) => model.health === 'healthy' && model.supportsTools)?.id;
  if (healthy) return healthy;
  return models.every((model) => model.health === 'unknown') ? models[0]?.id : undefined;
}
