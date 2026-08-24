import { describe, expect, it } from 'vitest';
import { applyLanguage, collectTextSlots, languageProgress, slotVoice, translationKey } from '../localization';
import type { Project } from '../../types';

function fixtureProject(): Project {
  return {
    version: 3,
    meta: { id: 'test', name: '测试', author: '', resolution: [1280, 720], updatedAt: '' },
    characters: [],
    chapters: [{ id: 'c1', name: '第一章', fragments: [{ id: 'frag1', name: '片段一' }] }],
    activeFragmentId: 'frag1',
    scripts: {
      frag1: [
        { id: 'n1', type: 'narration', text: '旁白原文' },
        { id: 'd1', type: 'dialogue', speaker: '林澄', text: '对白原文', voice: 'v-zh' },
        { id: 'b1', type: 'branch', title: '选择标题', options: [{ text: '选项一', target: 'frag1' }, { text: '选项二', target: 'frag1' }] },
      ],
    },
    assets: [],
    variables: {},
    settings: { textSpeed: 30, autoSave: false, skipRead: false },
    locale: { default: 'zh-CN', languages: ['zh-CN', 'en-US'] },
    translations: {
      'en-US': {
        'frag1::n1': { text: 'narration text' },
        'frag1::d1': { text: 'dialogue text', voice: 'v-en' },
        'frag1::b1': { title: 'make a choice', options: ['opt one'] },
      },
    },
  };
}

describe('collectTextSlots', () => {
  it('列出旁白、对白、分支标题与全部选项', () => {
    const slots = collectTextSlots(fixtureProject());
    expect(slots.map((slot) => slot.kind)).toEqual(['narration', 'dialogue', 'branchTitle', 'branchOption', 'branchOption']);
    expect(slots[3].optionIndex).toBe(0);
    expect(slots[4].optionIndex).toBe(1);
    expect(slots.every((slot) => slot.key === translationKey(slot.fragmentId, slot.blockId))).toBe(true);
  });
});

describe('applyLanguage', () => {
  it('替换文本、标题、选项并为缺失选项回退默认语言', () => {
    const localized = applyLanguage(fixtureProject(), 'en-US');
    const blocks = localized.scripts.frag1;
    expect(blocks[0].text).toBe('narration text');
    expect(blocks[1].text).toBe('dialogue text');
    expect(blocks[2].title).toBe('make a choice');
    expect(blocks[2].options?.[0].text).toBe('opt one');
    expect(blocks[2].options?.[1].text).toBe('选项二');
    expect(blocks[2].options?.[1].target).toBe('frag1');
  });

  it('默认语言与未知语言返回原项目引用', () => {
    const project = fixtureProject();
    expect(applyLanguage(project, 'zh-CN')).toBe(project);
    expect(applyLanguage(project, 'fr-FR')).toBe(project);
    expect(applyLanguage(project, undefined)).toBe(project);
  });

  it('空语音字符串清除默认语言语音', () => {
    const project = fixtureProject();
    project.translations!['en-US']!['frag1::d1'] = { text: 'dialogue text', voice: '' };
    const block = applyLanguage(project, 'en-US').scripts.frag1[1];
    expect(block.voice).toBeUndefined();
  });

  it('切换语言语音并保留目标', () => {
    const project = fixtureProject();
    const block = applyLanguage(project, 'en-US').scripts.frag1[1];
    expect(block.voice).toBe('v-en');
    expect(block.voice).toBe(slotVoice(project, 'en-US', collectTextSlots(project)[1]));
  });

  it('不修改原始项目', () => {
    const project = fixtureProject();
    applyLanguage(project, 'en-US');
    expect(project.scripts.frag1[0].text).toBe('旁白原文');
  });
});

describe('languageProgress', () => {
  it('统计已填充翻译比例', () => {
    const progress = languageProgress(fixtureProject(), 'en-US');
    expect(progress.total).toBe(5);
    expect(progress.filled).toBe(4);
    expect(progress.percent).toBe(80);
  });

  it('无翻译表时按零进度统计', () => {
    const project = fixtureProject();
    project.translations = undefined;
    const progress = languageProgress(project, 'en-US');
    expect(progress.filled).toBe(0);
  });
});
