import { useEffect, useMemo, useState } from 'react';

type WaveformData = { peaks: number[]; duration: number };
const waveformCache = new Map<string, Promise<WaveformData>>();

async function decodeWaveform(uri: string): Promise<WaveformData> {
  const cached = waveformCache.get(uri);
  if (cached) return cached;
  const task = (async () => {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`Audio ${response.status}`);
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const source = buffer.getChannelData(0);
      const columns = 320;
      const stride = Math.max(1, Math.floor(source.length / columns));
      const peaks = Array.from({ length: columns }, (_, column) => {
        let peak = 0;
        const end = Math.min(source.length, (column + 1) * stride);
        for (let index = column * stride; index < end; index += Math.max(1, Math.floor(stride / 24))) peak = Math.max(peak, Math.abs(source[index]));
        return peak;
      });
      const maximum = Math.max(.001, ...peaks);
      return { peaks: peaks.map((peak) => peak / maximum), duration: buffer.duration };
    } finally {
      void context.close();
    }
  })();
  waveformCache.set(uri, task);
  task.catch(() => waveformCache.delete(uri));
  return task;
}

export function AudioWaveform({ uri, offset = 0, duration }: { uri?: string; offset?: number; duration: number }) {
  const [data, setData] = useState<WaveformData>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setData(undefined); setFailed(false);
    if (!uri) { setFailed(true); return () => { active = false; }; }
    void decodeWaveform(uri).then((value) => { if (active) setData(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [uri]);
  const path = useMemo(() => {
    if (!data) return '';
    const start = Math.max(0, Math.floor(offset / data.duration * data.peaks.length));
    const end = Math.max(start + 1, Math.min(data.peaks.length, Math.ceil((offset + duration) / data.duration * data.peaks.length)));
    const visible = data.peaks.slice(start, end);
    const top = visible.map((peak, index) => `${index ? 'L' : 'M'}${index / Math.max(1, visible.length - 1) * 100},${16 - peak * 13}`).join(' ');
    const bottom = [...visible].reverse().map((peak, reverseIndex) => { const index = visible.length - 1 - reverseIndex; return `L${index / Math.max(1, visible.length - 1) * 100},${16 + peak * 13}`; }).join(' ');
    return `${top} ${bottom} Z`;
  }, [data, duration, offset]);
  if (failed) return <span className="timeline-waveform-status">波形不可用</span>;
  if (!data) return <span className="timeline-waveform-status loading">正在分析</span>;
  return <svg className="timeline-waveform" viewBox="0 0 100 32" preserveAspectRatio="none" aria-label="音频波形"><path d={path} /></svg>;
}
