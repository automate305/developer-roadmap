import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { StepHeader } from '../components/StepHeader';
import { getDocument } from '../data/documents';
import { DOC_STATUS_OPTIONS, SEX_OPTIONS, SPECIES_OPTIONS, TRAVEL_MODE_OPTIONS, YES_NO_UNSURE, labelOf } from '../data/options';
import { useLanguage } from '../i18n';
import { colors, fonts, radius, spacing, typography } from '../theme';
import type { Intake } from '../types';

interface Props {
  intake: Intake;
  onEdit: (step: 1 | 2 | 3) => void;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
  submitError?: string;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v || '—'}</Text>
    </View>
  );
}

export function ReviewScreen({ intake, onEdit, onSubmit, onBack, submitting, submitError }: Props) {
  const { t, lang } = useLanguage();
  const docs = Object.values(intake.documents);
  const attachmentCount = docs.reduce((n, d) => n + d.attachments.length, 0);

  const SectionTitle = ({ title, onPress }: { title: string; onPress: () => void }) => (
    <View style={styles.sectionHeader}>
      <Text style={typography.subheading}>{title}</Text>
      <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button">
        <Text style={styles.edit}>{t('edit')}</Text>
      </Pressable>
    </View>
  );

  return (
    <Screen
      footer={
        <>
          <Button title={t('reviewSend')} onPress={onSubmit} loading={submitting} />
          <Button title={t('back')} variant="ghost" onPress={onBack} disabled={submitting} />
        </>
      }
    >
      <StepHeader step={4} total={4} title={t('reviewTitle')} subtitle={t('reviewSubtitle')} />

      {submitError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{t('reviewError', { error: submitError })}</Text>
        </View>
      ) : null}

      <Card>
        <SectionTitle title={t('reviewOwnerSection')} onPress={() => onEdit(1)} />
        <Row k={t('reviewOwner')} v={intake.ownerName} />
        <Row k={t('reviewPhone')} v={intake.ownerPhone} />
        <Row k={t('reviewEmail')} v={intake.ownerEmail} />
        <Row k={t('reviewPet')} v={`${intake.petName} · ${labelOf(SPECIES_OPTIONS, intake.species, lang)}${intake.breed ? ` · ${intake.breed}` : ''}`} />
        <Row k={t('reviewSex')} v={labelOf(SEX_OPTIONS, intake.sex, lang)} />
        <Row k={t('reviewBorn')} v={intake.birthDate} />
      </Card>

      <Card>
        <SectionTitle title={t('reviewTripSection')} onPress={() => onEdit(2)} />
        <Row k={t('reviewGoingTo')} v={intake.destination} />
        <Row k={t('reviewTravelDate')} v={intake.travelDate} />
        <Row k={t('reviewHow')} v={`${labelOf(TRAVEL_MODE_OPTIONS, intake.travelMode, lang)}${intake.airline ? ` · ${intake.airline}` : ''}`} />
        <Row k={t('reviewChip')} v={`${labelOf(YES_NO_UNSURE, intake.hasMicrochip, lang)}${intake.microchipNumber ? ` · ${intake.microchipNumber}` : ''}`} />
        <Row k={t('reviewRabies')} v={`${labelOf(YES_NO_UNSURE, intake.rabiesVaccinated, lang)}${intake.rabiesDate ? ` · ${intake.rabiesDate}` : ''}`} />
        {intake.travelType === 'international' ? (
          <>
            <Row k={t('reviewReturning')} v={labelOf(YES_NO_UNSURE, intake.returningToUS, lang)} />
            <Row k={t('reviewAbroad')} v={labelOf(YES_NO_UNSURE, intake.outsideUSLast6Months, lang)} />
          </>
        ) : null}
        <Row k={t('reviewHealth')} v={intake.healthConcerns} />
      </Card>

      <Card>
        <SectionTitle title={t('reviewDocsSection', { n: attachmentCount })} onPress={() => onEdit(3)} />
        {docs.length === 0 ? <Text style={typography.small}>{t('reviewDocsNone')}</Text> : null}
        {docs.map((d) => {
          const def = getDocument(d.docId);
          if (!def) return null;
          const statusStyle = d.status === 'current' ? styles.ok : d.status === 'not_applicable' ? styles.na : styles.attention;
          return (
            <View key={d.docId} style={styles.docRow}>
              <View style={styles.docText}>
                <Text style={typography.body}>{def.label[lang]}</Text>
                <Text style={typography.small}>
                  {labelOf(DOC_STATUS_OPTIONS, d.status, lang)}
                  {d.expiresOn ? ` · ${t('reviewExpires', { date: d.expiresOn })}` : ''}
                  {d.attachments.length ? ` · ${t('reviewFiles', { n: d.attachments.length })}` : ''}
                </Text>
              </View>
              <View style={[styles.dot, statusStyle]} />
            </View>
          );
        })}
      </Card>

      <Text style={[typography.small, styles.legal]}>{t('reviewLegal')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  edit: { color: colors.brandBlue, fontFamily: fonts.sansBold, fontSize: 16 },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: 2 },
  k: { ...typography.small, width: 120 },
  v: { ...typography.body, flex: 1 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  docText: { flex: 1 },
  dot: { width: 12, height: 12, borderRadius: radius.pill },
  ok: { backgroundColor: colors.success },
  attention: { backgroundColor: colors.accent },
  na: { backgroundColor: colors.border },
  errorBox: { backgroundColor: colors.dangerLight, padding: spacing.md, borderRadius: radius.md },
  errorText: { ...typography.body, color: colors.danger },
  legal: { textAlign: 'center', paddingHorizontal: spacing.md },
});
