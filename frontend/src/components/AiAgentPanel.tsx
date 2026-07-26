import { useEffect, useState } from 'react';
import { Bot, Check, KeyRound, LoaderCircle, Play, Settings2, Sparkles } from 'lucide-react';
import { getAiSettings, runAiAgent, saveAiSettings } from '../api';
import type { AgentPlan, AiSettingsInput, Project } from '../types';

interface AiAgentPanelProps {
  project: Project;
  applyPlan: (plan: AgentPlan) => void;
  notify: (message: string, tone?: 'error' | 'success') => void;
}

const operationName = { add_blocks: '添加 Block', create_fragment: '创建片段', update_project: '更新项目信息' };

export function AiAgentPanel({ project, applyPlan, notify }: AiAgentPanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AiSettingsInput>({ url: 'https://api.openai.com/v1', model: 'gpt-5-mini', temperature: 0.4, apiKey: '' });
  const [hasKey, setHasKey] = useState(false);
  const [instruction, setInstruction] = useState('为当前片段补写一段有悬念的角色对话，并给玩家三个会影响后续剧情的选择。');
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getAiSettings().then((value) => {
      setSettings({ url: value.url, model: value.model, temperature: value.temperature, apiKey: '' });
      setHasKey(value.hasKey);
    }).catch(() => undefined);
  }, []);

  const save = async () => {
    try {
      setBusy(true);
      const result = await saveAiSettings(settings);
      setHasKey(result.hasKey);
      setSettings((current) => ({ ...current, apiKey: '' }));
      setSettingsOpen(false);
      notify('AI 服务配置已保存');
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    try {
      setBusy(true);
      setPlan(null);
      setPlan(await runAiAgent(instruction, project));
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return <div className="agent-page">
    <header className="agent-header"><div><span className="agent-kicker"><Sparkles /> AI 制作 Agent</span><h1>把制作目标交给 Agent</h1><p>Agent 会读取当前项目并生成可审查的结构化改动，确认后才写入项目。</p></div><button className="button ghost" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 />服务配置</button></header>
    {settingsOpen && <section className="agent-settings"><div className="field full"><label>OpenAI 兼容 API URL</label><input value={settings.url} onChange={(event) => setSettings({ ...settings, url: event.target.value })} placeholder="https://api.openai.com/v1" /></div><div className="field"><label>模型</label><input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></div><div className="field"><label>Temperature</label><input type="number" min="0" max="1.5" step="0.1" value={settings.temperature} onChange={(event) => setSettings({ ...settings, temperature: Number(event.target.value) })} /></div><div className="field full"><label>API Key {hasKey && <span className="configured"><Check />已安全保存</span>}</label><div className="key-input"><KeyRound /><input type="password" value={settings.apiKey} onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })} placeholder={hasKey ? '留空以继续使用已保存密钥' : 'sk-...'} /></div></div><button className="button primary" disabled={busy} onClick={() => void save()}><Check />保存配置</button></section>}
    <div className="agent-workspace"><section className="agent-compose"><div className="agent-section-title"><Bot /><div><strong>制作需求</strong><span>当前上下文：{project.meta.name} / {project.activeFragmentId}</span></div></div><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} /><div className="agent-actions"><span>{hasKey ? '服务已配置' : '需要先填写 API Key'}</span><button className="button primary" disabled={busy || !instruction.trim() || !hasKey} onClick={() => void run()}>{busy ? <LoaderCircle className="spin" /> : <Play />}生成制作计划</button></div></section>
      <section className="agent-result"><div className="agent-section-title"><Sparkles /><div><strong>变更预览</strong><span>应用后可使用撤销恢复</span></div></div>{!plan && <div className="agent-empty"><Bot /><strong>等待制作任务</strong><span>Agent 的修改不会自动写入项目。</span></div>}{plan && <><div className="plan-summary"><strong>{plan.summary}</strong>{plan.assumptions.map((item) => <span key={item}>{item}</span>)}</div><div className="operation-list">{plan.operations.map((operation, index) => <article key={index}><span>{index + 1}</span><div><strong>{operationName[operation.type]}</strong><small>{operation.type === 'add_blocks' ? `${operation.fragmentId} · ${operation.blocks.length} Blocks` : operation.type === 'create_fragment' ? `${operation.name} · ${operation.blocks.length} Blocks` : [operation.name, operation.author].filter(Boolean).join(' / ')}</small></div></article>)}</div><button className="button primary apply-plan" onClick={() => { applyPlan(plan); setPlan(null); }}><Check />确认并应用 {plan.operations.length} 项修改</button></>}</section>
    </div>
  </div>;
}
