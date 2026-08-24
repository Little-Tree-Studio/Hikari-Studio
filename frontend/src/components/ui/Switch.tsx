import type { ComponentProps } from 'react';
import { Switch as RadixSwitch } from 'radix-ui';

export type SwitchProps = Omit<ComponentProps<typeof RadixSwitch.Root>, 'asChild' | 'checked' | 'onCheckedChange' | 'onChange'> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function Switch({ checked, onChange, className = '', ...rest }: SwitchProps) {
  return <RadixSwitch.Root className={`ds-switch ${className}`.trimEnd()} checked={checked} onCheckedChange={onChange} {...rest}>
    <RadixSwitch.Thumb className="ds-switch-thumb" />
  </RadixSwitch.Root>;
}
