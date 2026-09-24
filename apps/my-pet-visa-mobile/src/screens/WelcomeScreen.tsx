import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { useLanguage } from '../i18n';
import { colors, fonts, radius, spacing, typography } from '../theme';

interface Props {
  hasDraft: boolean;
  /** Set when the client arrived through a private link with their name on it. */
  prefilledName?: string;
  onStart: () => void;
  onStartOver: () => void;
}

export function WelcomeScreen({ hasDraft, prefilledName, onStart, onStartOver }: Props) {
  const { t, lang, setLang } = useLanguage();
  return (
    <Screen
      footer={
        <>
          <Button title={hasDraft ? t('welcomeContinue') : t('welcomeBegin')} onPress={onStart} />
          {hasDraft ? <Button title={t('welcomeStartOver')} variant="ghost" onPress={onStartOver} /> : null}
        </>
      }
    >
      <View style={styles.hero}>
        <View style={styles.circleLarge} />
        <View style={styles.circleSmall} />
        <Pressable
          onPress={() => setLang(lang === 'en' ? 'es' : 'en')}
          style={styles.langPill}
          accessibilityRole="button"
          accessibilityLabel={t('languageToggle')}
        >
          <Text style={styles.langText}>{t('languageToggle')}</Text>
        </Pressable>
        <Image source={require('../../assets/petviza-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="PetViza" />
        <Text style={styles.headline}>{t('welcomeHeadline')}</Text>
        <Text style={styles.tagline}>{t('welcomeTagline')}</Text>
      </View>

      {prefilledName ? (
        <View style={styles.prefilled}>
          <Text style={styles.prefilledText}>{t('welcomePrefilled', { name: prefilledName.split(' ')[0] })}</Text>
        </View>
      ) : null}

      <Card>
        <Text style={typography.subheading}>{t('welcomeBeforeTitle')}</Text>
        <Text style={typography.body}>{t('welcomeBeforeBody')}</Text>
      </Card>

      <Card>
        <Text style={typography.subheading}>{t('welcomeAskTitle')}</Text>
        <Text style={typography.body}>{t('welcomeAsk1')}</Text>
        <Text style={typography.body}>{t('welcomeAsk2')}</Text>
        <Text style={typography.body}>{t('welcomeAsk3')}</Text>
        <Text style={typography.body}>{t('welcomeAsk4')}</Text>
      </Card>

      <Text style={[typography.small, styles.note]}>{t('welcomeNote')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  circleLarge: {
    position: 'absolute',
    right: -120,
    top: -40,
    width: 320,
    height: 320,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(16, 35, 60, 0.10)',
  },
  circleSmall: {
    position: 'absolute',
    right: -20,
    top: 60,
    width: 200,
    height: 200,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(16, 35, 60, 0.10)',
  },
  langPill: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  langText: { fontSize: 13, fontFamily: fonts.sansBold, color: colors.primary },
  logo: { width: 150, height: 150 },
  headline: { fontSize: 32, lineHeight: 36, fontFamily: fonts.displayBold, color: colors.primary, textAlign: 'center', letterSpacing: -0.5 },
  tagline: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  prefilled: { backgroundColor: colors.brandBlueLight, padding: spacing.md, borderRadius: radius.md },
  prefilledText: { ...typography.body, color: colors.primary, fontFamily: fonts.sansSemiBold, textAlign: 'center' },
  note: { textAlign: 'center', paddingHorizontal: spacing.md },
});
