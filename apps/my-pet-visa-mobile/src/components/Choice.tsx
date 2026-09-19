import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Option } from '../data/options';
import { colors, radius, spacing, TAP_TARGET, typography } from '../theme';

interface Props<T extends string> {
  label: string;
  options: Option<T>[];
  value: T | '';
  onChange: (value: T) => void;
  hint?: string;
  error?: string;
}

/** Big tappable chips - the simplest way to answer yes/no style questions. */
export function Choice<T extends string>({ label, options, value, onChange, hint, error }: Props<T>) {
  return (
    <View style={styles.wrap}>
      <Text style={typography.label}>{label}</Text>
      <View style={styles.row}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(o.value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={typography.small}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: TAP_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: 16, color: colors.text },
  chipTextSelected: { color: colors.primaryDark, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14 },
});
