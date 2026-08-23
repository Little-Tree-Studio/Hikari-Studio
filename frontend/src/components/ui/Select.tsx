import { Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Select as RadixSelect } from 'radix-ui';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

const EMPTY = '\uE000';

interface SelectOption { value: string; label: ReactNode; disabled: boolean }
interface SelectGroup { label: string; options: SelectOption[] }
type SelectEntry = SelectOption | SelectGroup;

type OptionElement = ReactElement<{ value?: string; children?: ReactNode; disabled?: boolean }>;
type OptgroupElement = ReactElement<{ label?: string; children?: ReactNode }>;

function readOption(element: OptionElement): SelectOption {
  const { value, children, disabled } = element.props;
  return { value: value ?? '', label: children ?? '', disabled: disabled === true };
}

function readEntries(children: ReactNode): SelectEntry[] {
  const entries: SelectEntry[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue;
    if (child.type === 'option') entries.push(readOption(child as OptionElement));
    else if (child.type === 'optgroup') {
      const { label, children: groupChildren } = (child as OptgroupElement).props;
      entries.push({ label: label ?? '', options: Children.toArray(groupChildren).filter(isValidElement).map((item) => readOption(item as OptionElement)) });
    }
  }
  return entries;
}

export type SelectProps = Omit<ComponentProps<typeof RadixSelect.Trigger>, 'asChild' | 'children' | 'value' | 'onChange'> & {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  children: ReactNode;
  placeholder?: string;
};

function toRootValue(value: string | undefined) {
  return value === undefined ? undefined : value === '' ? EMPTY : value;
}

function SelectItem({ option }: { option: SelectOption }) {
  const value = option.value === '' ? EMPTY : option.value;
  return <RadixSelect.Item className="ds-select-item" value={value} disabled={option.disabled} data-value={option.value}>
    <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
    <RadixSelect.ItemIndicator className="ds-select-item-indicator"><Check size={13} /></RadixSelect.ItemIndicator>
  </RadixSelect.Item>;
}

export function Select({ value, defaultValue, onChange, children, placeholder, className = '', disabled, ...rest }: SelectProps) {
  const entries = readEntries(children);
  return <RadixSelect.Root value={toRootValue(value)} defaultValue={toRootValue(defaultValue)} onValueChange={onChange ? (next) => onChange(next === EMPTY ? '' : next) : undefined} disabled={disabled}>
    <RadixSelect.Trigger className={`ds-select ${className}`.trimEnd()} disabled={disabled} {...rest}>
      <span className="ds-select-value"><RadixSelect.Value placeholder={placeholder ?? ' '} /></span>
      <RadixSelect.Icon className="ds-select-icon"><ChevronDown size={14} /></RadixSelect.Icon>
    </RadixSelect.Trigger>
    <RadixSelect.Portal>
      <RadixSelect.Content className="ds-select-content" position="popper" sideOffset={5} collisionPadding={8}>
        <RadixSelect.ScrollUpButton className="ds-select-scroll"><ChevronUp size={13} /></RadixSelect.ScrollUpButton>
        <RadixSelect.Viewport className="ds-select-viewport">
          {entries.map((entry, index) => 'options' in entry
            ? <RadixSelect.Group key={entry.label || index}>
              <RadixSelect.Label className="ds-select-group">{entry.label}</RadixSelect.Label>
              {entry.options.map((option) => <SelectItem key={option.value} option={option} />)}
            </RadixSelect.Group>
            : <SelectItem key={entry.value} option={entry} />)}
        </RadixSelect.Viewport>
        <RadixSelect.ScrollDownButton className="ds-select-scroll"><ChevronDown size={13} /></RadixSelect.ScrollDownButton>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  </RadixSelect.Root>;
}
