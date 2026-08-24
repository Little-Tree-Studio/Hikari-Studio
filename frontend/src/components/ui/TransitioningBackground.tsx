import { useEffect, useState } from 'react';

interface TransitionLayer {
  key: number;
  src: string;
  entered: boolean;
}

interface TransitioningBackgroundProps {
  src: string;
  transition?: string;
  duration: number;
  opacity?: number;
  className: string;
  alt?: string;
}

/**
 * 带场景过渡的背景图层：新背景在旧背景之上淡入（fade/dissolve/crossfade 统一
 * 为交叉溶解），duration <= 0 或 transition 为 none 时立即切换。
 * 两层都使用调用方提供的 className，因此必须为绝对定位样式。
 */
export function TransitioningBackground({ src, transition, duration, opacity = 1, className, alt = '' }: TransitioningBackgroundProps) {
  const [layers, setLayers] = useState<TransitionLayer[]>([]);
  const animated = (transition ?? 'none') !== 'none' && duration > 0;

  useEffect(() => {
    if (!src) {
      setLayers([]);
      return;
    }
    setLayers((current) => {
      const last = current[current.length - 1];
      if (last?.src === src) return current;
      return animated ? [...current.slice(-1), { key: Date.now(), src, entered: false }] : [{ key: Date.now(), src, entered: true }];
    });
  }, [src, animated]);

  useEffect(() => {
    const entering = layers.find((layer) => !layer.entered);
    if (!entering) return;
    // 双 rAF：等首帧完成绘制后再翻转 opacity，确保 CSS 过渡生效。
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      setLayers((current) => current.map((layer) => layer.key === entering.key ? { ...layer, entered: true } : layer));
    }));
    const timer = window.setTimeout(() => {
      setLayers((current) => current.length > 1 ? current.slice(-1) : current);
    }, Math.max(0, duration) * 1000 + 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [layers, duration]);

  return <>
    {layers.map((layer, index) => (
      <img
        key={layer.key}
        className={className}
        src={layer.src}
        alt={alt}
        style={{
          opacity: index === layers.length - 1 && layer.entered ? opacity : 0,
          transition: animated ? `opacity ${Math.max(0, duration)}s ease` : undefined,
        }}
      />
    ))}
  </>;
}
