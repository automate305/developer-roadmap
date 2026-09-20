import { Field } from './Field';
import { useT } from '../i18n';
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
  const t = useT();
  const showFormatError = value.length === 10 && !isValidDate(value);
  return (
    <Field
      label={label}
      value={value}
      onChangeText={(v) => onChange(maskDate(v))}
      placeholder={t('datePlaceholder')}
      keyboardType="number-pad"
      maxLength={10}
      hint={hint}
      optional={optional}
      error={error ?? (showFormatError ? t('dateFormatError') : undefined)}
    />
  );
}
