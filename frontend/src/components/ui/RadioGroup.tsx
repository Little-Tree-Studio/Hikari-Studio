import type { ComponentProps, ReactNode } from 'react';
import { RadioGroup as RadixRadioGroup } from 'radix-ui';

export type RadioGroupProps = Omit<ComponentProps<typeof RadixRadioGroup.Root>, 'asChild' | 'value' | 'onValueChange' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
};

export function RadioGroup({ value, onChange, children, className = '', ...rest }: RadioGroupProps) {
  return <RadixRadioGroup.Root className={`ds-radio-group ${className}`.trimEnd()} value={value} onValueChange={onChange} {...rest}>{children}</RadixRadioGroup.Root>;
}

export type RadioProps = Omit<ComponentProps<typeof RadixRadioGroup.Item>, 'asChild'>;

export function Radio({ className = '', children, ...rest }: RadioProps) {
  return <RadixRadioGroup.Item className={`ds-radio ${className}`.trimEnd()} {...rest}>
    <span className="ds-radio-dot" aria-hidden="true" />
    {children != null && <span className="ds-radio-label">{children}</span>}
  </RadixRadioGroup.Item>;
}
