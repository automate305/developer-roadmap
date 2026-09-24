import { Linking, StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { getDocument } from '../data/documents';
import { useLanguage } from '../i18n';
import { getClinicContact } from '../submit';
import { colors, fonts, radius, spacing, typography } from '../theme';
import type { Intake } from '../types';

interface Props {
  intake: Intake;
  sent: boolean;
  onNewRequest: () => void;
}

export function DoneScreen({ intake, sent, onNewRequest }: Props) {
  const { t, lang } = useLanguage();
  const contact = getClinicContact();
  const bring = Object.values(intake.documents).filter((d) => d.status === 'current' || d.status === 'expired');
  const needs = Object.values(intake.documents).filter((d) => d.status === 'missing');

  return (
    <Screen footer={<Button title={t('doneNew')} variant="secondary" onPress={onNewRequest} />}>
      <View style={styles.hero}>
        <View style={styles.check}>
          <Text style={styles.checkText}>✓</Text>
        </View>
        <Text style={typography.title}>{sent ? t('doneSentTitle') : t('doneSavedTitle')}</Text>
        <Text style={[typography.body, styles.center]}>
          {sent
            ? t('doneSentBody', {
                first: intake.ownerName.split(' ')[0],
                pet: intake.petName,
                destination: intake.destination || t('doneYourDestination'),
              })
            : t('doneSavedBody', { pet: intake.petName })}
        </Text>
      </View>

      <Card>
        <Text style={typography.subheading}>{t('doneBringTitle')}</Text>
        {bring.length === 0 ? <Text style={typography.small}>{t('doneBringNone')}</Text> : null}
        {bring.map((d) => (
          <Text key={d.docId} style={typography.body}>
            • {getDocument(d.docId)?.label[lang]}
          </Text>
        ))}
      </Card>

      {needs.length ? (
        <Card>
          <Text style={typography.subheading}>{t('doneNeedsTitle')}</Text>
          {needs.map((d) => (
            <Text key={d.docId} style={typography.body}>
              • {getDocument(d.docId)?.label[lang]}
            </Text>
          ))}
        </Card>
      ) : null}

      <Card>
        <Text style={typography.subheading}>{t('doneQuestions')}</Text>
        {contact.phone ? (
          <Button title={t('doneCall', { phone: contact.phone })} variant="secondary" onPress={() => Linking.openURL(`tel:${contact.phone.replace(/\D/g, '')}`)} />
        ) : null}
        <Button title={t('doneEmail', { email: contact.email })} variant="secondary" onPress={() => Linking.openURL(`mailto:${contact.email}`)} />
        <Button title={t('doneVisit')} variant="ghost" onPress={() => Linking.openURL('https://mypetviza.com')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  check: { width: 72, height: 72, borderRadius: radius.pill, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  checkText: { color: '#fff', fontSize: 36, fontFamily: fonts.displayBold },
  center: { textAlign: 'center' },
});
