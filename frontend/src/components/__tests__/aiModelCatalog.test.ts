import { describe, expect, it } from 'vitest';
import type { AiModelInfo } from '../../types';
import { groupModels, recommendedModelId } from '../aiModelCatalog';

const models: AiModelInfo[] = [
  { id: 'custom', name: 'Custom', category: 'unknown', source: 'upstream', supportsTools: false, supportsVision: false, supportsStructuredOutput: false, health: 'unknown', healthScore: 0 },
  { id: 'reasoner', name: 'Reasoner', category: 'reasoning', source: 'upstream', supportsTools: true, supportsVision: false, supportsStructuredOutput: true, recommended: true, health: 'healthy', healthScore: 95 },
  { id: 'fast', name: 'Fast', category: 'fast', source: 'upstream', supportsTools: true, supportsVision: false, supportsStructuredOutput: true, health: 'healthy', healthScore: 90 },
];

describe('AI model catalog', () => {
  it('groups models in the stable editor order', () => {
    expect(groupModels(models).map((group) => group.category)).toEqual(['reasoning', 'fast', 'unknown']);
  });

  it('prefers the server recommendation and falls back to the marked model', () => {
    expect(recommendedModelId(models, 'fast')).toBe('fast');
    expect(recommendedModelId(models, 'missing')).toBe('reasoner');
  });

  it('does not auto-select an unavailable model after health probing', () => {
    const unavailable = models.map((model) => ({ ...model, recommended: false, health: 'unavailable' as const, healthScore: 0 }));
    expect(recommendedModelId(unavailable)).toBeUndefined();
  });
});
