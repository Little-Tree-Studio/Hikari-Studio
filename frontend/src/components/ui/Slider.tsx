import { Slider as RadixSlider } from 'radix-ui';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function Slider({ value, onChange, min, max, step, disabled, className = '', ariaLabel }: SliderProps) {
  return <RadixSlider.Root className={`ds-slider ${className}`.trimEnd()} value={[value]} onValueChange={(values) => onChange(values[0])} min={min} max={max} step={step} disabled={disabled}>
    <RadixSlider.Track className="ds-slider-track"><RadixSlider.Range className="ds-slider-range" /></RadixSlider.Track>
    <RadixSlider.Thumb className="ds-slider-thumb" aria-label={ariaLabel} />
  </RadixSlider.Root>;
}
