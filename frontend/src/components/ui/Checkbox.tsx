import type { ComponentProps } from 'react';
import { Checkbox as RadixCheckbox } from 'radix-ui';
import { Check, Minus } from 'lucide-react';

export type CheckboxProps = Omit<ComponentProps<typeof RadixCheckbox.Root>, 'asChild' | 'checked' | 'onCheckedChange' | 'onChange'> & {
  checked: boolean | 'indeterminate';
  onChange: (checked: boolean) => void;
};

export function Checkbox({ checked, onChange, className = '', ...rest }: CheckboxProps) {
  return <RadixCheckbox.Root className={`ds-checkbox ${className}`.trimEnd()} checked={checked} onCheckedChange={(next) => onChange(next === true)} {...rest}>
    <RadixCheckbox.Indicator className="ds-checkbox-indicator">{checked === 'indeterminate' ? <Minus size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}</RadixCheckbox.Indicator>
  </RadixCheckbox.Root>;
}
