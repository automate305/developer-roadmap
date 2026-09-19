import { Linking, StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { getDocument } from '../data/documents';
import { getClinicContact } from '../submit';
import { colors, fonts, radius, spacing, typography } from '../theme';
import type { Intake } from '../types';

interface Props {
  intake: Intake;
  sent: boolean;
  onNewRequest: () => void;
}

export function DoneScreen({ intake, sent, onNewRequest }: Props) {
  const contact = getClinicContact();
  const bring = Object.values(intake.documents).filter((d) => d.status === 'current' || d.status === 'expired');
  const needs = Object.values(intake.documents).filter((d) => d.status === 'missing');

  return (
    <Screen footer={<Button title="Start a new request" variant="secondary" onPress={onNewRequest} />}>
      <View style={styles.hero}>
        <View style={styles.check}>
          <Text style={styles.checkText}>✓</Text>
        </View>
        <Text style={typography.title}>{sent ? 'Sent. We have it.' : 'Saved on this phone'}</Text>
        <Text style={[typography.body, styles.center]}>
          {sent
            ? `Thanks, ${intake.ownerName.split(' ')[0]}. Your PetViza coordinator will review ${intake.petName}'s details and reach out with the right route, the real timing and anything specific to ${intake.destination || 'your destination'}.`
            : `Your answers are saved. Please email us to schedule ${intake.petName}'s consultation and keep the original documents handy.`}
        </Text>
      </View>

      <Card>
        <Text style={typography.subheading}>Keep these originals handy</Text>
        {bring.length === 0 ? <Text style={typography.small}>Nothing listed yet.</Text> : null}
        {bring.map((d) => (
          <Text key={d.docId} style={typography.body}>
            • {getDocument(d.docId)?.label}
          </Text>
        ))}
      </Card>

      {needs.length ? (
        <Card>
          <Text style={typography.subheading}>We will help you get these</Text>
          {needs.map((d) => (
            <Text key={d.docId} style={typography.body}>
              • {getDocument(d.docId)?.label}
            </Text>
          ))}
        </Card>
      ) : null}

      <Card>
        <Text style={typography.subheading}>Questions?</Text>
        {contact.phone ? <Button title={`Call ${contact.phone}`} variant="secondary" onPress={() => Linking.openURL(`tel:${contact.phone.replace(/\D/g, '')}`)} /> : null}
        <Button title={`Email ${contact.email}`} variant="secondary" onPress={() => Linking.openURL(`mailto:${contact.email}`)} />
        <Button title="Visit mypetviza.com" variant="ghost" onPress={() => Linking.openURL('https://mypetviza.com')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  check: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { color: '#fff', fontSize: 36, fontFamily: fonts.displayBold },
  center: { textAlign: 'center' },
});
