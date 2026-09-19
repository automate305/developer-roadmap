import { Field } from './Field';
import { isValidDate, maskDate } from '../utils';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  optional?: boolean;
  error?: string;
}

/** Simple MM/DD/YYYY text entry - works the same on iOS, Android and web. */
export function DateField({ label, value, onChange, hint, optional, error }: Props) {
  const showFormatError = value.length === 10 && !isValidDate(value);
  return (
    <Field
      label={label}
      value={value}
      onChangeText={(t) => onChange(maskDate(t))}
      placeholder="MM/DD/YYYY"
      keyboardType="number-pad"
      maxLength={10}
      hint={hint}
      optional={optional}
      error={error ?? (showFormatError ? 'Please enter a real date as MM/DD/YYYY' : undefined)}
    />
  );
}
