import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLanguage } from '../i18n';
import { colors, fonts, radius, spacing, typography } from '../theme';

interface Props {
  step: number; // 1-based
  total: number;
  title: string;
  subtitle?: string;
}

export function StepHeader({ step, total, title, subtitle }: Props) {
  const { t, lang, setLang } = useLanguage();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.stepText}>{t('stepOf', { step, total })}</Text>
        <Pressable onPress={() => setLang(lang === 'en' ? 'es' : 'en')} hitSlop={10} accessibilityRole="button">
          <Text style={styles.lang}>{t('languageToggle')}</Text>
        </Pressable>
      </View>
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepText: { ...typography.small, fontFamily: fonts.sansBold, color: colors.brandBlue, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 12 },
  lang: { ...typography.small, fontFamily: fonts.sansSemiBold, color: colors.brandBlue },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.brandBlue, borderRadius: radius.pill },
});
