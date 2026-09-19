import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors, radius, spacing, TAP_TARGET } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, style }: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : colors.primary} />
      ) : (
        <Text style={[styles.text, styles[`${variant}Text` as const]]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: TAP_TARGET + 4,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  text: { fontSize: 17, fontWeight: '600' },
  primary: { backgroundColor: colors.primary },
  primaryText: { color: '#fff' },
  secondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary },
  secondaryText: { color: colors.primary },
  ghost: { backgroundColor: 'transparent' },
  ghostText: { color: colors.primary },
  danger: { backgroundColor: colors.danger },
  dangerText: { color: '#fff' },
});
