import { useEffect, useState } from 'react';
import { Activity, Check, Database, KeyRound, LoaderCircle, RefreshCw, Star, Trash2 } from 'lucide-react';
import { clearAiKey, discoverAiModels, getAiSettings, saveAiSettings } from '../api';
import type { AiModelDiscovery, AiSettingsInput } from '../types';
import { groupModels, MODEL_CATEGORY_LABEL, recommendedModelId } from './aiModelCatalog';

interface AiProviderSettingsSectionProps {
  notify: (message: string, tone?: 'error' | 'success') => void;
  onKeyStatusChange?: (hasKey: boolean) => void;
}

export function AiProviderSettingsSection({ notify, onKeyStatusChange }: AiProviderSettingsSectionProps) {
  const [settings, setSettings] = useState<AiSettingsInput>({ url: 'https://api.openai.com/v1', model: 'gpt-5-mini', fallbackModels: [], temperature: 0.4, apiKey: '' });
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<AiModelDiscovery | null>(null);

  useEffect(() => {
    void getAiSettings().then((value) => {
      setSettings({ url: value.url, model: value.model, fallbackModels: value.fallbackModels, temperature: value.temperature, apiKey: '' });
      setHasKey(value.hasKey);
      onKeyStatusChange?.(value.hasKey);
    }).catch(() => undefined);
  }, []);

  const save = async () => {
    try {
      setBusy(true);
      const result = await saveAiSettings(settings);
      setHasKey(result.hasKey);
      onKeyStatusChange?.(result.hasKey);
      setSettings((current) => ({ ...current, apiKey: '' }));
      notify('AI 服务配置已保存');
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    try {
      setBusy(true);
      const result = await clearAiKey();
      setHasKey(result.hasKey);
      onKeyStatusChange?.(result.hasKey);
      setSettings((current) => ({ ...current, apiKey: '' }));
      notify('已从本机清除保存的 API Key');
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const discover = async () => {
    try {
      setDiscovering(true);
      const result = await discoverAiModels(settings);
      setDiscovery(result);
      const recommended = recommendedModelId(result.models, result.recommendedModelId);
      setSettings((current) => {
        const selected = result.models.find((model) => model.id === current.model);
        const model = recommended ?? (selected?.health === 'unavailable' ? '' : current.model);
        return { ...current, model, fallbackModels: result.fallbackModelIds ?? [] };
      });
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setDiscovering(false);
    }
  };

  return <div className="settings-page-body agent-settings ai-provider-settings">
    <div className="field full"><label>OpenAI 兼容 API URL</label><input value={settings.url} onChange={(event) => { setSettings({ ...settings, url: event.target.value }); setDiscovery(null); }} placeholder="https://api.openai.com/v1" /></div>
    <div className="field full"><label>API Key {hasKey && <span className="configured"><Check />已安全保存</span>}</label><div className="key-input"><KeyRound /><input type="password" value={settings.apiKey} onChange={(event) => { setSettings({ ...settings, apiKey: event.target.value }); setDiscovery(null); }} placeholder={hasKey ? '留空以继续使用已保存密钥' : 'sk-...'} />{hasKey && <button className="button ghost" title="清除已保存的 API Key" disabled={busy} onClick={() => void clearKey()}><Trash2 />清除</button>}</div></div>
    <div className="model-discovery-toolbar full"><div><strong>模型目录与健康探测</strong><span>读取 /models，并对高分候选验证连接和工具调用</span></div><button className="button ghost" disabled={discovering || !settings.url.trim()} onClick={() => void discover()}>{discovering ? <LoaderCircle className="spin" /> : <RefreshCw />}发现并探测</button></div>
    {discovery && <div className="model-catalog full">
      <header><span><Database />{discovery.source === 'upstream' ? '上游模型目录' : '内置模型目录'}</span><small>{discovery.models.length} 个模型{discovery.catalogCached ? ' · 目录缓存' : ''}{discovery.healthCache ? ` · 健康缓存 ${discovery.healthCache.cachedHits} · 新探测 ${discovery.healthCache.probed}` : ''}</small></header>
      {discovery.warning && <p className="model-warning">{discovery.warning}</p>}
      <div className="model-groups">{groupModels(discovery.models).map((group) => <section key={group.category}><strong>{MODEL_CATEGORY_LABEL[group.category]}</strong><div>{group.models.map((model) => <button type="button" className={`${settings.model === model.id ? 'active' : ''} health-${model.health}`} key={model.id} title={model.healthMessage} onClick={() => setSettings({ ...settings, model: model.id, fallbackModels: (discovery.fallbackModelIds ?? []).filter((id) => id !== model.id) })}><span>{model.name}{model.recommended && <em><Star />推荐</em>}</span><small>{model.id}</small><i>{[model.supportsTools && '工具', model.supportsStructuredOutput && '结构化', model.supportsVision && '视觉'].filter(Boolean).join(' · ') || '能力未知'}</i><b><Activity />{model.circuitState === 'open' ? '熔断冷却中' : model.health === 'healthy' ? '健康' : model.health === 'degraded' ? '降级' : model.health === 'unavailable' ? '不可用' : '未探测'}{model.latencyMs ? ` · ${model.latencyMs} ms` : ''}{model.health !== 'unknown' ? ` · ${model.healthScore} 分` : ''}</b></button>)}</div></section>)}</div>
    </div>}
    <div className="field"><label>模型 ID（可手动输入）</label><input value={settings.model} onChange={(event) => { setSettings({ ...settings, model: event.target.value }); }} placeholder="输入上游支持的模型 ID" /></div>
    <div className="field"><label>Temperature</label><input type="number" min="0" max="1.5" step="0.1" value={settings.temperature} onChange={(event) => { setSettings({ ...settings, temperature: Number(event.target.value) }); }} /></div>
    <div className="agent-settings-actions full"><span>{settings.fallbackModels?.length ? `已准备 ${settings.fallbackModels.length} 个自动回退模型` : '发现和选择不会自动保存'}</span><button className="button primary" disabled={busy || !settings.model.trim()} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" /> : <Check />}保存配置</button></div>
  </div>;
}
