import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { colors, radius, spacing, typography } from '../theme';

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
          <Button title={hasDraft ? 'Continue where I left off' : 'Get started'} onPress={onStart} />
          {hasDraft ? <Button title="Start over" variant="ghost" onPress={onStartOver} /> : null}
        </>
      }
    >
      <View style={styles.hero}>
        <View style={styles.logoMark}>
          <Text style={styles.logoEmoji}>🐾</Text>
        </View>
        <Text style={styles.brand}>My Pet Visa</Text>
        <Text style={styles.tagline}>Pet travel health certificates, made simple.</Text>
      </View>

      <Card>
        <Text style={typography.subheading}>Before your appointment</Text>
        <Text style={typography.body}>
          Answer a few quick questions and snap photos of the papers you already have. This takes about 5 minutes
          and helps us get your certificate right the first time.
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
        Nothing is final. You can change any answer before you send it to us, and our team will confirm your
        destination's requirements with you.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  logoMark: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoEmoji: { fontSize: 42 },
  brand: { fontSize: 30, fontWeight: '800', color: colors.primary },
  tagline: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  note: { textAlign: 'center', paddingHorizontal: spacing.md },
});
