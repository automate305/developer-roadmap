import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fonts, radius, spacing, TAP_TARGET, typography } from '../theme';

interface Props extends TextInputProps {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
}

export function Field({ label, hint, error, optional, style, ...rest }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={typography.label}>
        {label}
        {optional ? <Text style={styles.optional}> (optional)</Text> : null}
      </Text>
      <TextInput
        placeholderTextColor={colors.placeholder}
        style={[styles.input, error ? styles.inputError : null, style]}
        accessibilityLabel={label}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={typography.small}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  optional: { color: colors.textMuted, fontFamily: fonts.sans },
  input: {
    minHeight: TAP_TARGET + 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 17,
    fontFamily: fonts.sans,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: 14, fontFamily: fonts.sans },
});
