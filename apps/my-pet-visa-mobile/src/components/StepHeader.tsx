import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

interface Props {
  step: number; // 1-based
  total: number;
  title: string;
  subtitle?: string;
}

export function StepHeader({ step, total, title, subtitle }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.stepText}>
        Step {step} of {total}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${(step / total) * 100}%` }]} />
      </View>
      <Text style={typography.title}>{title}</Text>
      {subtitle ? <Text style={typography.small}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginBottom: spacing.sm },
  stepText: { ...typography.small, fontWeight: '600', color: colors.primary },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },
});
