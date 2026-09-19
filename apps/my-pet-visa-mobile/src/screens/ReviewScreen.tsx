import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { StepHeader } from '../components/StepHeader';
import { getDocument } from '../data/documents';
import { DOC_STATUS_OPTIONS, SEX_OPTIONS, SPECIES_OPTIONS, TRAVEL_MODE_OPTIONS, YES_NO_UNSURE } from '../data/options';
import { colors, radius, spacing, typography } from '../theme';
import type { Intake } from '../types';

interface Props {
  intake: Intake;
  onEdit: (step: 1 | 2 | 3) => void;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
  submitError?: string;
}

function label<T extends string>(options: { value: T; label: string }[], value: T | ''): string {
  return options.find((o) => o.value === value)?.label ?? '—';
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v || '—'}</Text>
    </View>
  );
}

function SectionTitle({ title, onEdit }: { title: string; onEdit: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={typography.subheading}>{title}</Text>
      <Pressable onPress={onEdit} hitSlop={10} accessibilityRole="button">
        <Text style={styles.edit}>Edit</Text>
      </Pressable>
    </View>
  );
}

export function ReviewScreen({ intake, onEdit, onSubmit, onBack, submitting, submitError }: Props) {
  const docs = Object.values(intake.documents);
  const attachmentCount = docs.reduce((n, d) => n + d.attachments.length, 0);

  return (
    <Screen
      footer={
        <>
          <Button title="Send to My Pet Visa" onPress={onSubmit} loading={submitting} />
          <Button title="Back" variant="ghost" onPress={onBack} disabled={submitting} />
        </>
      }
    >
      <StepHeader step={4} total={4} title="Review & send" subtitle="Double-check the details, then send it to our team." />

      {submitError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>We couldn't send this right now ({submitError}). Your answers are saved on this phone. Please try again in a moment.</Text>
        </View>
      ) : null}

      <Card>
        <SectionTitle title="You and your pet" onEdit={() => onEdit(1)} />
        <Row k="Owner" v={intake.ownerName} />
        <Row k="Phone" v={intake.ownerPhone} />
        <Row k="Email" v={intake.ownerEmail} />
        <Row k="Pet" v={`${intake.petName} · ${label(SPECIES_OPTIONS, intake.species)}${intake.breed ? ` · ${intake.breed}` : ''}`} />
        <Row k="Sex" v={label(SEX_OPTIONS, intake.sex)} />
        <Row k="Born" v={intake.birthDate} />
      </Card>

      <Card>
        <SectionTitle title="Trip" onEdit={() => onEdit(2)} />
        <Row k="Going to" v={intake.destination} />
        <Row k="Travel date" v={intake.travelDate} />
        <Row k="How" v={`${label(TRAVEL_MODE_OPTIONS, intake.travelMode)}${intake.airline ? ` · ${intake.airline}` : ''}`} />
        <Row k="Microchip" v={`${label(YES_NO_UNSURE, intake.hasMicrochip)}${intake.microchipNumber ? ` · ${intake.microchipNumber}` : ''}`} />
        <Row k="Rabies current" v={`${label(YES_NO_UNSURE, intake.rabiesVaccinated)}${intake.rabiesDate ? ` · ${intake.rabiesDate}` : ''}`} />
        {intake.travelType === 'international' ? (
          <>
            <Row k="Returning to US" v={label(YES_NO_UNSURE, intake.returningToUS)} />
            <Row k="Abroad last 6 mo." v={label(YES_NO_UNSURE, intake.outsideUSLast6Months)} />
          </>
        ) : null}
        <Row k="Health notes" v={intake.healthConcerns} />
      </Card>

      <Card>
        <SectionTitle title={`Documents (${attachmentCount} file${attachmentCount === 1 ? '' : 's'} attached)`} onEdit={() => onEdit(3)} />
        {docs.length === 0 ? <Text style={typography.small}>None added yet.</Text> : null}
        {docs.map((d) => {
          const def = getDocument(d.docId);
          if (!def) return null;
          const statusStyle =
            d.status === 'current' ? styles.ok : d.status === 'not_applicable' ? styles.na : styles.attention;
          return (
            <View key={d.docId} style={styles.docRow}>
              <View style={styles.docText}>
                <Text style={typography.body}>{def.label}</Text>
                <Text style={typography.small}>
                  {label(DOC_STATUS_OPTIONS, d.status)}
                  {d.expiresOn ? ` · expires ${d.expiresOn}` : ''}
                  {d.attachments.length ? ` · ${d.attachments.length} file${d.attachments.length === 1 ? '' : 's'}` : ''}
                </Text>
              </View>
              <View style={[styles.dot, statusStyle]} />
            </View>
          );
        })}
      </Card>

      <Text style={[typography.small, styles.legal]}>
        By sending, you agree that My Pet Visa may contact you about this request. Final requirements depend on your
        destination and are confirmed by our veterinarian.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  edit: { color: colors.primary, fontWeight: '600', fontSize: 16 },
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
