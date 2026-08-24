import { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { Project } from '../types';
import { Select } from './ui/Select';
import { Slider } from './ui/Slider';
import { Switch } from './ui/Switch';

interface RuntimeSettingsSectionProps {
  project: Project;
  apply: (settings: Project['settings'], resolution: [number, number]) => void;
}

export function RuntimeSettingsSection({ project, apply }: RuntimeSettingsSectionProps) {
  const [settings, setSettings] = useState(project.settings);
  const [resolution, setResolution] = useState<[number, number]>(project.meta.resolution);
  const reset = () => { setSettings(project.settings); setResolution(project.meta.resolution); };
  return <>
    <div className="settings-page-body settings-grid">
      <div className="field full"><label>游戏分辨率</label><Select value={`${resolution[0]}x${resolution[1]}`} onChange={(value) => { const [width, height] = value.split('x').map(Number); setResolution([width, height]); }}><option value="1280x720">1280 × 720</option><option value="1600x900">1600 × 900</option><option value="1920x1080">1920 × 1080</option></Select></div>
      <div className="field full"><label>文本速度 · {settings.textSpeed} 字/秒</label><Slider ariaLabel="文本速度" min={10} max={100} value={settings.textSpeed} onChange={(value) => setSettings({ ...settings, textSpeed: value })} /></div>
      <div className="field full"><label>自动播放间隔 · {(settings.autoPlayDelay ?? 1.5).toFixed(1)} 秒</label><Slider ariaLabel="自动播放间隔" min={0.5} max={5} step={0.1} value={settings.autoPlayDelay ?? 1.5} onChange={(value) => setSettings({ ...settings, autoPlayDelay: value })} /></div>
      {([['autoSave', '自动保存项目'], ['autoPlay', '预览默认自动播放'], ['fastForward', '允许快进'], ['skipRead', '只跳过已读文本']] as const).map(([key, label]) => <label className="setting-toggle" key={key}><span>{label}</span><Switch checked={settings[key] ?? false} onChange={(checked) => setSettings({ ...settings, [key]: checked })} /></label>)}
    </div>
    <footer className="settings-page-footer"><button className="button ghost" onClick={reset}><RotateCcw />重置</button><button className="button primary" onClick={() => apply(settings, resolution)}><Check />应用设置</button></footer>
  </>;
}
