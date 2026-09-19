import { Image, StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { colors, fonts, radius, spacing, typography } from '../theme';

interface Props {
  hasDraft: boolean;
  onStart: () => void;
  onStartOver: () => void;
}

export function WelcomeScreen({ hasDraft, onStart, onStartOver }: Props) {
  return (
    <Screen
      footer={
        <>
          <Button title={hasDraft ? 'Continue where I left off' : 'Begin your journey'} onPress={onStart} />
          {hasDraft ? <Button title="Start over" variant="ghost" onPress={onStartOver} /> : null}
        </>
      }
    >
      <View style={styles.hero}>
        <View style={styles.circleLarge} />
        <View style={styles.circleSmall} />
        <Image source={require('../../assets/petviza-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="PetViza" />
        <Text style={styles.headline}>Go farther.{'\n'}Worry less.</Text>
        <Text style={styles.tagline}>International pet travel certificates, handled with expertise and a personal touch.</Text>
      </View>

      <Card>
        <Text style={typography.subheading}>Before your consultation</Text>
        <Text style={typography.body}>
          Answer a few quick questions and snap photos of the papers you already have. It takes about 5 minutes and
          lets us map your route before we even speak.
        </Text>
      </Card>

      <Card>
        <Text style={typography.subheading}>What we will ask</Text>
        <Text style={typography.body}>1. Your name and your pet's details</Text>
        <Text style={typography.body}>2. Where and when you are traveling</Text>
        <Text style={typography.body}>3. Which vaccines and documents you have</Text>
        <Text style={typography.body}>4. Photos or PDFs of those documents</Text>
      </Card>

      <Text style={[typography.small, styles.note]}>
        No pressure, no commitment. You can change any answer before you send it, and we confirm your destination's
        requirements with you personally.
      </Text>
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
  // Echo of the site's hero rings
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
  logo: { width: 150, height: 150 },
  headline: { fontSize: 32, lineHeight: 36, fontFamily: fonts.displayBold, color: colors.primary, textAlign: 'center', letterSpacing: -0.5 },
  tagline: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  note: { textAlign: 'center', paddingHorizontal: spacing.md },
});
